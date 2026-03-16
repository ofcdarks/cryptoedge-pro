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
const nodemailer   = require('nodemailer');
const { execSync, execFile, spawn } = require('child_process');

const app = express();
const db  = require('./db');
const emailTpls = require('./templates/email');

// ─── Trust Proxy ───────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ─── Security Headers ──────────────────────────────────────────────────────────
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
  try { execSync('pkill -SIGTERM -f gridbot.py 2>/dev/null || true',{timeout:3000}); } catch {}
  await new Promise(r=>setTimeout(r,2000));
  try { execSync('pkill -SIGKILL -f gridbot.py 2>/dev/null || true',{timeout:2000}); } catch {}
  await new Promise(r=>setTimeout(r,500));
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

// Persiste/limpa flag de autostart no DB de configurações
function _setBotAutostart(on) {
  try { db.run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',[BOT_STATE_KEY, on?'1':'0']); } catch {}
}
function _getBotAutostart() {
  try { const r = db.get('SELECT value FROM settings WHERE key=?',[BOT_STATE_KEY]); return r?.value==='1'; } catch { return false; }
}

app.get('/api/bot/status', requireAuth, (req, res) => {
  const pid = _botPid();
  res.json({
    running:   pid!==null,
    status:    pid ? 'online' : 'stopped',
    pid:       pid ? String(pid) : null,
    mode:      'nativo',
    pm2_found: false,
    starting:  _botStarting,
  });
});

app.post('/api/bot/start', requireAuth, async (req, res) => {
  if (_botStarting) return res.status(429).json({ok:false,error:'Bot já está iniciando, aguarde.'});
  _botStarting = true;
  try {
    // ── Busca chaves do perfil; cai para variáveis de ambiente como fallback ──
    const user    = db.get('SELECT binance_key,binance_secret,binance_secret_enc FROM users WHERE username=?',[req.user]);
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

    // ── Lança Python com spawn nativo Node (detached:true + unref) ─────────────
    const botScript = path.join(__dirname,'bot','gridbot.py');
    _spawnDetached(env, botScript);

    // ── Aguarda até 8 s pelo PID ──────────────────────────────────────────────
    let pid = null;
    for (let i=0;i<16;i++) { await new Promise(r=>setTimeout(r,500)); pid=_botPid(); if(pid) break; }
    if (!pid) return res.status(500).json({ok:false,error:'Bot não iniciou em 8s. Verifique logs para erros Python.'});

    _blog('🚀 Bot iniciado (PID '+pid+')');
    _setBotAutostart(true);  // persiste: Node deve reiniciar o bot se restartar
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
  const token  = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(400).json({ ok: false, error: 'Configure TELEGRAM_TOKEN e TELEGRAM_CHAT_ID no .env' });
  try {
    const r = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text: '✅ <b>CryptoEdge Pro</b> — Telegram conectado!', parse_mode:'HTML'
    }, { timeout:8000 });
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

app.post('/api/admin/invite', requireAuth, requireAdmin, (req, res) => {
  try {
    const { plan='basic', maxUses=1, expiresInDays=30 } = req.body || {};
    const code      = crypto.randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now()+(expiresInDays||30)*24*60*60*1000).toISOString();
    db.run('INSERT INTO invite_codes (code,created_by,max_uses,plan,expires_at) VALUES (?,?,?,?,?)', [code, req.user, maxUses, plan, expiresAt]);
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

// ─── Health ────────────────────────────────────────────────────────────────────
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
