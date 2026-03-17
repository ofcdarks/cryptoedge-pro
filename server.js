require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const axios        = require('axios');
const WebSocket    = require('ws');
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');
const bcrypt       = require('bcrypt');
const rateLimit    = require('express-rate-limit');
const helmet       = require('helmet');
const compression  = require('compression');
const nodemailer   = require('nodemailer');
const { execSync, execFile, spawn } = require('child_process');

// ─── Stripe safe loader (must be before routes) ─────────────────────────────
let _stripeLib = null;
let _stripeAvailable = false;
try { _stripeLib = require('stripe'); _stripeAvailable = true; } catch { _stripeAvailable = false; }
function getStripe(key) {
  if (!_stripeAvailable) throw new Error('Módulo stripe não instalado. Faça redeploy no EasyPanel.');
  return _stripeLib(key);
}

const app = express();

// ── Production safety checks ──────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const enc = process.env.ENCRYPTION_KEY || '';
  if (!enc || enc === 'mude_esta_chave_antes_do_deploy_obrigatorio' || enc.length < 16) {
    console.error('❌ FATAL: ENCRYPTION_KEY não configurada ou inválida!');
    console.error('   Gere uma chave: node -e "console.log(require(\'crypto\').randomBytes(16).toString(\'hex\'))"');
    process.exit(1);
  }
  if (!process.env.ALLOWED_ORIGIN || process.env.ALLOWED_ORIGIN === '*') {
    console.warn('⚠️  ALLOWED_ORIGIN não configurado — usando * (inseguro em produção)');
  }
}

const db  = require('./db');
const emailTpls = require('./templates/email');

// ─── Trust Proxy ───────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ─── Security Headers ──────────────────────────────────────────────────────────
app.use(compression({ threshold: 1024 }));
app.use(helmet({
  contentSecurityPolicy: false, // TradingView requires relaxed CSP
  crossOriginEmbedderPolicy: false,
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors({
  origin: allowedOrigin || false,  // FIX: was `true` (permite qualquer origem)
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Limite de requisições atingido. Aguarde 1 minuto.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login',    loginLimiter);
app.use('/api/auth/register', loginLimiter);

// ─── Encryption helpers (para Binance Secret) ─────────────────────────────────
const ENC_KEY = process.env.ENCRYPTION_KEY || 'cryptoedge_default_enc_key_32_ch';
const ENC_KEY_BUF = Buffer.from(ENC_KEY.padEnd(32, '0').slice(0,32));

function encryptSecret(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENC_KEY_BUF, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decryptSecret(enc) {
  if (!enc || !enc.includes(':')) return enc || '';
  try {
    const [ivHex, encHex] = enc.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY_BUF, Buffer.from(ivHex,'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex,'hex')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

// ─── Auth Helpers ──────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;

async function hashPass(p) {
  return bcrypt.hash(p, BCRYPT_ROUNDS);
}

async function checkPass(p, hash) {
  // Support old SHA-256 hashes during migration
  const oldHash = crypto.createHash('sha256').update(p + 'cryptoedge_salt').digest('hex');
  if (hash === oldHash) return true;
  try { return await bcrypt.compare(p, hash); } catch { return false; }
}

function genToken()  { return crypto.randomBytes(32).toString('hex'); }

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const sess = db.get('SELECT * FROM sessions WHERE token=? AND expires_at > datetime("now")', [token]);
    if (!sess) return res.status(401).json({ error: 'Sessão expirada — faça login novamente' });
    db.run('UPDATE sessions SET expires_at=? WHERE token=?',
      [new Date(Date.now()+30*24*60*60*1000).toISOString(), token]);
    req.user = sess.username;
    next();
  } catch(e) { res.status(500).json({ error: 'Auth error: ' + e.message }); }
}

function requireAdmin(req, res, next) {
  const user = db.get("SELECT role FROM users WHERE username=?", [req.user]);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado — apenas admin' });
  next();
}

// ─── Auth Routes ───────────────────────────────────────────────────────────────
app.get('/api/auth/setup-required', (req, res) => {
  try {
    const admin = db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
    const mode  = db.get("SELECT value FROM platform_settings WHERE key='registration_mode'");
    res.json({
      required: !admin,
      regMode: mode?.value || 'invite',
      platformName: db.get("SELECT value FROM platform_settings WHERE key='platform_name'")?.value || 'CryptoEdge Pro'
    });
  } catch(e) { res.json({ required: true, regMode: 'invite' }); }
});

app.post('/api/auth/setup', async (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password || password.length < 6)
    return res.status(400).json({ error: 'Username e senha (mín. 6 chars) obrigatórios' });
  try {
    const existing = db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (existing) return res.status(400).json({ error: 'Admin já configurado' });
    const wt = genToken();
    const id = db.insert('users', {
      username, email: email||null,
      password: await hashPass(password),
      role: 'admin', plan: 'admin', status: 'active',
      webhook_token: wt
    }, true);
    const token = genToken(), exp = new Date(Date.now()+30*24*60*60*1000).toISOString();
    db.insert('sessions', { token, username, expires_at: exp }, true);
    res.json({ ok: true, token, username, role: 'admin' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password, email, inviteCode } = req.body || {};
  if (!username || !password || password.length < 6)
    return res.status(400).json({ error: 'Username e senha (mín. 6 chars) obrigatórios' });
  try {
    const mode = db.get("SELECT value FROM platform_settings WHERE key='registration_mode'")?.value || 'invite';
    let plan = 'basic';
    if (mode === 'invite') {
      if (!inviteCode) return res.status(400).json({ error: 'Código de convite obrigatório' });
      const invite = db.get('SELECT * FROM invite_codes WHERE code=? AND (expires_at IS NULL OR expires_at > datetime("now"))', [inviteCode]);
      if (!invite) return res.status(400).json({ error: 'Código de convite inválido ou expirado' });
      if (invite.uses >= invite.max_uses) return res.status(400).json({ error: 'Código de convite já utilizado' });
      plan = invite.plan || 'basic';
      db.run('UPDATE invite_codes SET uses=uses+1, used_by=?, used_at=datetime("now") WHERE code=?', [username, inviteCode]);
    } else if (mode === 'closed') {
      return res.status(403).json({ error: 'Cadastros desativados.' });
    }
    if (db.get('SELECT id FROM users WHERE username=?', [username]))
      return res.status(400).json({ error: 'Nome de usuário já existe' });
    if (email && db.get('SELECT id FROM users WHERE email=?', [email]))
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    const maxUsers = parseInt(db.get("SELECT value FROM platform_settings WHERE key='max_users'")?.value || '100');
    if (db.count('users') >= maxUsers) return res.status(403).json({ error: 'Limite de usuários atingido' });
    const wt = genToken();
    db.insert('users', {
      username, email: email||null,
      password: await hashPass(password),
      role: 'user', plan, status: 'active',
      invite_code: inviteCode||'', webhook_token: wt
    }, true);
    const token = genToken(), exp = new Date(Date.now()+30*24*60*60*1000).toISOString();
    db.insert('sessions', { token, username, expires_at: exp }, true);
    res.json({ ok: true, token, username, role: 'user', plan });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const user = db.get('SELECT * FROM users WHERE username=?', [username]);
    if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    const ok = await checkPass(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Conta desativada.' });

    // Migrate SHA-256 hash to bcrypt on first login
    if (!user.password.startsWith('$2b$')) {
      const newHash = await hashPass(password);
      db.run('UPDATE users SET password=? WHERE username=?', [newHash, username]);
    }

    const token = genToken(), exp = new Date(Date.now()+30*24*60*60*1000).toISOString();
    db.insert('sessions', { token, username, expires_at: exp }, true);
    db.run('UPDATE users SET last_login=datetime("now") WHERE username=?', [username]);
    db.run('DELETE FROM sessions WHERE expires_at < datetime("now")');
    res.json({ ok: true, token, username, role: user.role, plan: user.plan });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) db.run('DELETE FROM sessions WHERE token=?', [token]);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  try {
    const user = db.get('SELECT id,username,email,role,plan,status,binance_key,telegram_token,telegram_chatid,webhook_token,created_at,last_login FROM users WHERE username=?', [req.user]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ ok: true, user: {
      ...user,
      binance_key:     user.binance_key ? user.binance_key.slice(0,8)+'••••••••' : '',
      has_binance_key: !!user.binance_key,
      has_telegram:    !!user.telegram_token,
    }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/keys', requireAuth, (req, res) => {
  try {
    const { binance_key, binance_secret, telegram_token, telegram_chatid, email } = req.body || {};
    const updates = {};
    if (binance_key    !== undefined) updates.binance_key    = binance_key;
    if (binance_secret !== undefined) {
      // FIX: encrypt the secret before storing
      updates.binance_secret     = binance_secret ? '[encrypted]' : '';
      updates.binance_secret_enc = binance_secret ? encryptSecret(binance_secret) : '';
    }
    if (telegram_token  !== undefined) updates.telegram_token  = telegram_token;
    if (telegram_chatid !== undefined) updates.telegram_chatid = telegram_chatid;
    if (email           !== undefined) updates.email           = email;
    if (!Object.keys(updates).length) return res.json({ ok: true });
    db.update('users', updates, 'username=?', [req.user], true);
    res.json({ ok: true, message: 'Chaves salvas com sucesso' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { current, newPass } = req.body || {};
    if (!current || !newPass || newPass.length < 6)
      return res.status(400).json({ error: 'Senhas inválidas (mín. 6 chars)' });
    const user = db.get('SELECT * FROM users WHERE username=?', [req.user]);
    if (!user || !(await checkPass(current, user.password)))
      return res.status(401).json({ error: 'Senha atual incorreta' });
    db.run('UPDATE users SET password=? WHERE username=?', [await hashPass(newPass), req.user], true);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Webhook Token dedicado ────────────────────────────────────────────────────
app.post('/api/auth/regenerate-webhook-token', requireAuth, (req, res) => {
  try {
    const wt = genToken();
    db.run('UPDATE users SET webhook_token=? WHERE username=?', [wt, req.user], true);
    res.json({ ok: true, webhook_token: wt });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Password Reset ────────────────────────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
  try {
    const user = db.get('SELECT * FROM users WHERE email=?', [email]);
    if (!user) return res.json({ ok: true, message: 'Se o e-mail existir, você receberá as instruções' });
    const resetToken = crypto.randomBytes(32).toString('hex');
    const exp        = new Date(Date.now() + 30*60*1000).toISOString();
    // FIX: tabela dedicada para reset tokens (era misturado com sessions)
    db.run('DELETE FROM password_resets WHERE username=?', [user.username]);
    db.insert('password_resets', { token: resetToken, username: user.username, expires_at: exp, used: 0 }, true);
    const platformName = db.get("SELECT value FROM platform_settings WHERE key='platform_name'")?.value || 'CryptoEdge Pro';
    const resetLink    = (process.env.APP_URL || 'http://localhost:3000') + '/reset-password?token=' + resetToken;
    await sendMail({ to: email, subject: '[' + platformName + '] Redefinição de senha', html: emailTpls.resetPassword(user.username, resetLink, '30 minutos') });
    res.json({ ok: true, message: 'Se o e-mail existir, você receberá as instruções em breve' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-password.html')));

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Token e nova senha (mín. 6 chars) obrigatórios' });
  try {
    const rec = db.get('SELECT * FROM password_resets WHERE token=? AND used=0 AND expires_at > datetime("now")', [token]);
    if (!rec) return res.status(400).json({ error: 'Token inválido ou expirado.' });
    db.run('UPDATE users SET password=? WHERE username=?', [await hashPass(newPassword), rec.username], true);
    db.run('UPDATE password_resets SET used=1 WHERE token=?', [token]);
    const user = db.get('SELECT email FROM users WHERE username=?', [rec.username]);
    if (user?.email) await sendMail({ to: user.email, subject: 'Senha alterada — CryptoEdge Pro', html: emailTpls.passwordChanged(rec.username) });
    res.json({ ok: true, message: 'Senha redefinida com sucesso! Faça login.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Trades API (FIX: agora exige autenticação) ───────────────────────────────
app.get('/api/trades', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const rows  = db.all('SELECT * FROM trades WHERE username=? ORDER BY created_at DESC LIMIT ?', [req.user, limit]);
    res.json(rows.map(r => ({ ...r, _id: r.id, pnl: r.pnl||0, pnl_pct: r.pnl_pct||0, createdAt: r.created_at, tags: JSON.parse(r.tags||'[]') })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/trades', requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    const id = db.insert('trades', {
      username:   req.user,
      pair:       b.pair||'',
      direction:  b.direction||'',
      entry:      b.entry||0,
      exit:       b.exit||null,
      size:       b.size||0,
      leverage:   b.leverage||'1x',
      reason:     b.reason||'',
      result:     b.result||'pending',
      pnl:        b.pnl||0,
      pnl_pct:    b.pnl_pct||0,
      screenshot: b.screenshot||'',
      notes:      b.notes||'',
      tags:       JSON.stringify(b.tags||[]),
      created_at: new Date().toLocaleString('pt-BR'),
      updated_at: new Date().toISOString()
    }, true);
    res.json({ _id: id, ...b });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/trades/:id', requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    const updates = {};
    if (b.result     !== undefined) updates.result     = b.result;
    if (b.exit       !== undefined) updates.exit       = b.exit;
    if (b.pnl        !== undefined) updates.pnl        = b.pnl;
    if (b.pnl_pct    !== undefined) updates.pnl_pct    = b.pnl_pct;
    if (b.notes      !== undefined) updates.notes      = b.notes;
    if (b.screenshot !== undefined) updates.screenshot = b.screenshot;
    if (b.tags       !== undefined) updates.tags       = JSON.stringify(b.tags);
    if (!Object.keys(updates).length) return res.json({ ok: true });
    updates.updated_at = new Date().toISOString();
    db.update('trades', updates, 'id=? AND username=?', [req.params.id, req.user], true);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/trades/:id', requireAuth, (req, res) => {
  try {
    db.remove('trades', 'id=? AND username=?', [req.params.id, req.user]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trades/stats', requireAuth, (req, res) => {
  try {
    const all    = db.all('SELECT * FROM trades WHERE username=?', [req.user]);
    const totalPnl = all.reduce((s,t) => s+(t.pnl||0), 0);
    const wins   = all.filter(t => t.result==='win').length;
    const losses = all.filter(t => t.result==='loss').length;
    res.json({ total:all.length, wins, losses, winRate: all.length?((wins/all.length)*100).toFixed(1):0, totalPnl: totalPnl.toFixed(2) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Export CSV dos trades
app.get('/api/trades/export/csv', requireAuth, (req, res) => {
  try {
    const rows = db.all('SELECT * FROM trades WHERE username=? ORDER BY created_at DESC', [req.user]);
    const header = 'Data,Par,Direção,Entrada,Saída,Tamanho,Alavancagem,Resultado,PnL,PnL%,Razão,Notas\n';
    const lines  = rows.map(t =>
      [t.created_at, t.pair, t.direction, t.entry, t.exit||'', t.size, t.leverage, t.result,
       t.pnl, t.pnl_pct, (t.reason||'').replace(/,/g,';'), (t.notes||'').replace(/,/g,';')]
      .join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    res.send('\ufeff' + header + lines); // BOM for Excel
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Prices REST ───────────────────────────────────────────────────────────────
const SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT',
  'DOTUSDT','TRXUSDT','LTCUSDT','LINKUSDT','BCHUSDT','XLMUSDT','ETCUSDT','VETUSDT',
  'HBARUSDT','ICPUSDT','FILUSDT','ATOMUSDT','UNIUSDT','AAVEUSDT','MKRUSDT','CRVUSDT',
  'SNXUSDT','GRTUSDT','COMPUSDT','BALUSDT','SUSHIUSDT','YFIUSDT','1INCHUSDT','DYDXUSDT',
  'LRCUSDT','ZRXUSDT','MATICUSDT','ARBUSDT','OPUSDT','STRKUSDT','IMXUSDT',
  'FETUSDT','RENDERUSDT','WLDUSDT','AGIXUSDT','OCEANUSDT',
  'SHIBUSDT','PEPEUSDT','WIFUSDT','FLOKIUSDT','BONKUSDT','MEMEUSDT',
  'JUPUSDT','JTOUSDT','RAYUSDT','PYTHUSDT','NEARUSDT','APTUSDT','SUIUSDT','SEIUSDT',
  'INJUSDT','TIAUSDT','ALTUSDT','TAOUSDT','KASUSDT',
  'AXSUSDT','SANDUSDT','MANAUSDT','ENJUSDT','GALAUSDT','PIXELUSDT','RONUSDT',
  'RUNEUSDT','ALGOUSDT','QNTUSDT','FLOWUSDT','APEUSDT','LDOUSDT','STXUSDT',
  'EGLDUSDT','THETAUSDT','FTMUSDT','NEOUSDT','WAVESUSDT','KSMUSDT','ZILUSDT',
  'ICXUSDT','ONTUSDT','BATUSDT','DYMUSDT','XMRUSDT','ZECUSDT','DASHUSDT',
];

app.get('/api/prices', async (req, res) => {
  try {
    const statsRes = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: { symbols: JSON.stringify(SYMBOLS) }, timeout: 8000
    });
    const result = (statsRes.data || []).filter(t => SYMBOLS.includes(t.symbol)).map(t => ({
      s: t.symbol, c: t.lastPrice, P: t.priceChangePercent,
      h: t.highPrice, l: t.lowPrice, v: t.volume, q: t.quoteVolume,
    }));
    res.json({ ok: true, data: result });
  } catch(err) {
    try {
      const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 8000 });
      const result = (r.data || []).filter(t => SYMBOLS.includes(t.symbol)).map(t => ({
        s: t.symbol, c: t.lastPrice, P: t.priceChangePercent,
        h: t.highPrice, l: t.lowPrice, v: t.volume, q: t.quoteVolume,
      }));
      res.json({ ok: true, data: result });
    } catch(e2) {
      res.status(503).json({ ok: false, error: 'Binance indisponível', data: [] });
    }
  }
});

app.get('/api/price/:symbol', async (req, res) => {
  try {
    const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: { symbol: req.params.symbol.toUpperCase() }, timeout: 6000
    });
    res.json(r.data);
  } catch(err) { res.status(503).json({ error: 'Binance indisponível' }); }
});

// ─── Funding Rate Scanner (NOVO) ─────────────────────────────────────────────
app.get('/api/funding-rates', async (req, res) => {
  try {
    const r = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 8000 });
    const pairs = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT',
      'AVAXUSDT','LINKUSDT','MATICUSDT','ARBUSDT','OPUSDT','NEARUSDT','APTUSDT','SUIUSDT',
      'INJUSDT','AAVEUSDT','UNIUSDT','LDOUSDT','ATOMUSDT','DOTUSDT','LTCUSDT','BCHUSDT',
      'WIFUSDT','PEPEUSDT','SHIBUSDT','GALAUSDT','FETUSDT','RENDERUSDT'];
    const data = (r.data || [])
      .filter(x => pairs.includes(x.symbol))
      .map(x => ({
        symbol:       x.symbol,
        fundingRate:  parseFloat(x.lastFundingRate),
        fundingRatePct: (parseFloat(x.lastFundingRate)*100).toFixed(4),
        markPrice:    parseFloat(x.markPrice).toFixed(2),
        indexPrice:   parseFloat(x.indexPrice).toFixed(2),
        nextFundingTime: x.nextFundingTime,
        annualized:   ((parseFloat(x.lastFundingRate) * 3 * 365) * 100).toFixed(1),
      }))
      .sort((a,b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
    res.json({ ok: true, data, ts: Date.now() });
  } catch(err) {
    res.status(503).json({ ok: false, error: 'Falha ao buscar funding rates: ' + err.message, data: [] });
  }
});

// ─── Correlation Matrix (NOVO) ────────────────────────────────────────────────
app.get('/api/correlation', async (req, res) => {
  const pairs = (req.query.pairs || 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,MATICUSDT,DOGEUSDT').split(',').slice(0,12);
  try {
    const returns = {};
    await Promise.allSettled(pairs.map(async sym => {
      try {
        const r = await axios.get('https://api.binance.com/api/v3/klines', {
          params: { symbol: sym, interval: '1d', limit: 31 }, timeout: 8000
        });
        const closes = r.data.map(k => parseFloat(k[4]));
        returns[sym] = closes.slice(1).map((c,i) => (c - closes[i]) / closes[i]);
      } catch {}
    }));
    const symbols = Object.keys(returns);
    const matrix = symbols.map(a => symbols.map(b => {
      const ra = returns[a], rb = returns[b];
      if (!ra || !rb || ra.length < 5) return null;
      const n   = Math.min(ra.length, rb.length);
      const ma  = ra.slice(0,n).reduce((s,v)=>s+v,0)/n;
      const mb  = rb.slice(0,n).reduce((s,v)=>s+v,0)/n;
      const num = ra.slice(0,n).reduce((s,v,i)=>s+(v-ma)*(rb[i]-mb),0);
      const da  = Math.sqrt(ra.slice(0,n).reduce((s,v)=>s+(v-ma)**2,0));
      const db  = Math.sqrt(rb.slice(0,n).reduce((s,v)=>s+(v-mb)**2,0));
      return da && db ? Math.round(num/(da*db)*100)/100 : null;
    }));
    res.json({ ok: true, symbols, matrix });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Binance Klines Proxy ─────────────────────────────────────────────────────
app.get('/api/binance/klines', async (req, res) => {
  try {
    const { symbol, interval, limit } = req.query;
    const r = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, limit: limit || 200 }, timeout: 10000
    });
    res.json(r.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/binance/ticker', async (req, res) => {
  try {
    const { symbols } = req.query;
    const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: symbols ? { symbols } : {}, timeout: 10000
    });
    res.json(r.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/binance/price', async (req, res) => {
  try {
    const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: { symbol: req.query.symbol }, timeout: 8000
    });
    res.json(r.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Binance Account Balance ───────────────────────────────────────────────────
app.get('/api/binance/balance', requireAuth, async (req, res) => {
  try {
    const user = db.get('SELECT binance_key, binance_secret, binance_secret_enc FROM users WHERE username=?', [req.user]);

    // Usa chaves do perfil; cai para variáveis de ambiente do EasyPanel como fallback
    const binanceKey = user?.binance_key || process.env.BINANCE_API_KEY || '';
    if (!binanceKey)
      return res.json({ ok: false, error: 'Binance API Key não configurada em Meu Perfil', simulated: true, balance: 500 });

    // Decrypt secret — fallback para env var se perfil não tiver
    const secret = user?.binance_secret_enc
      ? (decryptSecret(user.binance_secret_enc) || process.env.BINANCE_SECRET_KEY || '')
      : (user?.binance_secret || process.env.BINANCE_SECRET_KEY || '');
    if (!secret) return res.json({ ok: false, error: 'Binance Secret não configurado', simulated: true, balance: 500 });

    // Sync timestamp — obtém serverTime da Binance para evitar "Timestamp ahead/behind"
    let ts = Date.now();
    try {
      const timeR = await axios.get('https://api.binance.com/api/v3/time', { timeout: 4000 });
      ts = timeR.data.serverTime || ts;
    } catch {}

    // Assina a query string EXATA que será enviada (ordem importa para HMAC)
    const mkSig = (qs) => crypto.createHmac('sha256', secret).update(qs).digest('hex');
    const mkQS  = (extra='') => {
      const base = `timestamp=${ts}&recvWindow=15000${extra ? '&'+extra : ''}`;
      return base + '&signature=' + mkSig(base);
    };
    let totalUSDT = 0, walletData = [], source = 'futures';

    try {
      const rF = await axios.get('https://fapi.binance.com/fapi/v2/balance?' + mkQS(), {
        headers: { 'X-MBX-APIKEY': binanceKey }, timeout: 8000
      });
      const futuresBalances = rF.data.filter(b => parseFloat(b.balance) > 0);
      totalUSDT = futuresBalances.reduce((s,b) => s + parseFloat(b.balance), 0);
      walletData = futuresBalances.map(b => ({
        asset: b.asset, balance: parseFloat(b.balance).toFixed(2),
        unrealizedProfit: parseFloat(b.crossUnPnl||0).toFixed(2)
      }));
    } catch {
      source = 'spot';
      // Re-sync timestamp para o spot (o tempo passou desde a tentativa futures)
      try { const tr=await axios.get('https://api.binance.com/api/v3/time',{timeout:3000}); ts=tr.data.serverTime||ts; } catch {}
      const rS = await axios.get('https://api.binance.com/api/v3/account?' + mkQS(), {
        headers: { 'X-MBX-APIKEY': binanceKey }, timeout: 8000
      });
      const spotBalances = rS.data.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0);
      walletData = spotBalances.map(b => ({
        asset: b.asset,
        balance: (parseFloat(b.free) + parseFloat(b.locked)).toFixed(4),
        free: parseFloat(b.free).toFixed(4),
        locked: parseFloat(b.locked).toFixed(4)
      }));
      const usdt = spotBalances.find(b => b.asset === 'USDT');
      totalUSDT = usdt ? parseFloat(usdt.free) + parseFloat(usdt.locked) : 0;
    }
    res.json({ ok: true, source, totalUSDT: totalUSDT.toFixed(2), balances: walletData });
  } catch(e) {
    res.json({ ok: false, error: e.response?.data?.msg || e.message, simulated: true, balance: 500 });
  }
});

// ─── AI Expert ────────────────────────────────────────────────────────────────
app.post('/api/ai', requireAuth, async (req, res) => {
  const apiKey  = process.env.LAOZHANG_API_KEY;
  const baseUrl = process.env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1';
  const model   = process.env.AI_MODEL || 'qwen3-30b-a3b';
  if (!apiKey) return res.status(400).json({ content: [{ type:'text', text:'Configure LAOZHANG_API_KEY no .env para usar a IA Expert.' }] });

  const sysPrompt = 'Você é um especialista sênior em day trade de criptomoedas com 12+ anos de experiência em futuros, alavancagem e gestão de risco. Responda em português brasileiro, de forma direta, técnica e objetiva. Use exemplos com números reais quando possível. Seja honesto sobre riscos — nunca prometa lucros. Máximo 300 palavras.';
  const { messages } = req.body;
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const baseMessages = [{ role:'system', content: sysPrompt }, ...messages];
  const isQwen3 = model.toLowerCase().includes('qwen3');
  const body = { model, max_tokens:1024, temperature:0.7, messages:baseMessages, ...(isQwen3?{enable_thinking:false}:{}) };

  try {
    let response;
    try {
      response = await axios.post(`${baseUrl}/chat/completions`, body, { headers, timeout:30000 });
    } catch(firstErr) {
      const errMsg = (firstErr.response?.data?.error?.message || firstErr.message || '').toLowerCase();
      if (errMsg.includes('think') || errMsg.includes('enable_thinking')) {
        const body2 = { model, max_tokens:1024, temperature:0.7, messages:baseMessages };
        response = await axios.post(`${baseUrl}/chat/completions`, body2, { headers, timeout:30000 });
      } else throw firstErr;
    }
    let text = response.data?.choices?.[0]?.message?.content || '';
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text) text = 'Modelo não retornou resposta. Tente novamente.';
    res.json({ content:[{ type:'text', text }], model });
  } catch(err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ content:[{ type:'text', text:`Erro na API de IA: ${msg}` }] });
  }
});

// ─── Fear & Greed ──────────────────────────────────────────────────────────────
app.get('/api/feargreed', async (req, res) => {
  try {
    const r = await axios.get('https://api.alternative.me/fng/?limit=7', { timeout: 6000 });
    res.json(r.data);
  } catch {
    const val = 45 + (new Date().getDate() % 30);
    res.json({ data:[{ value: val.toString(), value_classification: val<45?'Fear':'Greed', timestamp: Math.floor(Date.now()/1000).toString() }] });
  }
});

// ─── Watchlist ─────────────────────────────────────────────────────────────────
app.get('/api/watchlist', requireAuth, (req, res) => {
  try {
    const rows = db.all('SELECT symbol FROM watchlist WHERE username=? ORDER BY added_at', [req.user]);
    res.json({ pairs: rows.map(r => r.symbol) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/watchlist', requireAuth, (req, res) => {
  try {
    const { pairs } = req.body || {};
    db.run('DELETE FROM watchlist WHERE username=?', [req.user]);
    (pairs||[]).forEach(sym => { try { db.insert('watchlist', { username: req.user, symbol: sym }); } catch {} });
    res.json({ ok: true, pairs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Alerts ────────────────────────────────────────────────────────────────────
app.get('/api/alerts', requireAuth, (req, res) => {
  try {
    const rows = db.all('SELECT * FROM alerts WHERE username=? ORDER BY created_at DESC', [req.user]);
    res.json(rows.map(r => ({ ...r, _id: r.id, triggered: !!r.triggered })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/alerts', requireAuth, (req, res) => {
  const { symbol, condition, price, note } = req.body;
  if (!symbol || !condition || !price) return res.status(400).json({ error: 'symbol, condition e price são obrigatórios' });
  try {
    const id = db.insert('alerts', { username: req.user, symbol, condition, price: parseFloat(price), note: note||'', triggered: 0 });
    res.json({ ok: true, _id: id, symbol, condition, price, note });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/alerts/:id', requireAuth, (req, res) => {
  try { db.remove('alerts', 'id=? AND username=?', [req.params.id, req.user]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/alerts/triggered', requireAuth, (req, res) => {
  try {
    const rows = db.all('SELECT * FROM alerts WHERE username=? AND triggered=1 ORDER BY triggered_at DESC LIMIT 20', [req.user]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', requireAuth, (req, res) => {
  try {
    const row = db.get('SELECT data FROM settings WHERE username=?', [req.user]);
    res.json({ ok: true, settings: row ? JSON.parse(row.data||'{}') : {} });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/settings', requireAuth, (req, res) => {
  try {
    const { settings } = req.body || {};
    if (!settings) return res.status(400).json({ ok: false, error: 'settings required' });
    const data   = JSON.stringify(settings);
    const exists = db.get('SELECT username FROM settings WHERE username=?', [req.user]);
    if (exists) db.run('UPDATE settings SET data=?, updated_at=datetime("now") WHERE username=?', [data, req.user]);
    else        db.insert('settings', { username: req.user, data });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Bot Config ────────────────────────────────────────────────────────────────
const BOT_ENV_PATH = process.env.BOT_ENV_PATH || './.bot.env';

app.get('/api/bot/config', requireAuth, (req, res) => {
  try {
    const raw = fs.existsSync(BOT_ENV_PATH) ? fs.readFileSync(BOT_ENV_PATH, 'utf8') : '';
    const cfg = {};
    raw.split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (m) cfg[m[1].trim()] = m[2].trim();
    });
    // FIX: nunca expor o secret no config do bot
    delete cfg['BINANCE_SECRET_KEY'];
    res.json({ ok: true, config: cfg, raw });
  } catch(e) { res.json({ ok: false, config: {}, raw: '' }); }
});

app.post('/api/bot/config', requireAuth, (req, res) => {
  try {
    const { config } = req.body;
    if (!config || typeof config !== 'object') return res.status(400).json({ ok: false, error: 'config required' });
    // FIX: sanitizar config — remover campos com caracteres perigosos
    const safe = {};
    for (const [k,v] of Object.entries(config)) {
      const ks = String(k).replace(/[^A-Z0-9_]/gi, '');
      const vs = String(v).replace(/[\r\n`$(){}|;&]/g, '');
      if (ks && vs !== undefined) safe[ks] = vs;
    }
    const lines = [
      '# CryptoEdge Pro — Bot config', '# ' + new Date().toLocaleString('pt-BR'), '',
      ...Object.entries(safe).map(([k,v]) => `${k}=${v}`)
    ];
    fs.writeFileSync(BOT_ENV_PATH, lines.join('\n') + '\n', 'utf8');
    res.json({ ok: true, path: BOT_ENV_PATH, saved: Object.keys(safe).length });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Bot Manager ──────────────────────────────────────────────────────────────
const BOT_LOG_FILE  = path.join(__dirname, 'gridbot.log');
const BOT_STATE_KEY = 'bot_autostart';   // chave no DB para persistir estado
let _botLogs   = [];
let _botStarting = false;  // mutex: evita duplo-start simultâneo

function _blog(line) {
  const e = '['+new Date().toLocaleString('pt-BR')+'] '+line;
  _botLogs.push(e);
  if (_botLogs.length > 500) _botLogs = _botLogs.slice(-300);
  try { fs.appendFileSync(BOT_LOG_FILE, e+'\n'); } catch {}
}

function _loadEnv(p) {
  const env = {...process.env};
  try { fs.readFileSync(p,'utf8').split('\n').forEach(l=>{const m=l.match(/^([^#=\s]+)\s*=\s*(.*)$/);if(m)env[m[1].trim()]=m[2].trim().replace(/^["']|["']$/g,'');}); } catch {}
  return env;
}

function _botPid() {
  try {
    const o = execSync('pgrep -f gridbot.py 2>/dev/null | head -1',
      {encoding:'utf8',timeout:2000,stdio:['pipe','pipe','pipe']});
    const p = parseInt(o.trim());
    return isNaN(p) ? null : p;
  } catch { return null; }
}

async function _killAll() {
  // Send graceful SIGTERM first
  try { execSync('pkill -SIGTERM -f gridbot.py 2>/dev/null || true',{timeout:3000}); } catch {}
  // Wait 3s for graceful shutdown (avoids killing newly spawned bot)
  await new Promise(r=>setTimeout(r,3000));
  // Force kill any remaining
  try { execSync('pkill -SIGKILL -f gridbot.py 2>/dev/null || true',{timeout:2000}); } catch {}
  // Extra buffer before spawning new process
  await new Promise(r=>setTimeout(r,1000));
}

// Lança Python totalmente desacoplado do Node (spawn nativo com detached:true)
// detached:true → novo process group (setsid interno do Node)
// unref()       → Node não espera o filho e não o inclui em seu process group
// Isso garante que o Python sobrevive a SIGTERM enviado ao Node/container
function _spawnDetached(env, botScript) {
  let fd;
  try { fd = fs.openSync(BOT_LOG_FILE, 'a'); } catch { fd = 'ignore'; }
  const child = spawn('python3', [botScript], {
    detached: true,
    stdio:    ['ignore', fd, fd],
    env:      env,
    cwd:      __dirname,
  });
  child.unref(); // Node não aguarda e não sinaliza este processo
  if (typeof fd === 'number') { try { fs.closeSync(fd); } catch {} }
  _blog(`🔧 spawn detached PID=${child.pid}`);
  return child.pid;
}

// Persiste flag de autostart na tabela platform_settings (key TEXT PK, value TEXT)
function _setBotAutostart(on) {
  try { db.run('INSERT OR REPLACE INTO platform_settings(key,value) VALUES(?,?)',[BOT_STATE_KEY, on?'1':'0']); } catch {}
}
function _getBotAutostart() {
  try { const r = db.get('SELECT value FROM platform_settings WHERE key=?',[BOT_STATE_KEY]); return r?.value==='1'; } catch { return false; }
}

app.get('/api/bot/status', requireAuth, (req, res) => {
  const pid = _botPid();
  // Read current strategy from .bot.env
  let currentStrategy = 'pattern';
  let currentTF = '15m';
  let currentTestnet = true;
  try {
    const envContent = require('fs').readFileSync(BOT_ENV_PATH, 'utf8');
    const match = (k) => (envContent.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1];
    if (match('BOT_STRATEGY')) currentStrategy = match('BOT_STRATEGY');
    if (match('BOT_TIMEFRAME')) currentTF = match('BOT_TIMEFRAME');
    if (match('BOT_TESTNET')) currentTestnet = match('BOT_TESTNET') !== 'false';
  } catch {}
  const shouldRun = _getBotAutostart();
  res.json({
    running:    pid!==null,
    status:     pid ? 'online' : (shouldRun ? 'restarting' : 'stopped'),
    pid:        pid ? String(pid) : null,
    mode:       'nativo',
    pm2_found:  false,
    starting:   _botStarting,
    should_run: shouldRun,
    strategy:   currentStrategy,
    timeframe:  currentTF,
    testnet:    currentTestnet,
  });
});

app.post('/api/bot/start', requireAuth, async (req, res) => {
  if (_botStarting) return res.status(429).json({ok:false,error:'Bot já está iniciando, aguarde.'});
  _botStarting = true;
  try {
    // ── Busca chaves do perfil; cai para variáveis de ambiente como fallback ──
    const user    = db.get('SELECT binance_key,binance_secret,binance_secret_enc,telegram_token,telegram_chatid FROM users WHERE username=?',[req.user]);
    const apiKey  = user?.binance_key || process.env.BINANCE_API_KEY || '';
    const secret  = user?.binance_secret_enc
      ? (decryptSecret(user.binance_secret_enc) || process.env.BINANCE_SECRET_KEY || '')
      : (user?.binance_secret || process.env.BINANCE_SECRET_KEY || '');
    if (!apiKey||!secret)
      return res.status(400).json({ok:false,error:'Configure suas chaves Binance em Meu Perfil antes de iniciar o bot.'});

    await _killAll();

    // ── Monta ambiente completo ───────────────────────────────────────────────
    const env = _loadEnv(path.resolve(BOT_ENV_PATH));
    env['BINANCE_API_KEY']    = apiKey;
    env['BINANCE_SECRET_KEY'] = secret;
    env['PYTHONUNBUFFERED']   = '1';
    env['PATH'] = env['PATH']||process.env.PATH||'/usr/local/bin:/usr/bin:/bin';
    env['HOME'] = env['HOME']||process.env.HOME||'/root';

    // Telegram: perfil do usuário tem prioridade sobre env vars do EasyPanel
    const tgToken  = user?.telegram_token  || process.env.TELEGRAM_TOKEN  || '';
    const tgChatId = user?.telegram_chatid || process.env.TELEGRAM_CHAT_ID || '';
    if (tgToken)  env['TELEGRAM_TOKEN']   = tgToken;
    if (tgChatId) env['TELEGRAM_CHAT_ID'] = tgChatId;
    env['APP_URL'] = process.env.APP_URL || `http://localhost:${process.env.PORT||3000}`;
    // ── Parâmetros vindos do frontend (Bot Control ou HFT Panel) ───────────────
    const body = req.body || {};
    // Estratégia e modo de trade
    if (body.strategy)   env['BOT_STRATEGY']   = body.strategy;
    if (body.timeframe)  env['BOT_TIMEFRAME']  = body.timeframe;
    env['BOT_TRADE_MODE'] = body.trade_mode || process.env.BOT_TRADE_MODE || 'manual';
    if (body.testnet !== undefined) env['BOT_TESTNET'] = String(body.testnet);
    if (body.capital)    env['BOT_CAPITAL']    = String(body.capital);
    if (body.symbol)     env['BOT_SYMBOL']     = body.symbol.toUpperCase();

    // HFT específicos
    if (body.hft_risk_pct)   env['HFT_RISK_PCT']   = String(body.hft_risk_pct);
    if (body.hft_tp_pct)     env['HFT_TP_PCT']      = String(body.hft_tp_pct);
    if (body.hft_sl_pct)     env['HFT_SL_PCT']      = String(body.hft_sl_pct);
    if (body.hft_cooldown)   env['HFT_COOLDOWN']    = String(body.hft_cooldown);
    if (body.hft_daily_loss) env['HFT_DAILY_LOSS']  = String(body.hft_daily_loss);
    if (body.hft_pairs)      env['HFT_PAIRS']       = body.hft_pairs;

    // ── Salva config efetiva para que restarts usem a mesma estratégia ──────────
    const cfgToSave = [
      '# CryptoEdge Pro — Bot config gerado automaticamente',
      '# ' + new Date().toLocaleString('pt-BR'), '',
    ];
    const botEnvKeys = ['BOT_STRATEGY','BOT_TIMEFRAME','BOT_TRADE_MODE','BOT_TESTNET',
      'BOT_CAPITAL','BOT_SYMBOL','BOT_STOP_LOSS','BOT_SESSION_GAIN','BOT_SESSION_LOSS',
      'BOT_MIN_CONF','BOT_SL_ATR','BOT_TP_RR','BOT_MARKET','BOT_TZ_OFFSET',
      'HFT_PAIRS','HFT_TIMEFRAME','HFT_TP_PCT','HFT_SL_PCT','HFT_RISK_PCT',
      'HFT_MAX_TRADES','HFT_COOLDOWN','HFT_DAILY_LOSS','HFT_MIN_SIGNALS',
      'BOT_SCAN_ENABLED','BOT_SCAN_PAIRS','BOT_SCAN_INTERVAL','BOT_SCAN_MIN_CONF',
    ];
    botEnvKeys.forEach(k => { if (env[k] !== undefined) cfgToSave.push(`${k}=${env[k]}`); });
    try { require('fs').writeFileSync(BOT_ENV_PATH, cfgToSave.join('\n') + '\n'); } catch {}

    // ── Lança Python com spawn nativo Node (detached:true + unref) ─────────────
    const botScript = path.join(__dirname,'bot','gridbot.py');
    _spawnDetached(env, botScript);

    // ── Aguarda até 8 s pelo PID ──────────────────────────────────────────────
    let pid = null;
    for (let i=0;i<16;i++) { await new Promise(r=>setTimeout(r,500)); pid=_botPid(); if(pid) break; }
    if (!pid) return res.status(500).json({ok:false,error:'Bot não iniciou em 8s. Verifique logs para erros Python.'});

    _blog('🚀 Bot iniciado (PID '+pid+')');
    _setBotAutostart(true);  // persiste: Node deve reiniciar o bot se restartar
    // Salva usuário atual para que o bot possa autenticar trades internos
    try { db.run('INSERT OR REPLACE INTO platform_settings(key,value) VALUES(?,?)',['bot_last_user', req.user]); } catch {}
    res.json({ok:true,message:'Bot iniciado',pid:String(pid)});
  } catch(e) {
    res.status(500).json({ok:false,error:'Erro: '+e.message.slice(0,200)});
  } finally {
    _botStarting = false;
  }
});

app.post('/api/bot/stop', requireAuth, async (req, res) => {
  _blog('🛑 Bot parado pelo usuário');
  _setBotAutostart(false);  // cancela autostart
  await _killAll();
  res.json({ok:true,message:'Bot parado'});
});

app.get('/api/bot/logs', requireAuth, (req, res) => {
  try {
    if (fs.existsSync(BOT_LOG_FILE)) {
      const l = fs.readFileSync(BOT_LOG_FILE,'utf8').trim().split('\n').filter(Boolean).slice(-100);
      if (l.length) return res.json({ok:true,lines:l});
    }
  } catch {}
  res.json({ok:true,lines:_botLogs.slice(-100)});
});

// ─── Backtesting ──────────────────────────────────────────────────────────────
app.post('/api/backtest', requireAuth, (req, res) => {
  const params  = req.body || {};
  const payload = JSON.stringify(params);
  const timeout = 120000;
  const isWin   = process.platform === 'win32';
  const pyCmd   = isWin ? 'python' : 'python3';
  const script  = path.join(__dirname, 'bot', 'backtest.py');
  execFile(pyCmd, [script, payload], { timeout, encoding:'utf8' }, (err, stdout, stderr) => {
    if (err) {
      let msg = stderr || err.message || 'Backtesting falhou';
      if (msg.includes("No module named 'binance'")) msg = 'Execute: pip install python-binance python-dotenv';
      else if (msg.includes('No module named'))      msg = 'Execute: pip install -r bot/requirements.txt';
      return res.status(500).json({ error: msg.slice(0,600) });
    }
    try { res.json(JSON.parse(stdout.trim())); }
    catch(e) { res.status(500).json({ error: 'Resposta inválida do Python: ' + stdout.slice(0,300) }); }
  });
});

// ─── PnL Chart ────────────────────────────────────────────────────────────────
app.get('/api/pnl/chart', requireAuth, (req, res) => {
  try {
    const range = req.query.range || 'week';
    const all   = db.all('SELECT * FROM trades WHERE username=? ORDER BY created_at ASC', [req.user]);
    if (!all.length) return res.json({ labels:[], data:[], cumulative:[], days:[] });
    const byDay = {};
    all.forEach(t => {
      const date = (t.created_at||'').split(',')[0].trim() || 'Unknown';
      if (!byDay[date]) byDay[date] = { pnl:0, trades:0, wins:0 };
      byDay[date].pnl += t.pnl||0; byDay[date].trades++; byDay[date].wins += t.result==='win'?1:0;
    });
    let days = Object.entries(byDay).map(([date,d]) => ({ date, ...d }));
    if (range==='week')  days = days.slice(-7);
    if (range==='month') days = days.slice(-30);
    const labels = days.map(d => d.date);
    const daily  = days.map(d => parseFloat((d.pnl||0).toFixed(2)));
    let cum = 0;
    const cumulative = daily.map(v => parseFloat((cum+=v).toFixed(2)));
    res.json({ labels, data:daily, cumulative, days });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Telegram Test ─────────────────────────────────────────────────────────────
app.post('/api/telegram/test', requireAuth, async (req, res) => {
  // Lê do perfil do usuário primeiro; cai para env var do EasyPanel
  const user   = db.get('SELECT telegram_token, telegram_chatid FROM users WHERE username=?', [req.user]);
  const token  = user?.telegram_token  || process.env.TELEGRAM_TOKEN  || '';
  const chatId = user?.telegram_chatid || process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chatId)
    return res.status(400).json({ ok: false, error: 'Configure o Bot Token e Chat ID em Meu Perfil → Notificações Telegram' });
  try {
    const r = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: '✅ <b>CryptoEdge Pro</b> — Telegram conectado com sucesso!\n\nVocê receberá notificações de trades aqui.',
      parse_mode: 'HTML'
    }, { timeout: 8000 });
    res.json({ ok: r.data.ok });
  } catch(e) { res.status(500).json({ ok: false, error: e.response?.data?.description || e.message }); }
});

// ─── Analysis AI ──────────────────────────────────────────────────────────────
app.post('/api/analysis', (req, res) => res.json({ run_client_side: true, params: req.body }));
app.post('/api/scanner', (req, res) => res.json({ run_client_side: true, params: req.body }));

app.post('/api/analysis/save', requireAuth, (req, res) => {
  try {
    const { symbol, timeframe, suggestion, techScore, smc, patterns, price } = req.body || {};
    const now = new Date();
    const id  = db.insert('analysis_history', {
      username: req.user, symbol, timeframe, price: price||0,
      suggestion: JSON.stringify(suggestion||{}),
      tech_score: techScore||0, smc_bias: smc||'',
      patterns: JSON.stringify(patterns||[]),
      outcome: 'pending',
      month: now.toISOString().slice(0,7),
      year:  now.getFullYear().toString(),
    });
    res.json({ ok: true, id });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.patch('/api/analysis/:id/outcome', requireAuth, (req, res) => {
  try {
    const { outcome, outcomePrice, pnlPct } = req.body || {};
    db.run('UPDATE analysis_history SET outcome=?, outcome_price=?, pnl_pct=?, closed_at=datetime("now") WHERE id=? AND username=?',
      [outcome, outcomePrice||null, pnlPct||null, req.params.id, req.user]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/analysis/history', requireAuth, (req, res) => {
  try {
    const { period } = req.query;
    let sql = 'SELECT * FROM analysis_history WHERE username=?';
    const params = [req.user];
    if (period && period.length===7) { sql += ' AND month=?'; params.push(period); }
    if (period && period.length===4) { sql += ' AND year=?';  params.push(period); }
    sql += ' ORDER BY created_at DESC';
    const all = db.all(sql, params).map(r => ({
      ...r, _id: r.id,
      suggestion: JSON.parse(r.suggestion||'{}'),
      patterns:   JSON.parse(r.patterns||'[]'),
    }));
    const withOutcome = all.filter(a => a.outcome && a.outcome!=='pending');
    const wins     = withOutcome.filter(a => a.outcome==='win').length;
    const losses   = withOutcome.filter(a => a.outcome==='loss').length;
    const pending  = all.filter(a => !a.outcome || a.outcome==='pending').length;
    const accuracy = withOutcome.length > 0 ? Math.round(wins/withOutcome.length*100) : null;
    const avgPnl   = withOutcome.length > 0 ? Math.round(withOutcome.reduce((s,a)=>s+(a.pnl_pct||0),0)/withOutcome.length*100)/100 : 0;
    const byMonth = {};
    all.forEach(a => {
      const m = a.month||'unknown';
      if (!byMonth[m]) byMonth[m] = { month:m, total:0, wins:0, losses:0, pending:0, pnlSum:0 };
      byMonth[m].total++;
      if (a.outcome==='win')  { byMonth[m].wins++;   byMonth[m].pnlSum+=(a.pnl_pct||0); }
      if (a.outcome==='loss') { byMonth[m].losses++; byMonth[m].pnlSum+=(a.pnl_pct||0); }
      if (!a.outcome||a.outcome==='pending') byMonth[m].pending++;
    });
    const monthlyBreakdown = Object.values(byMonth).sort((a,b)=>b.month.localeCompare(a.month))
      .map(m => ({ ...m, accuracy: m.wins+m.losses>0?Math.round(m.wins/(m.wins+m.losses)*100):null, pnlSum:Math.round(m.pnlSum*100)/100 }));
    const symMap = {};
    withOutcome.forEach(a => {
      if (!symMap[a.symbol]) symMap[a.symbol] = { symbol:a.symbol, total:0, wins:0, losses:0 };
      symMap[a.symbol].total++;
      if (a.outcome==='win')  symMap[a.symbol].wins++;
      if (a.outcome==='loss') symMap[a.symbol].losses++;
    });
    const symbolStats = Object.values(symMap).sort((a,b)=>b.total-a.total).slice(0,10)
      .map(s => ({ ...s, accuracy: s.total>0?Math.round(s.wins/s.total*100):null }));
    res.json({ ok:true, stats:{ total:all.length, withOutcome:withOutcome.length, wins, losses, pending, accuracy, avgPnl }, monthlyBreakdown, symbolStats, history:all.slice(0,50) });
  } catch(e) { res.status(500).json({ ok:false, error: e.message }); }
});

app.get('/api/analysis/periods', requireAuth, (req, res) => {
  try {
    const months = db.all('SELECT DISTINCT month FROM analysis_history WHERE username=? ORDER BY month DESC', [req.user]).map(r=>r.month).filter(Boolean);
    const years  = db.all('SELECT DISTINCT year  FROM analysis_history WHERE username=? ORDER BY year  DESC', [req.user]).map(r=>r.year).filter(Boolean);
    res.json({ ok:true, months, years });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/analysis/auto-track', requireAuth, async (req, res) => {
  try {
    const pending = db.all("SELECT * FROM analysis_history WHERE username=? AND outcome='pending' AND created_at > datetime('now','-7 days') ORDER BY created_at DESC LIMIT 20", [req.user]);
    if (!pending.length) return res.json({ ok: true, updated: 0 });
    const symbols = [...new Set(pending.map(a => a.symbol.replace('/','').replace('-','') + 'USDT'))];
    const updates = [];
    await Promise.allSettled(symbols.map(async sym => {
      try {
        const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { params: { symbol: sym }, timeout:5000 });
        const currentPrice = parseFloat(r.data.lastPrice);
        pending.filter(a => a.symbol.includes(sym.replace('USDT',''))).forEach(a => {
          const sg = JSON.parse(a.suggestion || '{}');
          const dir = sg.direction; const entry = a.price;
          if (!entry || !dir || dir==='flat') return;
          const pnlPct = dir==='long' ? ((currentPrice-entry)/entry)*100 : ((entry-currentPrice)/entry)*100;
          let outcome = 'pending';
          if (pnlPct >= 2.0)  outcome = 'win';
          if (pnlPct <= -1.5) outcome = 'loss';
          if (outcome !== 'pending') {
            db.run('UPDATE analysis_history SET outcome=?, outcome_price=?, pnl_pct=?, closed_at=datetime("now") WHERE id=? AND username=?',
              [outcome, currentPrice, Math.round(pnlPct*100)/100, a.id, req.user]);
            updates.push({ id: a.id, symbol: a.symbol, outcome, pnlPct: Math.round(pnlPct*100)/100 });
          }
        });
      } catch {}
    }));
    res.json({ ok: true, updated: updates.length, updates });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analysis/pnl-stats', requireAuth, (req, res) => {
  try {
    const { period } = req.query;
    let sinceDate = '';
    if (period==='week')  sinceDate = "AND created_at > datetime('now','-7 days')";
    if (period==='month') sinceDate = "AND created_at > datetime('now','-30 days')";
    if (period==='year')  sinceDate = "AND created_at > datetime('now','-365 days')";
    const all    = db.all(`SELECT * FROM analysis_history WHERE username=? ${sinceDate} ORDER BY created_at DESC`, [req.user]);
    const closed = all.filter(a => a.outcome && a.outcome!=='pending');
    const wins   = closed.filter(a => a.outcome==='win');
    const losses = closed.filter(a => a.outcome==='loss');
    const pnlSum = closed.reduce((s,a) => s+(a.pnl_pct||0), 0);
    const avgPnl = closed.length ? pnlSum/closed.length : 0;
    const bestWin  = wins.length   ? Math.max(...wins.map(a=>a.pnl_pct||0))   : 0;
    const worstLoss= losses.length ? Math.min(...losses.map(a=>a.pnl_pct||0)) : 0;
    const bySymbol = {};
    closed.forEach(a => {
      if (!bySymbol[a.symbol]) bySymbol[a.symbol] = { symbol:a.symbol, trades:0, wins:0, losses:0, pnl:0 };
      bySymbol[a.symbol].trades++;
      if (a.outcome==='win')  { bySymbol[a.symbol].wins++;  bySymbol[a.symbol].pnl+=(a.pnl_pct||0); }
      if (a.outcome==='loss') { bySymbol[a.symbol].losses++; bySymbol[a.symbol].pnl+=(a.pnl_pct||0); }
    });
    const dailyPnl = {};
    closed.forEach(a => {
      const day = (a.closed_at||a.created_at||'').slice(0,10);
      if (!dailyPnl[day]) dailyPnl[day] = { day, pnl:0, wins:0, losses:0 };
      dailyPnl[day].pnl += (a.pnl_pct||0);
      if (a.outcome==='win')  dailyPnl[day].wins++;
      if (a.outcome==='loss') dailyPnl[day].losses++;
    });
    res.json({
      ok: true, period: period||'all',
      summary: { total:all.length, closed:closed.length, pending:all.length-closed.length,
        wins:wins.length, losses:losses.length,
        accuracy: closed.length ? Math.round(wins.length/closed.length*100) : null,
        pnlSum: Math.round(pnlSum*100)/100, avgPnl: Math.round(avgPnl*100)/100,
        bestWin: Math.round(bestWin*100)/100, worstLoss: Math.round(worstLoss*100)/100 },
      bySymbol: Object.values(bySymbol).sort((a,b)=>b.pnl-a.pnl)
        .map(s => ({ ...s, accuracy: Math.round(s.wins/(s.trades||1)*100), pnl: Math.round(s.pnl*100)/100 })),
      dailyPnl: Object.values(dailyPnl).sort((a,b)=>a.day.localeCompare(b.day))
        .map(d => ({ ...d, pnl: Math.round(d.pnl*100)/100 })),
      recentSignals: all.slice(0,20)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Performance Report Export ────────────────────────────────────────────────
app.get('/api/report/json', requireAuth, (req, res) => {
  try {
    const all      = db.all('SELECT * FROM trades WHERE username=? ORDER BY created_at DESC', [req.user]);
    const wins     = all.filter(t=>t.result==='win').length;
    const losses   = all.filter(t=>t.result==='loss').length;
    const totalPnl = all.reduce((s,t)=>s+(t.pnl||0), 0);
    res.json({
      generated: new Date().toISOString(), user: req.user,
      summary: { total:all.length, wins, losses, winRate: all.length?((wins/all.length)*100).toFixed(1)+'%':'0%', totalPnl: totalPnl.toFixed(2), avgPnl: all.length?(totalPnl/all.length).toFixed(2):'0' },
      trades: all.map(t => ({ ...t, _id: t.id }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Admin Routes ──────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = db.all('SELECT id,username,email,role,plan,status,created_at,last_login FROM users ORDER BY created_at DESC');
    res.json({ ok: true, users, total: users.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
  try {
    const { status, plan, role } = req.body || {};
    const updates = {};
    if (status !== undefined) updates.status = status;
    if (plan   !== undefined) updates.plan   = plan;
    if (role   !== undefined) updates.role   = role;
    db.update('users', updates, 'username=?', [req.params.username]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
  try {
    if (req.params.username === req.user) return res.status(400).json({ error: 'Não pode deletar a si mesmo' });
    db.run('DELETE FROM users WHERE username=?', [req.params.username]);
    db.run('DELETE FROM sessions WHERE username=?', [req.params.username]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Generate invite link ────────────────────────────────────────────────────
app.post('/api/admin/invite/link', requireAuth, requireAdmin, (req, res) => {
  try {
    const { plan='pro', maxUses=1, expireDays=7, email='' } = req.body;
    const code = require('crypto').randomBytes(5).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + expireDays*86400000).toISOString().replace('T',' ').slice(0,19);
    db.run('INSERT INTO invite_codes(code,created_by,max_uses,plan,expires_at) VALUES(?,?,?,?,?)',
      [code, req.user, maxUses, plan, expiresAt]);
    const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT||3000}`;
    const link = `${baseUrl}/?invite=${code}`;
    // Send email if provided
    if (email) {
      const { sendInviteEmail } = require('./templates/email');
      const emailTransporter = require('nodemailer').createTransport({
        host: process.env.SMTP_HOST||'smtp.gmail.com', port: parseInt(process.env.SMTP_PORT||'587'),
        secure: process.env.SMTP_SECURE==='true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      emailTransporter.sendMail({
        from: process.env.SMTP_USER, to: email,
        subject: 'Seu convite para o CryptoEdge Pro',
        html: `<h2>Você foi convidado!</h2><p>Clique para criar sua conta:</p><a href="${link}" style="background:#F0B90B;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Acessar CryptoEdge Pro</a><p>Código: <b>${code}</b></p><p>Expira em ${expireDays} dias | Plano: ${plan.toUpperCase()}</p>`
      }).catch(()=>{});
    }
    res.json({ ok:true, code, link, plan, expires_at:expiresAt });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/admin/invite', requireAuth, requireAdmin, (req, res) => {
  try {
    const { plan='basic', maxUses=1, expiresInDays=30 } = req.body || {};
    const code      = crypto.randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now()+(expiresInDays||30)*24*60*60*1000).toISOString();
    db.run('INSERT INTO invite_codes (code,created_by,max_uses,plan,expires_at) VALUES (?,?,?,?,?)', [code, req.user, maxUses, plan, expiresAt]);
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT||3000}`;
    res.json({ ok: true, code, plan, maxUses, expiresAt });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/invites', requireAuth, requireAdmin, (req, res) => {
  try { res.json({ ok: true, codes: db.all('SELECT * FROM invite_codes ORDER BY created_at DESC LIMIT 50') }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/invites/:code', requireAuth, requireAdmin, (req, res) => {
  try { db.run('DELETE FROM invite_codes WHERE code=?', [req.params.code]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  try {
    const rows = db.all('SELECT * FROM platform_settings');
    res.json({ ok: true, settings: Object.fromEntries(rows.map(r=>[r.key,r.value])) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  try {
    const { settings } = req.body || {};
    Object.entries(settings||{}).forEach(([k,v]) => {
      db.run('INSERT OR REPLACE INTO platform_settings (key,value,updated_at) VALUES (?,?,datetime("now"))', [k, String(v)]);
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  try {
    res.json({ ok:true, users:db.count('users'), active:db.count('users',"status='active'"), admins:db.count('users',"role='admin'"), trades:db.count('trades'), analyses:db.count('analysis_history'), invites:db.count('invite_codes') });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/invite-email', requireAuth, requireAdmin, (req, res) => {
  const { toEmail, code, plan, expiresAt } = req.body || {};
  if (!toEmail || !code) return res.status(400).json({ error: 'E-mail e código obrigatórios' });
  const platformName = db.get("SELECT value FROM platform_settings WHERE key='platform_name'")?.value || 'CryptoEdge Pro';
  const expDate = expiresAt ? new Date(expiresAt).toLocaleDateString('pt-BR') : '30 dias';
  sendMail({ to: toEmail, subject: 'Você foi convidado — ' + platformName, html: emailTpls.invite(req.user, code, platformName, plan, expDate) })
    .then(() => res.json({ ok: true })).catch(e => res.status(500).json({ error: e.message }));
});

// ─── Webhook MT5/ProfitChart (FIX: usa webhook_token dedicado) ─────────────────
app.post('/api/webhook/signal', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (!apiKey) return res.status(401).json({ error: 'x-api-key header required' });
  try {
    // FIX: autenticar por webhook_token dedicado (não mais pela binance_key)
    const user = db.get('SELECT * FROM users WHERE webhook_token=?', [apiKey]);
    if (!user) return res.status(401).json({ error: 'Invalid webhook token' });
    const { symbol, direction, entry, exit, size, leverage, pnl, pnl_pct, result, reason } = req.body || {};
    if (!symbol || !direction) return res.status(400).json({ error: 'symbol and direction required' });
    const id = db.insert('trades', {
      username:   user.username,
      pair:       symbol.replace('USDT','').replace('USD','')+'/USDT',
      direction:  direction==='BUY'||direction==='Long' ? 'Long' : 'Short',
      entry:      parseFloat(entry)||0, exit: exit ? parseFloat(exit) : null,
      size:       parseFloat(size)||0, leverage: leverage ? leverage+'x' : '1x',
      reason:     reason || 'Sinal MT5/ProfitChart',
      result:     result || (exit ? (pnl>0?'win':'loss') : 'pending'),
      pnl:        parseFloat(pnl)||0, pnl_pct: parseFloat(pnl_pct)||0,
      created_at: new Date().toLocaleString('pt-BR')
    }, true);
    res.json({ ok: true, id, message: 'Trade registrado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/webhook/signals', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (!apiKey) return res.status(401).json({ error: 'x-api-key header required' });
  try {
    const user = db.get('SELECT * FROM users WHERE webhook_token=?', [apiKey]);
    if (!user) return res.status(401).json({ error: 'Invalid webhook token' });
    const since = req.query.since || new Date(Date.now()-60000).toISOString();
    const signals = db.all("SELECT * FROM analysis_history WHERE username=? AND created_at > ? AND outcome='pending' ORDER BY created_at DESC LIMIT 10", [user.username, since]);
    res.json({ ok: true, signals: signals.map(s => ({ id:s.id, symbol:s.symbol.replace('/',''), timeframe:s.timeframe, price:s.price, suggestion:JSON.parse(s.suggestion||'{}'), created_at:s.created_at })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/webhook/my-key', requireAuth, (req, res) => {
  try {
    const user = db.get('SELECT webhook_token, username FROM users WHERE username=?', [req.user]);
    if (!user.webhook_token) {
      const wt = genToken();
      db.run('UPDATE users SET webhook_token=? WHERE username=?', [wt, req.user], true);
      user.webhook_token = wt;
    }
    const webhook = (process.env.APP_URL || 'http://localhost:3000') + '/api/webhook/signal';
    res.json({ ok:true, webhook_token: user.webhook_token, webhook_url: webhook, instructions: 'Use x-api-key: SEU_WEBHOOK_TOKEN (gerado em Meu Perfil)' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── PM2 Diagnostic ───────────────────────────────────────────────────────────
app.get('/api/bot/pm2-check', requireAuth, requireAdmin, (req, res) => {
  const results = {};
  const cmds = process.platform==='win32'
    ? ['pm2 --version','npx pm2 --version']
    : ['pm2 --version','npx pm2 --version',(process.env.HOME||'')+'/.npm-global/bin/pm2 --version','/usr/local/bin/pm2 --version','/usr/bin/pm2 --version'];
  let found = false;
  for (const cmd of cmds) {
    try { results[cmd] = 'OK — v' + execSync(cmd, { encoding:'utf8', timeout:3000 }).trim().split('\n').pop(); found=true; break; }
    catch(e) { results[cmd] = 'FAIL: ' + e.message.slice(0,80); }
  }
  res.json({ platform: process.platform, pm2_found: found, node_version: process.version, cwd: process.cwd(), results });
});

// ─── Email System ──────────────────────────────────────────────────────────────
function getMailer() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host, port: parseInt(process.env.SMTP_PORT||'587'),
    secure: process.env.SMTP_SECURE==='true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendMail({ to, subject, html }) {
  const mailer = getMailer();
  if (!mailer) { console.log('[EMAIL] SMTP not configured — skip:', subject); return; }
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || '"CryptoEdge Pro" <no-reply@cryptoedge.pro>', to, subject, html });
    console.log('[EMAIL] Sent:', subject, '->', to);
  } catch(e) { console.error('[EMAIL] Error:', e.message); }
}

// ─── Live Trading State ───────────────────────────────────────────────────────
const _liveState = {
  enabled:    false,
  pair:       'BTCUSDT',
  strategy:   'pattern',
  position:   null,      // { side, entry, sl, tp, qty, openedAt }
  session:    { trades:0, wins:0, losses:0, pnl:0, startedAt: null },
  feed:       [],        // últimos 50 eventos
  lastNarration: '',
  lastCandle: null,
};

function _pushLiveFeed(event) {
  _liveState.feed.unshift({ ...event, ts: new Date().toISOString() });
  if (_liveState.feed.length > 100) _liveState.feed = _liveState.feed.slice(0, 100);
}

// Public endpoint — sem auth (para link público)
app.get('/live', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live.html'));
});

// Live state API — público (só leitura, sem dados sensíveis)
app.get('/api/live/state', (req, res) => {
  // Narration fallback: se bot está rodando mas sem texto de IA, mostra status básico
  const narrationText = _liveState.lastNarration ||
    (_liveState.enabled ? `Monitorando ${_liveState.pair} — estratégia ${(_liveState.strategy||'').toUpperCase()}. Aguardando sinal...` : '');
  res.json({
    ok:       true,
    enabled:  _liveState.enabled,
    pair:     _liveState.pair,
    strategy: _liveState.strategy,
    position: _liveState.position,
    session:  _liveState.session,
    feed:     _liveState.feed.slice(0, 30),
    narration: narrationText,
    ts:       new Date().toISOString(),
  });
});

// Bot posts events to live state (called internally by bot webhook or analysis save)
app.post('/api/live/event', requireAuth, (req, res) => {
  try {
    const { type, data } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type required' });

    switch (type) {
      case 'bot_started':
        _liveState.enabled    = true;
        _liveState.pair       = data.pair     || _liveState.pair;
        _liveState.strategy   = data.strategy || _liveState.strategy;
        _liveState.session    = { trades:0, wins:0, losses:0, pnl:0, startedAt: new Date().toISOString() };
        _liveState.lastNarration = `Bot iniciado — ${(data.strategy||'pattern').toUpperCase()} em ${data.pair||'BTCUSDT'}. Monitorando mercado em tempo real...`;
        _pushLiveFeed({ type, label: '🚀 Bot iniciado', detail: `${data.strategy} | ${data.pair}`, color: 'green' });
        break;
      case 'bot_stopped':
        _liveState.enabled  = false;
        _liveState.position = null;
        _pushLiveFeed({ type, label: '🛑 Bot parado', detail: `PnL sessão: $${(_liveState.session.pnl||0).toFixed(2)}`, color: 'gray' });
        break;
      case 'position_open':
        _liveState.position = { ...data, openedAt: new Date().toISOString() };
        _pushLiveFeed({ type, label: data.side === 'BUY' ? '🟢 Long aberto' : '🔴 Short aberto', detail: `${data.pair} @ $${parseFloat(data.entry).toFixed(2)} | SL $${parseFloat(data.sl).toFixed(2)} | TP $${parseFloat(data.tp).toFixed(2)}`, color: data.side==='BUY'?'green':'red' });
        break;
      case 'position_close':
        _liveState.position = null;
        const pnl = parseFloat(data.pnl) || 0;
        _liveState.session.trades++;
        _liveState.session.pnl += pnl;
        if (pnl >= 0) _liveState.session.wins++; else _liveState.session.losses++;
        _pushLiveFeed({ type, label: pnl >= 0 ? '✅ Trade fechado — WIN' : '❌ Trade fechado — LOSS', detail: `${data.reason} | PnL: ${pnl>=0?'+':''}$${pnl.toFixed(2)}`, color: pnl>=0?'green':'red' });
        break;
      case 'signal':
        _pushLiveFeed({ type, label: `📡 Sinal: ${data.direction?.toUpperCase()}`, detail: `${data.pattern} | conf=${data.confidence}% | ${data.pair}`, color: data.direction==='up'?'green':'red' });
        break;
      case 'candle':
        _liveState.lastCandle = data;
        _pushLiveFeed({ type, label: `🕯 Vela ${data.timeframe}`, detail: `O:${data.open} H:${data.high} L:${data.low} C:${data.close}`, color: parseFloat(data.close)>=parseFloat(data.open)?'green':'red' });
        break;
      case 'narration':
        _liveState.lastNarration = data.text || '';
        _pushLiveFeed({ type, label: '🤖 IA', detail: data.text?.slice(0,120), color: 'gold' });
        break;
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Generate live narration from current state
app.post('/api/live/narrate', requireAuth, async (req, res) => {
  const apiKey  = process.env.LAOZHANG_API_KEY;
  const baseUrl = process.env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1';
  const model   = process.env.AI_MODEL || 'qwen3-30b-a3b';
  if (!apiKey) return res.json({ ok: false, text: 'IA não configurada.' });

  const { candle, patterns, prediction, position, session } = req.body || {};
  const prompt = `Você é um trader profissional narrando ao vivo. Seja direto e objetivo em 2-3 frases curtas.
Par: ${_liveState.pair} | Estratégia: ${_liveState.strategy}
Vela atual: ${JSON.stringify(candle||{})}
Padrões: ${JSON.stringify(patterns||[])}
Predição: ${JSON.stringify(prediction||{})}
Posição: ${position ? JSON.stringify(position) : 'sem posição aberta'}
Sessão: ${session?.trades||0} trades | WR: ${session?.trades>0?Math.round((session.wins/session.trades)*100):0}% | PnL: $${(session?.pnl||0).toFixed(2)}
Narre o que está acontecendo agora de forma objetiva, como um comentarista de trading ao vivo.`;

  try {
    const r = await axios.post(`${baseUrl}/chat/completions`, {
      model, max_tokens: 150, temperature: 0.6,
      messages: [{ role:'user', content: prompt }],
      ...(model.toLowerCase().includes('qwen3') ? { enable_thinking:false } : {})
    }, { headers: { Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' }, timeout:15000 });

    let text = r.data?.choices?.[0]?.message?.content || '';
    text = text.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
    _liveState.lastNarration = text;
    _pushLiveFeed({ type:'narration', label:'🤖 IA', detail: text.slice(0,120), color:'gold' });
    res.json({ ok: true, text });
  } catch(e) {
    res.json({ ok: false, text: 'Erro na narração: ' + (e.message||'').slice(0,60) });
  }
});


// ─── Signal Subscriptions ──────────────────────────────────────────────────────

// Função central: envia sinal para TODOS os usuários com signals_enabled=1
async function broadcastSignal(signal) {
  try {
    const subs = db.all(
      "SELECT username, telegram_token, telegram_chatid FROM users " +
      "WHERE signals_enabled=1 AND status='active' " +
      "AND telegram_token != '' AND telegram_chatid != ''"
    );
    if (!subs.length) return 0;

    const { symbol, direction, confidence, patterns=[], rsi=0, target_pct=0,
            price=0, sl=0, tp=0, side='', source='scanner' } = signal;

    const dir_text = direction === 'up' ? '🔼 ALTA' : (direction === 'down' ? '🔽 BAIXA' : '➡️ NEUTRO');
    const bar = (pct, n=10) => '█'.repeat(Math.min(n,Math.round(pct/100*n))) + '░'.repeat(Math.max(0,n-Math.min(n,Math.round(pct/100*n))));
    const sep = '―'.repeat(26);
    const ts  = new Date().toLocaleString('pt-BR');
    const src_label = source === 'scanner' ? '🔭 Scanner Multi-Par' : '🤖 Bot Principal';
    const sl_pct = sl && price ? Math.abs((sl-price)/price*100).toFixed(1) : null;
    const tp_pct = tp && price ? Math.abs((tp-price)/price*100).toFixed(1) : null;
    const rr     = sl_pct && tp_pct ? (parseFloat(tp_pct)/parseFloat(sl_pct)).toFixed(1) : null;

    let sent = 0;
    for (const sub of subs) {
      try {
        const markup = side ? {
          inline_keyboard: [[
            { text: '✅  ENTRAR AGORA', callback_data: `ce_${sub.username}_${Date.now()}:confirm` },
            { text: '❌  IGNORAR',      callback_data: `ce_${sub.username}_${Date.now()}:ignore`  },
          ]]
        } : null;

        const text = [
          `📡 <b>Sinal ${dir_text} — ${symbol}</b>`,
          `<i>${src_label}</i>`,
          sep,
          price ? `💲 Preço:      <code>$${parseFloat(price).toLocaleString('en-US',{minimumFractionDigits:2})}</code>` : null,
          sl    ? `🛡 Stop Loss:  <code>$${parseFloat(sl).toFixed(2)}</code>${sl_pct ? `  <i>(-${sl_pct}%)</i>` : ''}` : null,
          tp    ? `🎯 Take Profit:<code>$${parseFloat(tp).toFixed(2)}</code>${tp_pct ? `  <i>(+${tp_pct}%)</i>` : ''}` : null,
          rr    ? `⚖️ R/R Ratio:  <code>1 : ${rr}</code>` : null,
          sep,
          `📡 Confiança:  ${bar(confidence*100)} ${(confidence*100).toFixed(0)}%`,
          patterns.length ? `🔍 Padrão:    <i>${patterns.slice(0,2).join(', ')}</i>` : null,
          rsi   ? `📊 RSI:       <code>${parseFloat(rsi).toFixed(0)}</code>` : null,
          target_pct ? `🎯 Alvo:      <code>${parseFloat(target_pct)>0?'+':''}${parseFloat(target_pct).toFixed(1)}%</code>` : null,
          sep,
          side ? `⏳ <i>Responda em até 90s</i>` : `<i>Sinal informativo — ${ts}</i>`,
        ].filter(Boolean).join('\n');

        const payload = { chat_id: sub.telegram_chatid, text, parse_mode: 'HTML' };
        if (markup) payload.reply_markup = markup;

        await axios.post(
          `https://api.telegram.org/bot${sub.telegram_token}/sendMessage`,
          payload, { timeout: 8000 }
        );
        sent++;
      } catch(e) {
        console.warn(`[Signal] Falha ao enviar para ${sub.username}: ${e.message?.slice(0,60)}`);
      }
    }
    return sent;
  } catch(e) {
    console.error('[broadcastSignal] Erro:', e.message);
    return 0;
  }
}

// GET /api/signals/status — usuário vê se está inscrito
app.get('/api/signals/status', requireAuth, (req, res) => {
  try {
    const user = db.get(
      'SELECT signals_enabled, signals_plan, telegram_token, telegram_chatid FROM users WHERE username=?',
      [req.user]
    );
    res.json({
      ok: true,
      enabled:  !!user?.signals_enabled,
      plan:     user?.signals_plan || 'free',
      has_telegram: !!(user?.telegram_token && user?.telegram_chatid),
    });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/signals/subscribe — usuário ativa/desativa recebimento
app.post('/api/signals/subscribe', requireAuth, (req, res) => {
  try {
    const { enabled } = req.body || {};
    const user = db.get('SELECT telegram_token, telegram_chatid FROM users WHERE username=?', [req.user]);
    if (enabled && (!user?.telegram_token || !user?.telegram_chatid))
      return res.status(400).json({ ok: false, error: 'Configure seu Telegram em Meu Perfil antes de ativar os sinais.' });
    db.run('UPDATE users SET signals_enabled=? WHERE username=?', [enabled ? 1 : 0, req.user]);
    res.json({ ok: true, enabled: !!enabled });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/signals/broadcast — bot Python chama este endpoint para distribuir sinais
// Autenticado pelo ADMIN_SIGNAL_TOKEN (env var) para que o Python não precise de sessão
app.post('/api/signals/broadcast', async (req, res) => {
  const token = req.headers['x-signal-token'] || '';
  const expected = process.env.ADMIN_SIGNAL_TOKEN || '';
  // Fallback: aceita do localhost sem token (bot na mesma máquina)
  const fromLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!fromLocal && expected && token !== expected)
    return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    const signal = req.body || {};
    const sent   = await broadcastSignal(signal);
    // Também atualiza live state
    _pushLiveFeed({ type: 'signal',
      label: `📡 Sinal: ${(signal.direction==='up'?'🔼':'🔽')} ${signal.symbol}`,
      detail: `conf=${Math.round(signal.confidence*100)}% | ${(signal.patterns||[]).join(', ')}`,
      color: signal.direction==='up' ? 'green' : 'red'
    });
    res.json({ ok: true, sent });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PATCH /api/admin/users/:username/signals — admin controla acesso de cada usuário
app.patch('/api/admin/users/:username/signals', requireAuth, requireAdmin, (req, res) => {
  try {
    const { enabled, plan } = req.body || {};
    const updates = {};
    if (enabled !== undefined) updates.signals_enabled = enabled ? 1 : 0;
    if (plan    !== undefined) updates.signals_plan    = plan;
    db.update('users', updates, 'username=?', [req.params.username]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /api/admin/signals/subscribers — admin vê quem está inscrito
app.get('/api/admin/signals/subscribers', requireAuth, requireAdmin, (req, res) => {
  try {
    const subs = db.all(
      "SELECT username, email, signals_plan, signals_enabled, " +
      "CASE WHEN telegram_chatid != '' THEN 1 ELSE 0 END as has_telegram " +
      "FROM users WHERE status='active' ORDER BY signals_enabled DESC, username"
    );
    res.json({ ok: true, subscribers: subs, total_active: subs.filter(s=>s.signals_enabled).length });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});


// ─── Bot internal auth (bot process calls these from localhost) ─────────────
function requireBotOrAuth(req, res, next) {
  // Accept internal bot calls with special header
  if (req.headers['x-bot-internal'] === 'cryptoedge-bot-2024') {
    // Identify the user from bot process env (stored in platform_settings)
    try {
      const botUser = db.get("SELECT value FROM platform_settings WHERE key='bot_last_user'");
      req.user = botUser?.value || 'admin';
    } catch { req.user = 'admin'; }
    return next();
  }
  // Fall back to regular auth
  return requireAuth(req, res, next);
}

// ─── Bot Live Trades (equity curve ao vivo) ───────────────────────────────────
app.post('/api/bot/trade/open', requireBotOrAuth, (req, res) => {
  try {
    const { symbol: rawSymbol, pair, side, entry, qty, sl, tp, strategy } = req.body;
    const symbol = rawSymbol || pair || 'UNKNOWN';
    const id = db.insert('bot_trades', {
      username: req.user, symbol, side, entry: parseFloat(entry),
      qty: parseFloat(qty), sl: parseFloat(sl||0), tp: parseFloat(tp||0),
      strategy: strategy||'', status: 'open'
    });
    res.json({ ok: true, id });
    // Broadcast to copy followers (async, non-blocking)
    _broadcastCopyTrade(req.user, { ...req.body, id }).catch(()=>{});
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/bot/trade/close', requireBotOrAuth, (req, res) => {
  try {
    const { id, exit_price, pnl, reason } = req.body;
    db.run(
      "UPDATE bot_trades SET exit_price=?,pnl=?,reason=?,status='closed',closed_at=datetime('now') WHERE id=? AND username=?",
      [parseFloat(exit_price), parseFloat(pnl), reason||'', id, req.user], true
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/bot/equity', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days||'30');
    const trades = db.all(
      `SELECT * FROM bot_trades WHERE username=? AND status='closed' AND closed_at >= datetime('now',?) ORDER BY closed_at ASC`,
      [req.user, `-${days} days`]
    );
    if (!trades.length) return res.json({ ok:true, equity:[], stats:{pnl:0,wins:0,losses:0,wr:0,maxDD:0,trades:0} });
    let cum=0, peak=0, maxDD=0;
    const equity = trades.map(t => {
      cum += (t.pnl||0);
      if (cum > peak) peak = cum;
      const dd = peak - cum; if (dd > maxDD) maxDD = dd;
      return { ts: t.closed_at, pnl: parseFloat((t.pnl||0).toFixed(2)), cumPnl: parseFloat(cum.toFixed(2)), symbol: t.symbol, side: t.side };
    });
    const wins = trades.filter(t => (t.pnl||0) >= 0).length;
    res.json({ ok:true, equity, stats:{ pnl: parseFloat(cum.toFixed(2)), wins, losses: trades.length-wins,
      wr: trades.length > 0 ? Math.round(wins/trades.length*100) : 0, maxDD: parseFloat(maxDD.toFixed(2)), trades: trades.length }});
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── Paper Trading ─────────────────────────────────────────────────────────────
app.get('/api/paper/account', requireAuth, (req, res) => {
  try {
    let acc = db.get('SELECT * FROM paper_accounts WHERE username=?', [req.user]);
    if (!acc) {
      db.run('INSERT OR IGNORE INTO paper_accounts(username,balance,initial) VALUES(?,1000,1000)', [req.user], true);
      acc = db.get('SELECT * FROM paper_accounts WHERE username=?', [req.user]);
    }
    const open = db.all("SELECT * FROM bot_trades WHERE username=? AND status='open' AND strategy='paper'", [req.user]);
    res.json({ ok:true, account:acc, open_trades:open });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/paper/reset', requireAuth, (req, res) => {
  try {
    const initial = parseFloat(req.body.initial||'1000');
    db.run('INSERT OR REPLACE INTO paper_accounts(username,balance,initial,pnl_total,wins,losses) VALUES(?,?,?,0,0,0)', [req.user,initial,initial], true);
    db.run("DELETE FROM bot_trades WHERE username=? AND strategy='paper'", [req.user], true);
    res.json({ ok:true, balance:initial });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/paper/trade', requireAuth, (req, res) => {
  try {
    const { action, symbol, side, price, qty, sl, tp, trade_id, pnl } = req.body;
    const acc = db.get('SELECT * FROM paper_accounts WHERE username=?', [req.user]);
    if (!acc) return res.status(400).json({ ok:false, error:'Paper account não encontrada. Reinicie o paper trading.' });
    if (action === 'open') {
      const cost = parseFloat(price) * parseFloat(qty);
      if (cost > acc.balance) return res.status(400).json({ ok:false, error:`Saldo insuficiente: $${acc.balance.toFixed(2)}` });
      const id = db.insert('bot_trades', { username:req.user, symbol, side, entry:parseFloat(price), qty:parseFloat(qty), sl:parseFloat(sl||0), tp:parseFloat(tp||0), strategy:'paper', status:'open' });
      db.run("UPDATE paper_accounts SET balance=balance-?,updated_at=datetime('now') WHERE username=?", [cost, req.user], true);
      res.json({ ok:true, id, balance: acc.balance - cost });
    } else if (action === 'close') {
      const trade = db.get('SELECT * FROM bot_trades WHERE id=? AND username=?', [trade_id, req.user]);
      if (!trade) return res.status(404).json({ ok:false, error:'Trade não encontrado' });
      const finalPnl = parseFloat(pnl||0);
      const returnAmt = trade.entry * trade.qty + finalPnl;
      const won = finalPnl >= 0;
      db.run("UPDATE bot_trades SET exit_price=?,pnl=?,status='closed',closed_at=datetime('now') WHERE id=?", [parseFloat(price), finalPnl, trade_id], true);
      db.run(`UPDATE paper_accounts SET balance=balance+?,pnl_total=pnl_total+?,wins=wins+${won?1:0},losses=losses+${won?0:1},updated_at=datetime('now') WHERE username=?`, [returnAmt, finalPnl, req.user], true);
      const newAcc = db.get('SELECT * FROM paper_accounts WHERE username=?', [req.user]);
      res.json({ ok:true, pnl:finalPnl, balance:newAcc.balance });
    }
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── Billing & Subscriptions ───────────────────────────────────────────────────
const PLANS = {
  free:   { name:'Free',   price:0,   features:['Mercados ao vivo','Analysis AI (3/dia)','Calculadoras','Dashboard'] },
  pro:    { name:'Pro',    price:97,  features:['Tudo do Free','Bot 1 par','Scanner 15 pares','Telegram ilimitado','Backtesting','Session Manager'] },
  expert: { name:'Expert', price:197, features:['Tudo do Pro','Bot multi-par','Paper trading','Walk-forward','Relatórios PDF','Suporte prioritário'] },
};

app.get('/api/billing/plans', (req, res) => res.json({ ok:true, plans:PLANS }));

app.get('/api/billing/subscription', requireAuth, (req, res) => {
  try {
    let sub = db.get('SELECT * FROM subscriptions WHERE username=? ORDER BY started_at DESC LIMIT 1', [req.user]);
    if (!sub) {
      db.run("INSERT OR IGNORE INTO subscriptions(username,plan,status,price_brl) VALUES(?,'free','active',0)", [req.user], true);
      sub = db.get('SELECT * FROM subscriptions WHERE username=?', [req.user]);
    }
    res.json({ ok:true, subscription:sub, plan: PLANS[sub?.plan] || PLANS.free });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/billing/upgrade', requireAuth, (req, res) => {
  try {
    const { plan, activation_code } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ ok:false, error:'Plano inválido' });
    const KEY = process.env.BILLING_ACTIVATION_KEY || '';
    if (KEY && activation_code !== KEY) return res.status(403).json({ ok:false, error:'Código de ativação inválido. Entre em contato com o suporte.' });
    const expires = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    db.run("INSERT OR REPLACE INTO subscriptions(id,username,plan,status,price_brl,started_at,expires_at) VALUES(lower(hex(randomblob(8))),?,?,'active',?,datetime('now'),?)",
      [req.user, plan, PLANS[plan].price, expires], true);
    db.run('UPDATE users SET plan=? WHERE username=?', [plan, req.user], true);
    res.json({ ok:true, message:`Plano ${PLANS[plan].name} ativado até ${expires.slice(0,10)}`, plan, expires });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── Performance Report (HTML download) ────────────────────────────────────────
app.get('/api/reports/performance', requireAuth, (req, res) => {
  try {
    const user   = db.get('SELECT username FROM users WHERE username=?', [req.user]);
    const trades = db.all("SELECT * FROM bot_trades WHERE username=? AND status='closed' ORDER BY closed_at DESC LIMIT 200", [req.user]);
    const sub    = db.get('SELECT plan FROM subscriptions WHERE username=? ORDER BY started_at DESC LIMIT 1', [req.user]);
    const wins = trades.filter(t => (t.pnl||0) >= 0).length;
    const losses = trades.length - wins;
    const totalPnl = trades.reduce((a,t) => a+(t.pnl||0), 0);
    const wr = trades.length > 0 ? Math.round(wins/trades.length*100) : 0;
    const avgWin  = wins   > 0 ? trades.filter(t=>(t.pnl||0)>=0).reduce((a,t)=>a+(t.pnl||0),0)/wins   : 0;
    const avgLoss = losses > 0 ? Math.abs(trades.filter(t=>(t.pnl||0)<0).reduce((a,t)=>a+(t.pnl||0),0)/losses) : 0;
    const pf = avgLoss > 0 ? (avgWin*wins)/(avgLoss*losses) : 0;
    let cumPnl=0, peak=0, maxDD=0;
    [...trades].reverse().forEach(t => { cumPnl+=(t.pnl||0); if(cumPnl>peak)peak=cumPnl; const dd=peak-cumPnl; if(dd>maxDD)maxDD=dd; });
    const now = new Date().toLocaleDateString('pt-BR');
    const rows = trades.slice(0,50).map(t =>
      `<tr><td>${(t.closed_at||'').slice(0,16)}</td><td>${t.symbol}</td><td>${t.side}</td>
       <td>$${parseFloat(t.entry||0).toFixed(2)}</td><td>$${parseFloat(t.exit_price||0).toFixed(2)}</td>
       <td style="color:${(t.pnl||0)>=0?'#1d9e75':'#e24b4a'}">${(t.pnl||0)>=0?'+':''}$${parseFloat(t.pnl||0).toFixed(2)}</td>
       <td>${t.reason||'—'}</td></tr>`
    ).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatório CryptoEdge</title>
<style>body{font-family:Arial,sans-serif;color:#1a1a1a;padding:40px;max-width:900px;margin:0 auto}
h1{font-size:22px;font-weight:700}h2{font-size:15px}
.sub{color:#666;font-size:13px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:28px}
.card{background:#f5f5f5;border-radius:8px;padding:12px}
.val{font-size:20px;font-weight:700}.lbl{font-size:11px;color:#888;margin-top:3px}
.green{color:#1d9e75}.red{color:#e24b4a}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}
th{background:#f0f0f0;padding:7px;text-align:left;font-size:11px;text-transform:uppercase}
td{padding:6px 7px;border-bottom:1px solid #eee}
.warn{background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:10px;font-size:12px;margin-bottom:20px}
.footer{margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px}</style></head><body>
<h1>CryptoEdge Pro — Relatório de Performance</h1>
<div class="sub">Gerado em ${now} · ${user.username} · Plano: ${(sub?.plan||'free').toUpperCase()}</div>
<div class="grid">
  <div class="card"><div class="val ${totalPnl>=0?'green':'red'}">${totalPnl>=0?'+':''}$${totalPnl.toFixed(2)}</div><div class="lbl">PnL Total</div></div>
  <div class="card"><div class="val">${trades.length}</div><div class="lbl">Total Trades</div></div>
  <div class="card"><div class="val">${wr}%</div><div class="lbl">Win Rate</div></div>
  <div class="card"><div class="val">${pf>0?pf.toFixed(2):'—'}</div><div class="lbl">Profit Factor</div></div>
  <div class="card"><div class="val green">${wins}</div><div class="lbl">Trades WIN</div></div>
  <div class="card"><div class="val red">${losses}</div><div class="lbl">Trades LOSS</div></div>
  <div class="card"><div class="val green">+$${avgWin.toFixed(2)}</div><div class="lbl">Ganho médio</div></div>
  <div class="card"><div class="val red">-$${avgLoss.toFixed(2)}</div><div class="lbl">Perda média</div></div>
</div>
<div class="warn">⚠️ Informe fiscal: ganhos com cripto acima de R$35.000/mês devem ser declarados no IR (alíquota 15%). Consulte um contador.</div>
<h2>Histórico de Operações (últimas 50)</h2>
<table><thead><tr><th>Data/Hora</th><th>Par</th><th>Lado</th><th>Entrada</th><th>Saída</th><th>PnL</th><th>Motivo</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="footer">CryptoEdge Pro · ${now} · Gerado automaticamente.</div></body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="performance-${req.user}-${new Date().toISOString().slice(0,10)}.html"`);
    res.send(html);
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── Walk-Forward & Optimize Backtest ──────────────────────────────────────────
app.post('/api/backtest/walkforward', requireAuth, (req, res) => {
  const params = req.body || {};
  const pyCmd  = process.platform==='win32' ? 'python' : 'python3';
  execFile(pyCmd, [path.join(__dirname,'bot','backtest.py'), JSON.stringify(params), '--mode=walkforward'],
    { timeout:180000, encoding:'utf8' },
    (err, out, err2) => {
      if (err) return res.status(500).json({ ok:false, error:(err2||err.message).slice(0,400) });
      try { res.json({ ok:true, ...JSON.parse(out) }); } catch { res.status(500).json({ ok:false, error:'parse error' }); }
    });
});

app.post('/api/backtest/optimize', requireAuth, (req, res) => {
  const params = req.body || {};
  const pyCmd  = process.platform==='win32' ? 'python' : 'python3';
  execFile(pyCmd, [path.join(__dirname,'bot','backtest.py'), JSON.stringify(params), '--mode=optimize'],
    { timeout:300000, encoding:'utf8' },
    (err, out, err2) => {
      if (err) return res.status(500).json({ ok:false, error:(err2||err.message).slice(0,400) });
      try { res.json({ ok:true, results:JSON.parse(out) }); } catch { res.status(500).json({ ok:false, error:'parse error' }); }
    });
});

// ─── Web Push Notifications ────────────────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
let webpush = null;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webpush = require('web-push'); webpush.setVapidDetails(`mailto:${process.env.VAPID_EMAIL||'admin@cryptoedge.com'}`, VAPID_PUBLIC, VAPID_PRIVATE); } catch {}
}
const _pushSubs = new Map();

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  if (!req.body?.subscription) return res.status(400).json({ ok:false });
  _pushSubs.set(req.user, req.body.subscription);
  res.json({ ok:true });
});
app.get('/api/push/vapid-public', (req, res) => res.json({ ok:true, key:VAPID_PUBLIC, enabled:!!webpush }));

// ─── COPY TRADING ─────────────────────────────────────────────────────────────
app.get('/api/copy/leaders', requireAuth, (req, res) => {
  try {
    const leaders = db.all(`
      SELECT cl.*, u.username,
        (SELECT COUNT(*) FROM copy_followers cf WHERE cf.leader=cl.username AND cf.active=1) as follower_count
      FROM copy_leaders cl JOIN users u ON u.username=cl.username
      WHERE cl.public=1 ORDER BY cl.total_pnl DESC LIMIT 20`);
    res.json({ ok:true, leaders });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/copy/become-leader', requireAuth, (req, res) => {
  try {
    const { display_name, bio, copy_fee_pct } = req.body;
    const exists = db.get('SELECT id FROM copy_leaders WHERE username=?', [req.user]);
    if (exists) {
      db.run('UPDATE copy_leaders SET display_name=?,bio=?,copy_fee_pct=? WHERE username=?',
        [display_name||req.user, bio||'', parseFloat(copy_fee_pct||0), req.user], true);
    } else {
      db.insert('copy_leaders', { username:req.user, display_name:display_name||req.user, bio:bio||'', copy_fee_pct:parseFloat(copy_fee_pct||0) });
    }
    res.json({ ok:true, message:'Perfil de líder criado/atualizado' });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/copy/follow', requireAuth, async (req, res) => {
  try {
    const { leader, capital, max_risk_pct } = req.body;
    if (!leader || !capital) return res.status(400).json({ ok:false, error:'leader e capital obrigatórios' });
    const leaderExists = db.get('SELECT id FROM copy_leaders WHERE username=?', [leader]);
    if (!leaderExists) return res.status(404).json({ ok:false, error:'Líder não encontrado' });
    if (leader === req.user) return res.status(400).json({ ok:false, error:'Você não pode seguir a si mesmo' });
    db.run('INSERT OR REPLACE INTO copy_followers(follower,leader,capital,max_risk_pct,active) VALUES(?,?,?,?,1)',
      [req.user, leader, parseFloat(capital), parseFloat(max_risk_pct||2)], true);
    db.run('UPDATE copy_leaders SET followers=followers+1 WHERE username=?', [leader], true);
    res.json({ ok:true, message:`Seguindo ${leader} com $${capital}` });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.delete('/api/copy/follow/:leader', requireAuth, (req, res) => {
  try {
    db.run('UPDATE copy_followers SET active=0 WHERE follower=? AND leader=?', [req.user, req.params.leader], true);
    db.run('UPDATE copy_leaders SET followers=MAX(0,followers-1) WHERE username=?', [req.params.leader], true);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.get('/api/copy/my-follows', requireAuth, (req, res) => {
  try {
    const follows = db.all(`SELECT cf.*, cl.display_name, cl.total_pnl as leader_pnl, cl.win_rate as leader_wr
      FROM copy_followers cf LEFT JOIN copy_leaders cl ON cl.username=cf.leader
      WHERE cf.follower=? AND cf.active=1`, [req.user]);
    res.json({ ok:true, follows });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Quando líder abre trade, copia para seguidores
async function _broadcastCopyTrade(leaderUser, tradeData) {
  try {
    const followers = db.all('SELECT * FROM copy_followers WHERE leader=? AND active=1', [leaderUser]);
    if (!followers.length) return;
    const icon = (tradeData.side||tradeData.direction||'').toUpperCase().includes('BUY') || (tradeData.side||'').includes('LONG') ? '🟢' : '🔴';
    for (const f of followers) {
      try {
        // Notificar via Telegram com informações do trade do líder
        const user = db.get('SELECT telegram_token,telegram_chatid FROM users WHERE username=?',[f.follower]);
        const tok  = user?.telegram_token || process.env.TELEGRAM_TOKEN || '';
        const cid  = user?.telegram_chatid || process.env.TELEGRAM_CHAT_ID || '';
        const side  = tradeData.side || tradeData.direction || '?';
        const entry = parseFloat(tradeData.entry||0);
        const sym   = tradeData.symbol || tradeData.pair || 'UNKNOWN';
        const tradeId = tradeData.id || '';
        if (tok && cid) {
          sendNativePush(f.follower, `Copy Trade @${leaderUser}`, `${side} ${sym} @ $${entry.toFixed(2)}`, {type:'copy_trade'}).catch(()=>{});
          const msg = `${icon} <b>Copy Trade — @${leaderUser}</b>

` +
            `📊 Par: <code>${sym}</code>
` +
            `↕️ Lado: <b>${side}</b>
` +
            `💲 Entrada: <code>$${entry.toFixed(2)}</code>
` +
            `💰 Capital configurado: <code>$${f.capital}</code>

` +
            `<i>Acesse o CryptoEdge Pro → Copy Trading para executar.</i>`;
          await axios.post(`https://api.telegram.org/bot${tok}/sendMessage`,
            { chat_id:cid, parse_mode:'HTML', text:msg }, {timeout:5000}).catch(()=>{});
        }
        // Registrar no diário de trades do seguidor
        db.insert('trades', { username:f.follower, pair:sym.replace('USDT','/USDT'),
          direction: side.toUpperCase().includes('BUY')||side.toUpperCase().includes('LONG')?'Long':'Short',
          entry, size:f.capital, reason:`Copy de @${leaderUser} · ${tradeData.reason||''}`,
          result:'pending', pnl:0, leverage:'1x', created_at: new Date().toLocaleString('pt-BR') });
        db.run('UPDATE copy_followers SET copied_trades=copied_trades+1 WHERE follower=? AND leader=?',
          [f.follower, leaderUser], true);
      } catch {}
    }
    // Atualizar stats do líder
    const bt = db.all("SELECT pnl FROM bot_trades WHERE username=? AND status='closed'",[leaderUser]);
    if (bt.length) {
      const wins = bt.filter(t=>(t.pnl||0)>=0).length;
      const totalPnl = bt.reduce((a,t)=>a+(t.pnl||0),0);
      db.run('UPDATE copy_leaders SET total_pnl=?,win_rate=?,trades=? WHERE username=?',
        [totalPnl, Math.round(wins/bt.length*100), bt.length, leaderUser], true);
    }
  } catch {}
}

// ─── TRADINGVIEW WEBHOOKS (Enhanced) ──────────────────────────────────────────
app.post('/api/tv/webhook/:token', async (req, res) => {
  try {
    const wh = db.get('SELECT * FROM tv_webhooks WHERE token=? AND active=1', [req.params.token]);
    if (!wh) return res.status(401).json({ error:'Invalid webhook token' });
    const { ticker, action, close, contracts, comment, strategy } = req.body;
    db.run('UPDATE tv_webhooks SET fires=fires+1 WHERE id=?', [wh.id], true);
    const symbol   = (ticker||'BTCUSDT').replace('USDT.P','USDT').replace('.','');
    const side     = (action||'').toLowerCase().includes('buy') ? 'BUY' : 'SELL';
    const price    = parseFloat(close||0);
    const qty      = parseFloat(contracts||0);
    // Registrar no diário de trades
    db.insert('trades', { username:wh.username, pair:symbol.replace('USDT','/USDT'),
      direction: side==='BUY'?'Long':'Short', entry:price, size:wh.capital,
      reason:`TradingView: ${comment||strategy||action||'signal'}`, result:'pending',
      pnl:0, leverage:'1x', created_at:new Date().toLocaleString('pt-BR') });
    // Notificar via live feed
    _pushLiveFeed({ type:'signal', label:`📺 TradingView: ${side} ${symbol}`,
      detail:`$${price.toLocaleString()} · ${comment||'Pine Script alert'}`, color: side==='BUY'?'green':'red' });
    // Notificar Telegram
    const user = db.get('SELECT telegram_token,telegram_chatid FROM users WHERE username=?',[wh.username]);
    const tgToken = user?.telegram_token || process.env.TELEGRAM_TOKEN || '';
    const chatId  = user?.telegram_chatid || process.env.TELEGRAM_CHAT_ID || '';
    if (tgToken && chatId) {
      const icon = side==='BUY'?'🟢':'🔴';
      await axios.post(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        chat_id:chatId, parse_mode:'HTML',
        text:`${icon} <b>TradingView Alert — ${symbol}</b>\n<b>${side}</b> @ <code>$${price.toLocaleString()}</code>\n<i>${comment||action||'Pine Script signal'}</i>`
      }, {timeout:5000}).catch(()=>{});
    }
    res.json({ ok:true, symbol, side, price });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/tv/webhooks', requireAuth, (req, res) => {
  try { res.json({ ok:true, webhooks: db.all('SELECT * FROM tv_webhooks WHERE username=?',[req.user]) }); }
  catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/tv/webhooks', requireAuth, (req, res) => {
  try {
    const { name, capital, auto_execute } = req.body;
    const token = genToken();
    const id = db.insert('tv_webhooks', { username:req.user, name:name||'TradingView', token, capital:parseFloat(capital||100), auto_execute:auto_execute?1:0 });
    const url = (process.env.APP_URL||'http://localhost:3000') + '/api/tv/webhook/' + token;
    res.json({ ok:true, id, token, url, message:`Webhook criado! URL: ${url}` });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.delete('/api/tv/webhooks/:id', requireAuth, (req, res) => {
  try { db.run('DELETE FROM tv_webhooks WHERE id=? AND username=?',[req.params.id,req.user],true); res.json({ok:true}); }
  catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── MULTI-EXCHANGE (Bybit + OKX) ─────────────────────────────────────────────
app.post('/api/exchange/balance', requireAuth, async (req, res) => {
  const { exchange } = req.body;
  const user = db.get('SELECT * FROM users WHERE username=?',[req.user]);
  try {
    if (exchange === 'bybit') {
      const key    = user?.bybit_key || process.env.BYBIT_API_KEY || '';
      const secret = user?.bybit_secret || process.env.BYBIT_API_SECRET || '';
      if (!key || !secret) return res.json({ ok:false, error:'Configure BYBIT_API_KEY no .env', simulated:true });
      const ts = Date.now().toString();
      const recv = '5000';
      const queryStr = `api_key=${key}&coin=USDT&recvWindow=${recv}&timestamp=${ts}`;
      const sig = require('crypto').createHmac('sha256', secret).update(queryStr).digest('hex');
      const r = await axios.get(`https://api.bybit.com/v2/private/wallet/balance?${queryStr}&sign=${sig}`,
        { timeout:8000 });
      const bal = r.data?.result?.USDT;
      return res.json({ ok:true, exchange:'bybit', balance: bal?.equity||0, available: bal?.available_balance||0 });
    }
    if (exchange === 'okx') {
      const key    = user?.okx_key    || process.env.OKX_API_KEY    || '';
      const secret = user?.okx_secret || process.env.OKX_API_SECRET || '';
      const pass   = user?.okx_pass   || process.env.OKX_PASSPHRASE || '';
      if (!key || !secret) return res.json({ ok:false, error:'Configure OKX_API_KEY no .env', simulated:true });
      const ts = new Date().toISOString();
      const sig = require('crypto').createHmac('sha256',secret).update(ts+'GET'+'/api/v5/account/balance').digest('base64');
      const r = await axios.get('https://www.okx.com/api/v5/account/balance',
        { headers:{'OK-ACCESS-KEY':key,'OK-ACCESS-SIGN':sig,'OK-ACCESS-TIMESTAMP':ts,'OK-ACCESS-PASSPHRASE':pass}, timeout:8000 });
      const usdt = r.data?.data?.[0]?.details?.find(d=>d.ccy==='USDT');
      return res.json({ ok:true, exchange:'okx', balance: usdt?.eq||0, available: usdt?.availEq||0 });
    }
    res.json({ ok:false, error:'Exchange não suportada. Use: binance, bybit, okx' });
  } catch(e) { res.status(500).json({ ok:false, error:e.response?.data?.retMsg||e.message }); }
});

// ─── IR FISCAL TRACKER ────────────────────────────────────────────────────────
app.get('/api/fiscal/:year', requireAuth, (req, res) => {
  try {
    const year = req.params.year || new Date().getFullYear().toString();
    const records = db.all('SELECT * FROM fiscal_records WHERE username=? AND month LIKE ? ORDER BY month',
      [req.user, year+'-%']);
    // Calcular meses faltantes a partir dos bot_trades
    const trades = db.all(
      "SELECT strftime('%Y-%m', closed_at) as month, SUM(CASE WHEN pnl>0 THEN pnl ELSE 0 END) as gains, SUM(CASE WHEN pnl<0 THEN ABS(pnl) ELSE 0 END) as losses FROM bot_trades WHERE username=? AND status='closed' AND closed_at LIKE ? GROUP BY month",
      [req.user, year+'%']);
    const result = trades.map(t => {
      const net  = t.gains - t.losses;
      const taxBRL = net * 5.7; // aproximado USD→BRL×5.7
      const due  = taxBRL > 35000 ? (net * 5.7 - 35000) * 0.15 : 0;
      const saved = records.find(r => r.month === t.month);
      return { month:t.month, gross_gain:t.gains, gross_loss:t.losses, net_pnl:net,
        tax_due_brl: parseFloat(due.toFixed(2)), paid: saved?.paid||0, darf_code:'6015',
        must_declare: taxBRL > 35000 };
    });
    res.json({ ok:true, year, months:result, total_pnl: result.reduce((a,r)=>a+r.net_pnl,0).toFixed(2) });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.get('/api/fiscal/report/:year', requireAuth, (req, res) => {
  try {
    const year = req.params.year || new Date().getFullYear().toString();
    const trades = db.all(
      "SELECT *, strftime('%Y-%m', closed_at) as month FROM bot_trades WHERE username=? AND status='closed' AND closed_at LIKE ? ORDER BY closed_at",
      [req.user, year+'%']);
    const byMonth = {};
    trades.forEach(t => {
      if (!byMonth[t.month]) byMonth[t.month] = { gains:0, losses:0, trades:[] };
      if ((t.pnl||0) >= 0) byMonth[t.month].gains += t.pnl;
      else byMonth[t.month].losses += Math.abs(t.pnl);
      byMonth[t.month].trades.push(t);
    });
    const months = Object.entries(byMonth).sort();
    const rows = months.map(([m, d]) => {
      const net = d.gains - d.losses;
      const netBRL = net * 5.7;
      const due = netBRL > 35000 ? (netBRL - 35000) * 0.15 : 0;
      return `<tr style="background:${net<0?'#fff8f8':'#f8fff8'}">
        <td><b>${m}</b></td><td>$${d.gains.toFixed(2)}</td><td>$${d.losses.toFixed(2)}</td>
        <td style="font-weight:700;color:${net>=0?'#1d9e75':'#e24b4a'}">${net>=0?'+':''}$${net.toFixed(2)}</td>
        <td>R$${(net*5.7).toFixed(2)}</td>
        <td style="color:${due>0?'#e24b4a':'#1d9e75'}">${due>0?'R$'+due.toFixed(2)+' (DARF 6015)':'Isento'}</td>
        <td>${d.trades.length}</td>
      </tr>`;
    }).join('');
    const totalPnl = months.reduce((a,[,d])=>a+(d.gains-d.losses),0);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;color:#222;padding:40px;max-width:960px;margin:0 auto}
h1{font-size:20px}h2{font-size:15px;margin:20px 0 8px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#f0f0f0;padding:8px;text-align:left;font-size:11px;text-transform:uppercase}
td{padding:7px 8px;border-bottom:1px solid #eee}
.warn{background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px;font-size:12px;margin:16px 0}
.info{background:#d1ecf1;border:1px solid #bee5eb;border-radius:6px;padding:12px;font-size:12px;margin:16px 0}
.footer{margin-top:40px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:16px}</style></head>
<body>
<h1>CryptoEdge Pro — Relatório Fiscal ${year}</h1>
<p style="color:#666;font-size:13px">Gerado em ${new Date().toLocaleDateString('pt-BR')} · Usuário: ${req.user}</p>
<div class="warn">⚠️ <b>Obrigação fiscal:</b> Ganhos com criptomoedas acima de R$35.000/mês estão sujeitos ao IR (alíquota 15-22,5%). Use o código DARF 6015. <b>Prazo: último dia útil do mês seguinte ao ganho.</b> Consulte um contador para validar estes valores.</div>
<div class="info">ℹ️ Cotação USD/BRL usada: R$5.70 (estimativa). Use a cotação oficial do Banco Central do Brasil (ptax) na data de cada operação para cálculo preciso.</div>
<h2>Resumo Mensal ${year}</h2>
<table><thead><tr><th>Mês</th><th>Ganhos (USD)</th><th>Perdas (USD)</th><th>PnL (USD)</th><th>PnL (BRL est.)</th><th>IR Devido</th><th>Trades</th></tr></thead>
<tbody>${rows}</tbody></table>
<div style="margin-top:16px;padding:12px;background:#f5f5f5;border-radius:8px;font-size:13px">
  <b>Total ${year}:</b> PnL = ${totalPnl>=0?'+':''}$${totalPnl.toFixed(2)} USD ≈ R$${(totalPnl*5.7).toFixed(2)}
</div>
<div class="footer">CryptoEdge Pro · Dados para fins informativos. Não substitui consultoria tributária.</div>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="fiscal-${year}-${req.user}.html"`);
    res.send(html);
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── PIX / STRIPE BILLING (base) ─────────────────────────────────────────────
app.post('/api/billing/pix/create', requireAuth, async (req, res) => {
  // Integração real: usar Mercado Pago ou EfiPay
  // Por ora gera QR code estático com instruções
  const { plan } = req.body;
  const PLANS = { free:{price:0}, pro:{price:97,name:'Pro'}, expert:{price:197,name:'Expert'} };
  const p = PLANS[plan];
  if (!p || p.price === 0) return res.status(400).json({ ok:false, error:'Plano inválido para pagamento' });
  const pixKey    = process.env.PIX_KEY    || '';
  const pixName   = process.env.PIX_NAME   || 'CryptoEdge Pro';
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (!pixKey && !stripeKey) {
    return res.json({ ok:true, method:'manual', plan, price:p.price,
      instructions:`Pagamento manual: entre em contato com o suporte para receber o código de ativação após o pagamento de R$${p.price}.`,
      contact: process.env.SUPPORT_EMAIL || process.env.SMTP_FROM || '' });
  }
  if (pixKey) {
    return res.json({ ok:true, method:'pix', plan, price:p.price, pix_key:pixKey, pix_name:pixName,
      description:`Plano ${p.name} - CryptoEdge Pro - 1 mês`,
      instructions:`Pague R$${p.price} via PIX para a chave acima e envie o comprovante para ${process.env.SUPPORT_EMAIL||'suporte@cryptoedge.pro'}` });
  }
  return res.json({ ok:false, error:'Pagamento não configurado ainda. Adicione PIX_KEY (sua chave pix) ou STRIPE_SECRET_KEY nas variáveis de ambiente do EasyPanel para ativar pagamentos.',
    setup_needed: true, docs: 'EasyPanel → seu serviço → Environment → PIX_KEY ou STRIPE_SECRET_KEY' });
});

app.post('/api/billing/stripe/checkout', requireAuth, async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (!stripeKey) return res.json({ ok:false, error:'STRIPE_SECRET_KEY não configurado. Veja: Configurações → Billing no EasyPanel.' });
  try { require('stripe'); } catch { return res.json({ ok:false, error:'Pacote stripe não instalado. Execute: npm install stripe no container.' }); }
  const { plan } = req.body;
  const PRICES = { pro: process.env.STRIPE_PRICE_PRO||'', expert: process.env.STRIPE_PRICE_EXPERT||'' };
  if (!PRICES[plan]) return res.status(400).json({ ok:false, error:'Configure STRIPE_PRICE_PRO e STRIPE_PRICE_EXPERT no .env' });
  try {
    const stripe = getStripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode:'subscription', payment_method_types:['card'],
      line_items:[{price:PRICES[plan], quantity:1}],
      success_url:`${process.env.APP_URL||'http://localhost:3000'}/profile?upgraded=1`,
      cancel_url: `${process.env.APP_URL||'http://localhost:3000'}/profile?cancelled=1`,
      metadata:{ username:req.user, plan }
    });
    res.json({ ok:true, url:session.url });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});



// ─── Stripe Webhook (auto-upgrade após pagamento) ─────────────────────────────
app.post('/api/billing/stripe/webhook', express.raw({type:'application/json'}), async (req, res) => {
  const stripeKey  = process.env.STRIPE_SECRET_KEY  || '';
  const webhookSec = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!stripeKey) return res.status(400).json({ error:'Stripe não configurado' });
  let event;
  try {
    const stripe = getStripe(stripeKey);
    if (webhookSec) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSec);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch(e) { return res.status(400).json({ error:'Webhook inválido: ' + e.message }); }

  try {
    if (event.type === 'checkout.session.completed') {
      const session  = event.data.object;
      const username = session.metadata?.username;
      const plan     = session.metadata?.plan;
      const PLANS    = { free:{price:0}, pro:{price:97}, expert:{price:197}, trader:{price:397} };
      if (username && plan && PLANS[plan]) {
        const expires = new Date(Date.now() + 30*24*60*60*1000).toISOString();
        db.run("INSERT OR REPLACE INTO subscriptions(id,username,plan,status,price_brl,stripe_id,started_at,expires_at) VALUES(lower(hex(randomblob(8))),?,?,'active',?,?,datetime('now'),?)",
          [username, plan, PLANS[plan].price, session.id, expires], true);
        db.run('UPDATE users SET plan=? WHERE username=?', [plan, username], true);
        // Notificar usuário por Telegram se configurado
        const user = db.get('SELECT telegram_token,telegram_chatid FROM users WHERE username=?',[username]);
        const tok = user?.telegram_token || process.env.TELEGRAM_TOKEN || '';
        const cid = user?.telegram_chatid || process.env.TELEGRAM_CHAT_ID || '';
        if (tok && cid) {
          await axios.post(`https://api.telegram.org/bot${tok}/sendMessage`, {
            chat_id:cid, parse_mode:'HTML',
            text:`✅ <b>Pagamento confirmado!</b>

Plano <b>${plan.toUpperCase()}</b> ativado até ${expires.slice(0,10)}.

Bem-vindo ao CryptoEdge Pro ${plan}! 🚀`
          }, {timeout:5000}).catch(()=>{});
        }
      }
    }
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const username = sub.metadata?.username;
      if (username) {
        db.run("UPDATE subscriptions SET status='cancelled' WHERE username=?", [username], true);
        db.run("UPDATE users SET plan='free' WHERE username=?", [username], true);
      }
    }
  } catch(e) { console.error('Stripe webhook error:', e.message); }
  res.json({ received: true });
});

// ─── Stripe: criar customer portal (gerenciar assinatura) ─────────────────────
app.post('/api/billing/stripe/portal', requireAuth, async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (!stripeKey) return res.json({ ok:false, error:'Stripe não configurado' });
  try {
    const stripe   = getStripe(stripeKey);
    const sub      = db.get('SELECT stripe_id FROM subscriptions WHERE username=? ORDER BY started_at DESC LIMIT 1',[req.user]);
    if (!sub?.stripe_id) return res.json({ ok:false, error:'Sem assinatura Stripe ativa' });
    const session  = await stripe.checkout.sessions.retrieve(sub.stripe_id);
    const portal   = await stripe.billingPortal.sessions.create({
      customer: session.customer,
      return_url: `${process.env.APP_URL||'http://localhost:3000'}/profile`
    });
    res.json({ ok:true, url:portal.url });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── Replay histórico tick-a-tick ─────────────────────────────────────────────
app.get('/api/replay/klines', requireAuth, async (req, res) => {
  const { symbol='BTCUSDT', interval='1m', limit='200', endTime } = req.query;
  try {
    const params = { symbol: symbol.toUpperCase(), interval, limit: Math.min(parseInt(limit),500) };
    if (endTime) params.endTime = parseInt(endTime);
    const r = await axios.get('https://api.binance.com/api/v3/klines', { params, timeout:10000 });
    const klines = r.data.map(k => ({
      t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
      l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]),
    }));
    res.json({ ok:true, klines, symbol, interval });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── Copy Trading: executar ordem real na Binance do seguidor ─────────────────
app.post('/api/copy/execute', requireAuth, async (req, res) => {
  const { leader_trade_id, confirm } = req.body;
  if (!confirm) return res.status(400).json({ ok:false, error:'Confirme a execução com confirm:true' });
  try {
    const trade = db.get('SELECT * FROM bot_trades WHERE id=?',[leader_trade_id]);
    if (!trade) return res.status(404).json({ ok:false, error:'Trade do líder não encontrado' });
    const follower = db.get('SELECT binance_key,binance_secret,binance_secret_enc FROM users WHERE username=?',[req.user]);
    if (!follower?.binance_key) return res.status(400).json({ ok:false, error:'Configure suas chaves Binance em Meu Perfil' });
    const secret = follower.binance_secret_enc ? decryptSecret(follower.binance_secret_enc) : follower.binance_secret;
    if (!secret) return res.status(400).json({ ok:false, error:'Binance Secret não configurado' });
    // Buscar follow config
    const follow = db.get('SELECT * FROM copy_followers WHERE follower=? AND leader=? AND active=1',[req.user, trade.username]);
    if (!follow) return res.status(400).json({ ok:false, error:'Você não está seguindo este trader' });
    // Calcular qty proporcional ao capital do seguidor
    const { execSync } = require('child_process');
    let ts = Date.now();
    try { const tr=await axios.get('https://api.binance.com/api/v3/time',{timeout:3000}); ts=tr.data.serverTime||ts; } catch {}
    const mkSig = q => require('crypto').createHmac('sha256',secret).update(q).digest('hex');
    // Buscar preço atual
    const priceR = await axios.get('https://api.binance.com/api/v3/ticker/price',{params:{symbol:trade.symbol},timeout:5000});
    const price  = parseFloat(priceR.data.price);
    // Calcular quantidade: capital do seguidor / preço atual
    const symInfoR = await axios.get('https://api.binance.com/api/v3/exchangeInfo',{params:{symbol:trade.symbol},timeout:8000});
    const symInfo  = symInfoR.data.symbols?.[0];
    const lotFilter = symInfo?.filters?.find(f=>f.filterType==='LOT_SIZE');
    const step = parseFloat(lotFilter?.stepSize||'0.001');
    const rawQty = follow.capital / price * 0.95;
    const qty = Math.floor(rawQty/step)*step;
    if (qty <= 0) return res.status(400).json({ ok:false, error:`Capital insuficiente para ${trade.symbol} (mín ~$10)` });
    // Executar ordem a mercado
    const qs = `symbol=${trade.symbol}&side=${trade.side}&type=MARKET&quantity=${qty}&timestamp=${ts}&recvWindow=10000`;
    const sig = mkSig(qs);
    const orderR = await axios.post(`https://api.binance.com/api/v3/order?${qs}&signature=${sig}`,{},{
      headers:{'X-MBX-APIKEY':follower.binance_key}, timeout:10000
    });
    const order = orderR.data;
    // Registrar no bot_trades do seguidor
    db.insert('bot_trades', { username:req.user, symbol:trade.symbol, side:trade.side,
      entry:price, qty, strategy:`copy:${trade.username}`, status:'open' });
    db.run('UPDATE copy_followers SET copied_trades=copied_trades+1 WHERE follower=? AND leader=?',[req.user,trade.username],true);
    res.json({ ok:true, order_id:order.orderId, symbol:trade.symbol, side:trade.side, qty, price });
  } catch(e) {
    res.status(500).json({ ok:false, error: e.response?.data?.msg || e.message });
  }
});


// ─── Replay Bot Auto (SSE) ────────────────────────────────────────────────────
// Stream eventos de replay em tempo real via Server-Sent Events
app.get('/api/replay/auto', requireAuth, async (req, res) => {
  const { symbol='BTCUSDT', interval='15m', limit='200', strategy='trend',
          rr='2.0', ema_fast='9', ema_slow='21', min_conf='0.65', speed='100' } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (evt, data) => {
    if (!res.writableEnded) res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Buscar klines da Binance
    const klR = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol: symbol.toUpperCase(), interval, limit: Math.min(parseInt(limit), 300) },
      timeout: 10000
    });
    const klines = klR.data;
    send('start', { total: klines.length, symbol, interval, strategy });

    // Parâmetros do backtester
    const cfg = { rr: parseFloat(rr), ema_fast: parseInt(ema_fast), ema_slow: parseInt(ema_slow),
                  min_conf: parseFloat(min_conf), capital: 1000 };

    // Replicar lógica do Backtester inline (sem subprocess — mais rápido)
    const closes = [], highs = [], lows = [], vols = [];
    let capital = 1000, position = null, wins = 0, losses = 0, pnl = 0;
    let prevMacdHist = 0;

    const calcEMA = (arr, p) => {
      if (!arr.length) return 0;
      const k = 2/(p+1); let e = arr[0];
      for (let i = 1; i < arr.length; i++) e = arr[i]*k + e*(1-k);
      return e;
    };
    const calcRSI = (arr, p=14) => {
      if (arr.length < p+1) return 50;
      const vals = arr.slice(-p-1);
      let ag=0, al=0;
      for (let i=1;i<vals.length;i++) { const d=vals[i]-vals[i-1]; if(d>0)ag+=d; else al-=d; }
      ag/=p; al/=p;
      return al===0 ? 100 : 100 - (100/(1+ag/al));
    };
    const calcATR = (h,l,c,p=14) => {
      if (c.length < 2) return 0;
      const n = Math.min(p, c.length-1);
      let s=0;
      for (let i=c.length-n; i<c.length; i++) {
        s += Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1]));
      }
      return s/n;
    };
    const calcMACD = (arr) => {
      if (arr.length < 35) return [0,0,0];
      const fast=calcEMA(arr.slice(-12),12), slow=calcEMA(arr.slice(-26),26);
      const ml=fast-slow;
      // simplified signal
      return [ml, ml*0.85, ml*0.15];
    };

    const WARMUP = 30;
    const delayMs = Math.max(10, Math.min(500, parseInt(speed)));

    for (let i = 0; i < klines.length; i++) {
      if (res.writableEnded) break;
      const k = klines[i];
      const o=parseFloat(k[1]), h=parseFloat(k[2]), l=parseFloat(k[3]),
            close=parseFloat(k[4]), v=parseFloat(k[5]);
      closes.push(close); highs.push(h); lows.push(l); vols.push(v);
      if (closes.length > 200) { closes.shift(); highs.shift(); lows.shift(); vols.shift(); }

      if (i < WARMUP) { send('candle', { i, k: {o,h,l,c:close,v}, warmup:true }); continue; }

      // Check SL/TP
      let closedBy = null;
      if (position) {
        if (position.side==='BUY') {
          if (l <= position.sl) closedBy = { price: position.sl, reason: 'STOP LOSS' };
          else if (h >= position.tp) closedBy = { price: position.tp, reason: 'TAKE PROFIT' };
        } else {
          if (h >= position.sl) closedBy = { price: position.sl, reason: 'STOP LOSS' };
          else if (l <= position.tp) closedBy = { price: position.tp, reason: 'TAKE PROFIT' };
        }
        if (closedBy) {
          const tradePnl = position.side==='BUY'
            ? (closedBy.price - position.entry) * position.qty
            : (position.entry - closedBy.price) * position.qty;
          pnl += tradePnl; capital += tradePnl;
          if (tradePnl >= 0) wins++; else losses++;
          send('close', { side:position.side, entry:position.entry, exit:closedBy.price,
            pnl:parseFloat(tradePnl.toFixed(2)), reason:closedBy.reason, total_pnl:parseFloat(pnl.toFixed(2)), wins, losses, capital:parseFloat(capital.toFixed(2)) });
          position = null;
        }
      }

      // Signal detection
      let sig = null;
      if (!position) {
        const r = calcRSI(closes);
        const atr = calcATR(highs, lows, closes);
        const sl_d = Math.max(atr*1.5, close*0.015);
        const tp_d = sl_d * parseFloat(cfg.rr);
        const qty  = capital / close * 0.95;

        if (strategy === 'trend') {
          const ef = calcEMA(closes.slice(-parseInt(cfg.ema_fast)), parseInt(cfg.ema_fast));
          const es = calcEMA(closes.slice(-parseInt(cfg.ema_slow)), parseInt(cfg.ema_slow));
          if (ef > es*1.001 && r < 65) sig = { side:'BUY',  sl:close-sl_d, tp:close+tp_d, qty };
          else if (ef < es*0.999 && r > 35) sig = { side:'SELL', sl:close+sl_d, tp:close-tp_d, qty };
        } else if (strategy === 'macd') {
          const [ml,,hist] = calcMACD(closes);
          if (prevMacdHist < 0 && hist > 0 && r < 65) sig = { side:'BUY',  sl:close-sl_d, tp:close+tp_d, qty };
          else if (prevMacdHist > 0 && hist < 0 && r > 35) sig = { side:'SELL', sl:close+sl_d, tp:close-tp_d, qty };
          prevMacdHist = hist;
        } else if (strategy === 'breakout') {
          const hiMax = Math.max(...highs.slice(-20));
          const loMin = Math.min(...lows.slice(-20));
          if (close > hiMax*1.003) sig = { side:'BUY',  sl:close-sl_d, tp:close+tp_d, qty };
          else if (close < loMin*0.997) sig = { side:'SELL', sl:close+sl_d, tp:close-tp_d, qty };
        }

        if (sig) {
          position = { side:sig.side, entry:close, sl:sig.sl, tp:sig.tp, qty:sig.qty };
          send('open', { side:sig.side, entry:close, sl:parseFloat(sig.sl.toFixed(2)),
            tp:parseFloat(sig.tp.toFixed(2)), capital:parseFloat(capital.toFixed(2)) });
        }
      }

      // Send candle event
      const rsi_v = calcRSI(closes);
      const ema_f = calcEMA(closes.slice(-parseInt(cfg.ema_fast||9)), parseInt(cfg.ema_fast||9));
      const ema_s = calcEMA(closes.slice(-parseInt(cfg.ema_slow||21)), parseInt(cfg.ema_slow||21));
      send('candle', { i, k:{o,h,l,c:close,v}, rsi:parseFloat(rsi_v.toFixed(1)),
        ema_fast:parseFloat(ema_f.toFixed(2)), ema_slow:parseFloat(ema_s.toFixed(2)),
        position: position ? { side:position.side, entry:position.entry, sl:position.sl, tp:position.tp } : null,
        pnl:parseFloat(pnl.toFixed(2)), wins, losses, capital:parseFloat(capital.toFixed(2)) });

      await new Promise(r => setTimeout(r, delayMs));
    }

    // Final summary
    const total = wins + losses;
    send('done', { pnl:parseFloat(pnl.toFixed(2)), wins, losses,
      wr: total > 0 ? Math.round(wins/total*100) : 0,
      capital:parseFloat(capital.toFixed(2)), roi:parseFloat(((capital-1000)/1000*100).toFixed(2)) });
    res.end();
  } catch(e) {
    send('error', { message: e.message });
    res.end();
  }
});

// ─── Copy Trading: taxa automática ao líder ────────────────────────────────────
app.post('/api/copy/close-follower-trade', requireAuth, async (req, res) => {
  const { trade_id, exit_price } = req.body;
  if (!trade_id || !exit_price) return res.status(400).json({ ok:false, error:'trade_id e exit_price obrigatórios' });
  try {
    const trade = db.get('SELECT * FROM bot_trades WHERE id=? AND username=?', [trade_id, req.user]);
    if (!trade) return res.status(404).json({ ok:false, error:'Trade não encontrado' });
    const exitP = parseFloat(exit_price);
    const pnl   = trade.side==='BUY'
      ? (exitP - trade.entry) * trade.qty
      : (trade.entry - exitP) * trade.qty;

    // Fechar trade do seguidor
    db.run("UPDATE bot_trades SET exit_price=?,pnl=?,status='closed',closed_at=datetime('now') WHERE id=?",
      [exitP, pnl, trade_id], true);

    // Extrair líder do strategy field (ex: "copy:leaderUser")
    const leaderUser = (trade.strategy||'').replace('copy:','');
    let feeCharged = 0;

    if (pnl > 0 && leaderUser) {
      // Cobrar taxa do líder
      const leader = db.get('SELECT copy_fee_pct FROM copy_leaders WHERE username=?', [leaderUser]);
      const feePct = parseFloat(leader?.copy_fee_pct||0);
      if (feePct > 0) {
        feeCharged = pnl * (feePct/100);
        // Registrar crédito ao líder
        db.insert('bot_trades', {
          username: leaderUser, symbol: trade.symbol, side: 'FEE',
          entry: 0, qty: 0, pnl: feeCharged, strategy: `fee_from:${req.user}`,
          status: 'closed', opened_at: new Date().toISOString(), closed_at: new Date().toISOString()
        });
        // Atualizar PnL total do líder
        db.run('UPDATE copy_leaders SET total_pnl=total_pnl+? WHERE username=?', [feeCharged, leaderUser], true);
        // Notificar líder via Telegram
        const lUser = db.get('SELECT telegram_token,telegram_chatid FROM users WHERE username=?',[leaderUser]);
        const tok = lUser?.telegram_token || process.env.TELEGRAM_TOKEN || '';
        const cid = lUser?.telegram_chatid || process.env.TELEGRAM_CHAT_ID || '';
        if (tok && cid) {
          await axios.post(`https://api.telegram.org/bot${tok}/sendMessage`, {
            chat_id: cid, parse_mode:'HTML',
            text:`💰 <b>Taxa de cópia recebida!</b>

` +
                 `Seguidor <code>${req.user}</code> fechou trade com lucro.
` +
                 `💵 Sua taxa (${feePct}%): <code>+$${feeCharged.toFixed(2)}</code>
` +
                 `📊 PnL do trade: <code>+$${pnl.toFixed(2)}</code>`
          }, {timeout:5000}).catch(()=>{});
        }
      }
      // Atualizar stats do seguidor
      db.run('UPDATE copy_followers SET pnl_total=pnl_total+? WHERE follower=? AND leader=?',
        [pnl - feeCharged, req.user, leaderUser], true);
    }

    res.json({ ok:true, pnl:parseFloat(pnl.toFixed(2)), fee_charged:parseFloat(feeCharged.toFixed(2)),
               net_pnl: parseFloat((pnl-feeCharged).toFixed(2)) });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ─── Copy Leader Dashboard ─────────────────────────────────────────────────────
app.get('/api/copy/leader-stats', requireAuth, (req, res) => {
  try {
    const leader = db.get('SELECT * FROM copy_leaders WHERE username=?', [req.user]);
    if (!leader) return res.json({ ok:true, is_leader:false });
    const followers   = db.all('SELECT * FROM copy_followers WHERE leader=? AND active=1', [req.user]);
    const feeEarned   = db.all("SELECT SUM(pnl) as total FROM bot_trades WHERE username=? AND side='FEE'", [req.user]);
    const trades      = db.all("SELECT * FROM bot_trades WHERE username=? AND status='closed' AND side!='FEE' ORDER BY closed_at DESC LIMIT 10", [req.user]);
    res.json({ ok:true, is_leader:true, leader, followers, fee_earned: feeEarned[0]?.total||0, recent_trades:trades });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});


// ─── Capacitor Native Push Token ──────────────────────────────────────────────
const _nativeTokens = new Map(); // username → { token, platform }
app.post('/api/push/native-token', requireAuth, (req, res) => {
  const { token, platform } = req.body;
  if (token) _nativeTokens.set(req.user, { token, platform: platform||'android' });
  res.json({ ok: true });
});

async function sendNativePush(username, title, body, data = {}) {
  // FCM (Firebase) direct push when running as native app
  const fcmKey = process.env.FCM_SERVER_KEY || '';
  const nt = _nativeTokens.get(username);
  if (!fcmKey || !nt) return;
  try {
    await axios.post('https://fcm.googleapis.com/fcm/send', {
      to: nt.token,
      notification: { title, body, icon: 'ic_notification' },
      data
    }, { headers: { Authorization: 'key=' + fcmKey }, timeout: 5000 });
  } catch {}
}

// ─── Health ────────────────────────────────────────────────────────────────────

// ─── Test Telegram endpoint ───────────────────────────────────────────────────
app.post('/api/bot/test-telegram', requireAuth, async (req, res) => {
  const tok = process.env.TELEGRAM_TOKEN || '';
  const cid = process.env.TELEGRAM_CHAT_ID || '';
  if (!tok || !cid) return res.json({ ok: false, error: 'TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID não configurado' });
  try {
    const r = await axios.post(`https://api.telegram.org/bot${tok}/sendMessage`, {
      chat_id: cid, parse_mode: 'HTML',
      text: `✅ <b>Teste CryptoEdge Pro</b>\n\n📲 Telegram funcionando!\n🕐 <i>${new Date().toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'})}</i>`
    }, { timeout: 8000 });
    res.json({ ok: true, telegram_ok: r.data.ok, message_id: r.data.result?.message_id });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.response?.data?.description || e.message });
  }
});

// ── Performance + HFT stats ───────────────────────────────────────────────────
app.get('/api/performance/by-pair', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days||'30');
    const rows = db.all(`
      SELECT symbol as pair, strategy,
        COUNT(*) as trades,
        SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END) as wins,
        SUM(pnl) as pnl,
        AVG(CASE WHEN pnl>0 THEN pnl END) as avg_win,
        AVG(CASE WHEN pnl<=0 THEN pnl END) as avg_loss
      FROM bot_trades WHERE closed_at IS NOT NULL
        AND opened_at>=datetime('now','-'||?||' days')
        AND username=?
      GROUP BY symbol, strategy ORDER BY trades DESC`, [days, req.user]);
    res.json({ok:true, pairs: rows.map(r=>({...r,pnl:parseFloat((r.pnl||0).toFixed(4))}))});
  } catch(e){res.json({ok:false,error:e.message});}
});

app.get('/api/performance/stats', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days||'30');
    const rows = db.all(`SELECT pnl,(julianday(COALESCE(closed_at,datetime('now')))-julianday(opened_at))*86400 AS dur FROM bot_trades WHERE closed_at IS NOT NULL AND opened_at>=datetime('now','-'||?||' days') ORDER BY opened_at`,[days]);
    if(!rows.length) return res.json({ok:true,empty:true});
    const wins=rows.filter(r=>r.pnl>0),losses=rows.filter(r=>r.pnl<=0),n=rows.length;
    const tot=rows.reduce((s,r)=>s+(r.pnl||0),0);
    const gW=wins.reduce((s,r)=>s+(r.pnl||0),0),gL=Math.abs(losses.reduce((s,r)=>s+(r.pnl||0),0));
    const pnls=rows.map(r=>r.pnl||0),mean=tot/n;
    const std=Math.sqrt(pnls.reduce((s,p)=>s+(p-mean)**2,0)/n||0);
    let best=0,cur=0; rows.forEach(r=>{if(r.pnl>0){cur++;best=Math.max(best,cur);}else cur=0;});
    res.json({ok:true,
      sharpe:+(std>0?(mean/std)*Math.sqrt(252):0).toFixed(2),
      pf:+(gL>0?gW/gL:gW>0?999:0).toFixed(2),
      avg_win:+(wins.length?gW/wins.length:0).toFixed(4),
      avg_loss:+(losses.length?-gL/losses.length:0).toFixed(4),
      best_streak:best,
      avg_duration_sec:Math.round(rows.reduce((s,r)=>s+(r.dur||0),0)/n),
      win_rate:+(wins.length/n*100).toFixed(1),
      total_pnl:+tot.toFixed(4),total_trades:n});
  } catch(e){res.json({ok:false,error:e.message});}
});

// ─── HFT Manual Close ────────────────────────────────────────────────────────
app.post('/api/hft/close', requireAuth, async (req, res) => {
  try {
    const { trade_id, pair } = req.body;
    if (!trade_id && !pair) return res.status(400).json({ ok: false, error: 'trade_id or pair required' });

    // Look up the trade to get pair + side
    let sym = pair;
    if (trade_id && !pair) {
      const t = db.get('SELECT symbol, side FROM bot_trades WHERE id=? AND username=?', [trade_id, req.user]);
      sym = t?.symbol || pair;
    }

    // Write a close signal file: /tmp/hft_close_{trade_id}
    const fs = require('fs');
    const flagFile = `/tmp/hft_close_${trade_id || sym}`;
    fs.writeFileSync(flagFile, JSON.stringify({ trade_id: trade_id || '', pair: sym || '', ts: Date.now() }));

    // Also write a pair-based flag as fallback
    if (sym) fs.writeFileSync(`/tmp/hft_close_pair_${sym}`, '1');

    res.json({ ok: true, message: `Sinal de fechamento enviado para ${sym || trade_id}` });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── HFT Current Prices (for live P&L) ───────────────────────────────────────
app.get('/api/hft/live-pnl', requireAuth, async (req, res) => {
  try {
    const trades = db.all(
      "SELECT * FROM bot_trades WHERE strategy='hft' AND status='open' AND username=?",
      [req.user]
    );
    if (!trades.length) return res.json({ ok: true, positions: [] });
    // Get current prices for all open pairs
    const symbols = [...new Set(trades.map(t => t.symbol))];
    const prices = {};
    await Promise.allSettled(symbols.map(async sym => {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, { signal: AbortSignal.timeout(3000) });
        const d = await r.json();
        if (d.price) prices[sym] = parseFloat(d.price);
      } catch {}
    }));
    const positions = trades.map(t => {
      const curPrice = prices[t.symbol] || 0;
      const entry    = parseFloat(t.entry || 0);
      const qty      = parseFloat(t.qty   || 0);
      const livePnl  = curPrice && entry && qty
        ? (t.side === 'BUY' ? (curPrice - entry) * qty : (entry - curPrice) * qty)
        : null;
      const pctChange = livePnl !== null && entry ? livePnl / (entry * qty) * 100 : null;
      return { ...t, cur_price: curPrice, live_pnl: livePnl, pct_change: pctChange };
    });
    res.json({ ok: true, positions });
  } catch(e) { res.json({ ok: false, error: e.message, positions: [] }); }
});

app.get('/api/hft/stats', requireAuth, (req, res) => {
  try {
    const trades = db.all("SELECT * FROM bot_trades WHERE (strategy='hft' OR strategy='HFT') AND DATE(opened_at)=DATE('now') ORDER BY opened_at DESC");
    const wins=trades.filter(t=>t.pnl>0).length,losses=trades.filter(t=>t.pnl<=0&&t.closed_at).length;
    const pnl=trades.reduce((s,t)=>s+(t.pnl||0),0),wr=wins+losses>0?wins/(wins+losses)*100:0;
    const open=trades.filter(t=>!t.closed_at);
    res.json({ok:true,today:{wins,losses,pnl:pnl.toFixed(4),wr:wr.toFixed(1),total:trades.length,open_positions:open.length,pairs:[...new Set(open.map(t=>t.pair))]},trades:trades.slice(0,20)});
  } catch(e){res.json({ok:false,error:e.message});}
});

// ─── Performance & HFT stats ─────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({
  status:'ok', model: process.env.AI_MODEL||'qwen3-30b-a3b', env: process.env.NODE_ENV||'development',
  ts: new Date().toISOString(), uptime: Math.round(process.uptime())+'s',
}));

// ─── Legal Pages ──────────────────────────────────────────────────────────────
app.get('/privacy',  (req, res) => res.sendFile(path.join(__dirname,'public','privacy.html')));
app.get('/terms',    (req, res) => res.sendFile(path.join(__dirname,'public','terms.html')));
app.get('/offline',  (req, res) => res.sendFile(path.join(__dirname,'public','offline.html')));

// ─── Static + SPA Fallback ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname,'public'), {
  maxAge: process.env.NODE_ENV==='production' ? '7d' : 0, etag: true,
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));

// ─── HTTP + WebSocket Server ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

db.init().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`\n  🚀  CryptoEdge Pro  →  http://localhost:${PORT}`);
    console.log(`  🤖  Modelo IA: ${process.env.AI_MODEL||'qwen3-30b-a3b'}`);
    console.log(`  💾  SQLite: ${process.env.DB_PATH||'./data'}/cryptoedge.db`);
    console.log(`  🔒  bcrypt rounds: ${BCRYPT_ROUNDS}\n`);
  });

  // ── Auto-restart bot if it was running before server restart ──────────────
  setTimeout(() => {
    if (_getBotAutostart() && !_botPid()) {
      console.log('  🔄 Auto-reiniciando bot (estava rodando antes do restart)...');
      try {
        const env = _loadEnv(path.resolve(BOT_ENV_PATH));
        env['PYTHONUNBUFFERED'] = '1';
        env['PATH'] = env['PATH'] || process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
        env['HOME'] = env['HOME'] || process.env.HOME || '/root';
        env['APP_URL'] = process.env.APP_URL || `http://localhost:${PORT}`;
        // Restore Binance keys from last user
        const lastUser = db.get("SELECT value FROM platform_settings WHERE key='bot_last_user'");
        if (lastUser?.value) {
          const u = db.get('SELECT binance_key,binance_secret,binance_secret_enc,telegram_token,telegram_chatid FROM users WHERE username=?', [lastUser.value]);
          if (u?.binance_key) env['BINANCE_API_KEY'] = u.binance_key;
          if (u?.binance_secret_enc) {
            try { env['BINANCE_SECRET_KEY'] = decryptSecret(u.binance_secret_enc) || ''; } catch {}
          } else if (u?.binance_secret) { env['BINANCE_SECRET_KEY'] = u.binance_secret; }
          if (u?.telegram_token)  env['TELEGRAM_TOKEN']   = u.telegram_token;
          if (u?.telegram_chatid) env['TELEGRAM_CHAT_ID'] = u.telegram_chatid;
        }
        _spawnDetached(env, path.join(__dirname,'bot','gridbot.py'));
        console.log('  ✅ Bot auto-reiniciado com sucesso');
      } catch(e) { console.error('  ❌ Auto-restart falhou:', e.message); }
    }
  }, 3000); // 3s delay to let DB settle

  // ── Watchdog: revive bot if it crashed ────────────────────────────────────
  setInterval(() => {
    if (_getBotAutostart() && !_botPid() && !_botStarting) {
      console.log('  🔄 Watchdog: bot caiu — reiniciando...');
      try {
        const env = _loadEnv(path.resolve(BOT_ENV_PATH));
        env['PYTHONUNBUFFERED'] = '1';
        env['PATH'] = env['PATH'] || process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
        env['HOME'] = env['HOME'] || process.env.HOME || '/root';
        env['APP_URL'] = process.env.APP_URL || `http://localhost:${PORT}`;
        const lastUser = db.get("SELECT value FROM platform_settings WHERE key='bot_last_user'");
        if (lastUser?.value) {
          const u = db.get('SELECT binance_key,binance_secret,binance_secret_enc,telegram_token,telegram_chatid FROM users WHERE username=?', [lastUser.value]);
          if (u?.binance_key) env['BINANCE_API_KEY'] = u.binance_key;
          if (u?.binance_secret_enc) { try { env['BINANCE_SECRET_KEY'] = decryptSecret(u.binance_secret_enc)||''; } catch {} }
          else if (u?.binance_secret) env['BINANCE_SECRET_KEY'] = u.binance_secret;
          if (u?.telegram_token)  env['TELEGRAM_TOKEN']   = u.telegram_token;
          if (u?.telegram_chatid) env['TELEGRAM_CHAT_ID'] = u.telegram_chatid;
        }
        _spawnDetached(env, path.join(__dirname,'bot','gridbot.py'));
        console.log('  ✅ Watchdog: bot reiniciado');
      } catch(e) { console.error('  ❌ Watchdog restart falhou:', e.message); }
    }
  }, 60000); // check every 60s

  const wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (clientWs) => {
    const PAIRS = [
      'btcusdt','ethusdt','bnbusdt','solusdt','xrpusdt','adausdt','dogeusdt','avaxusdt',
      'dotusdt','trxusdt','ltcusdt','linkusdt','bchusdt','xlmusdt','etcusdt','vetusdt',
      'hbarusdt','icpusdt','filusdt','atomusdt','uniusdt','aaveusdt','mkrusdt','crvusdt',
      'snxusdt','grtusdt','compusdt','sushiusdt','maticusdt','arbusdt','opusdt','strkusdt',
      'fetusdt','renderusdt','wldusdt','agixusdt','shibusdt','pepeusdt','wifusdt','flokiusdt',
      'bonkusdt','jupusdt','jtousdt','rayusdt','pythusdt','nearusdt','aptusdt','suiusdt',
      'seiusdt','injusdt','tiausdt','taousdt','kasusdt','axsusdt','sandusdt','manausdt',
      'galausdt','ronusdt','runeusdt','algousdt','ftmusdt','neousdt','ldousdt','stxusdt',
      'egldusdt','thetausdt','xmrusdt','zecusdt','dashusdt','dydxusdt','1inchusdt',
      'dymusdt','apeusdt','qntusdt','flowusdt','zilusdt','icxusdt','ontusdt','batusdt',
    ];
    const streams = PAIRS.slice(0,50).map(p => p+'@ticker').join('/');
    const wsUrl   = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    let bWs = null, retries = 0;

    function connect() {
      try {
        bWs = new WebSocket(wsUrl);
        bWs.on('open', () => { retries=0; if (clientWs.readyState===WebSocket.OPEN) clientWs.send(JSON.stringify({type:'ws_connected'})); });
        bWs.on('message', (data) => { if (clientWs.readyState===WebSocket.OPEN) clientWs.send(data.toString()); });
        bWs.on('error', () => {});
        bWs.on('close', () => { if (clientWs.readyState===WebSocket.OPEN && retries<3) { retries++; setTimeout(connect, 3000*retries); } });
      } catch {}
    }

    connect();
    clientWs.on('close', () => { try { bWs?.close(); } catch {} });
    clientWs.on('error', () => { try { bWs?.close(); } catch {} });
  });

  process.on('SIGTERM', () => { server.close(); process.exit(0); });
}).catch(err => {
  console.error('❌ Failed to initialize SQLite:', err);
  process.exit(1);
});
