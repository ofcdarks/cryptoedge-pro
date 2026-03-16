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
    if (!user?.binance_key)
      return res.json({ ok: false, error: 'Binance API Key não configurada em Meu Perfil', simulated: true, balance: 500 });

    // FIX: decrypt secret
    const secret = user.binance_secret_enc ? decryptSecret(user.binance_secret_enc) : user.binance_secret;
    if (!secret) return res.json({ ok: false, error: 'Binance Secret não configurado', simulated: true, balance: 500 });

    const ts     = Date.now();
    const sigF   = crypto.createHmac('sha256', secret).update(`timestamp=${ts}`).digest('hex');
    let totalUSDT = 0, walletData = [], source = 'futures';

    try {
      const rF = await axios.get('https://fapi.binance.com/fapi/v2/balance', {
        params: { timestamp: ts, signature: sigF }, headers: { 'X-MBX-APIKEY': user.binance_key }, timeout: 8000
      });
      const futuresBalances = rF.data.filter(b => parseFloat(b.balance) > 0);
      totalUSDT = futuresBalances.reduce((s,b) => s + parseFloat(b.balance), 0);
      walletData = futuresBalances.map(b => ({
        asset: b.asset, balance: parseFloat(b.balance).toFixed(2),
        unrealizedProfit: parseFloat(b.crossUnPnl||0).toFixed(2)
      }));
    } catch {
      source = 'spot';
      const sigS = crypto.createHmac('sha256', secret).update(`timestamp=${ts}`).digest('hex');
      const rS = await axios.get('https://api.binance.com/api/v3/account', {
        params: { timestamp: ts, signature: sigS }, headers: { 'X-MBX-APIKEY': user.binance_key }, timeout: 8000
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

// ─── Bot Process Manager (PM2 com fallback para spawn nativo) ─────────────────
// Em Docker/EasyPanel PM2 não está disponível — usa spawn nativo do Node.js
let _botProcess = null;  // referência ao processo filho quando rodando sem PM2
let _botLogs    = [];    // buffer de logs em memória (sem PM2)
let _botRestarts= 0;
let _botStartTime = null;

function _tryFindPM2() {
  const cmds = process.platform === 'win32'
    ? ['pm2'] : ['pm2', '/usr/local/bin/pm2', '/usr/bin/pm2',
                  (process.env.HOME||'')+'/.npm-global/bin/pm2'];
  for (const cmd of cmds) {
    try { execSync(cmd + ' --version', { encoding:'utf8', timeout:2000, stdio:'pipe' }); return cmd; }
    catch {}
  }
  return null;
}

function _botIsRunning() {
  if (_botProcess && !_botProcess.killed) {
    try { process.kill(_botProcess.pid, 0); return true; } catch {}
  }
  return false;
}

function _loadEnvFile(envPath) {
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  }
  return env;
}

function _appendBotLog(line) {
  const ts = new Date().toLocaleString('pt-BR');
  _botLogs.push(`[${ts}] ${line}`);
  if (_botLogs.length > 500) _botLogs = _botLogs.slice(-300);
  // Also write to file
  try {
    const logFile = path.join(__dirname, 'gridbot.log');
    fs.appendFileSync(logFile, `[${ts}] ${line}\n`);
  } catch {}
}

app.get('/api/bot/status', requireAuth, (req, res) => {
  // 1. Try PM2 first
  const pm2 = _tryFindPM2();
  if (pm2) {
    try {
      const out = execSync(pm2 + ' jlist', { encoding:'utf8', timeout:5000, stdio:['pipe','pipe','pipe'] });
      const raw = (out||'').trim();
      const jsonStart = raw.lastIndexOf('[');
      let list = [];
      try { list = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw); } catch {}
      const bot = Array.isArray(list) ? list.find(p => p.name === 'cryptoedge-bot') : null;
      if (bot) return res.json({ running: bot.pm2_env?.status==='online', status: bot.pm2_env?.status, pid: bot.pid, restarts: bot.pm2_env?.restart_time, pm2_found: true, mode: 'pm2' });
      return res.json({ running: false, status: 'stopped', pid: null, pm2_found: true, mode: 'pm2' });
    } catch {}
  }
  // 2. Fallback: spawn nativo
  const running = _botIsRunning();
  res.json({
    running,
    status:    running ? 'online' : 'stopped',
    pid:       running ? _botProcess?.pid : null,
    restarts:  _botRestarts,
    pm2_found: false,
    mode:      'native',
    uptime:    running && _botStartTime ? Math.round((Date.now()-_botStartTime)/1000)+'s' : null,
  });
});

app.post('/api/bot/start', requireAuth, async (req, res) => {
  try {
    if (_botIsRunning()) return res.json({ ok: true, message: 'Bot já está rodando' });

    // ── Busca chaves Binance do usuário no DB ──────────────────────────────────
    const user = db.get('SELECT binance_key, binance_secret, binance_secret_enc FROM users WHERE username=?', [req.user]);
    const binanceKey    = user?.binance_key || '';
    const binanceSecret = user?.binance_secret_enc
      ? decryptSecret(user.binance_secret_enc)
      : (user?.binance_secret || '');

    // ── Validação: bot não pode rodar sem chaves ────────────────────────────────
    if (!binanceKey || !binanceSecret) {
      return res.status(400).json({
        ok: false,
        error: 'Configure suas chaves Binance API em Meu Perfil antes de iniciar o bot.'
      });
    }

    const pyInterp = process.platform === 'win32' ? 'python' : 'python3';
    const botScript= path.join(__dirname, 'bot', 'gridbot.py');
    const envFile  = path.resolve(BOT_ENV_PATH);

    // ── Constrói ambiente completo: .bot.env + chaves Binance + env do processo ─
    const botEnv = _loadEnvFile(envFile);
    botEnv['BINANCE_API_KEY']    = binanceKey;
    botEnv['BINANCE_SECRET_KEY'] = binanceSecret;
    // Garante que variáveis críticas do sistema estejam presentes
    botEnv['PATH']   = botEnv['PATH']   || process.env.PATH   || '/usr/local/bin:/usr/bin:/bin';
    botEnv['HOME']   = botEnv['HOME']   || process.env.HOME   || '/root';
    botEnv['PYTHONUNBUFFERED'] = '1';  // logs em tempo real

    // ── Escreve .bot.env atualizado com chaves (sem o secret) para referência ──
    const configLines = fs.existsSync(envFile)
      ? fs.readFileSync(envFile, 'utf8').split('\n').filter(l => !l.match(/^BINANCE_(API_KEY|SECRET_KEY)=/))
      : [];
    configLines.push('BINANCE_API_KEY=' + binanceKey);
    // Secret não escrevemos em plain text no arquivo
    fs.writeFileSync(envFile, configLines.join('\n') + '\n', 'utf8');

    // ── 1. Tenta PM2 ───────────────────────────────────────────────────────────
    const pm2 = _tryFindPM2();
    if (pm2) {
      // Salva o ambiente de runtime num arquivo temporário seguro
      const runtimeEnvPath = path.join(__dirname, 'bot', '.bot_runtime.json');
      fs.writeFileSync(runtimeEnvPath, JSON.stringify(botEnv), { mode: 0o600 });

      // Launcher Node.js — lê o env do arquivo e executa o bot Python
      const launcherJs   = path.join(__dirname, 'bot', 'start_bot_runner.js');
      const runtimeEsc   = runtimeEnvPath.split('\\').join('/');
      const botScriptEsc = botScript.split('\\').join('/');
      const cwdEsc       = __dirname.split('\\').join('/');
      const launcherCode = [
        "'use strict';",
        "const {spawn}=require('child_process'),fs=require('fs');",
        "const env=JSON.parse(fs.readFileSync('" + runtimeEsc + "','utf8'));",
        "const p=spawn(process.platform==='win32'?'python':'python3',['" + botScriptEsc + "'],{env,stdio:'inherit',cwd:'" + cwdEsc + "'});",
        "p.on('exit',c=>process.exit(c||0));"
      ].join('\n');
      fs.writeFileSync(launcherJs, launcherCode, 'utf8');

      try {
        // Para instância anterior se existir
        try { execSync(pm2 + ' stop cryptoedge-bot --silent', { timeout:3000, stdio:'ignore' }); } catch {}
        try { execSync(pm2 + ' delete cryptoedge-bot --silent', { timeout:3000, stdio:'ignore' }); } catch {}
        execSync(
          pm2 + ' start "' + launcherJs + '" --name cryptoedge-bot --max-restarts 5 --restart-delay 30000 --stop-exit-codes 2',
          { encoding:'utf8', timeout:10000, cwd:__dirname }
        );
        _appendBotLog('🚀 Bot iniciado via PM2');
        return res.json({ ok: true, message: 'Bot iniciado via PM2', mode: 'pm2' });
      } catch(pm2Err) {
        console.warn('[Bot] PM2 falhou, usando spawn nativo:', pm2Err.message.slice(0,100));
      }
    }

    // ── 2. Fallback: spawn nativo ──────────────────────────────────────────────
    _botProcess = spawn(pyInterp, [botScript], {
      env:      botEnv,
      cwd:      __dirname,
      detached: false,
      stdio:    ['ignore', 'pipe', 'pipe'],
    });
    _botStartTime = Date.now();
    _appendBotLog('🚀 Bot iniciado modo nativo (PID ' + _botProcess.pid + ')');

    _botProcess.stdout.on('data', d =>
      String(d).split('\n').filter(Boolean).forEach(_appendBotLog));
    _botProcess.stderr.on('data', d =>
      String(d).split('\n').filter(Boolean).forEach(l => _appendBotLog('⚠ ' + l)));
    _botProcess.on('exit', (code, sig) => {
      _appendBotLog(`🛑 Bot encerrado (código ${code}, sinal ${sig})`);
      _botProcess = null;
    });
    _botProcess.on('error', err => {
      _appendBotLog('❌ Erro ao iniciar processo: ' + err.message);
      _botProcess = null;
    });

    res.json({ ok: true, message: 'Bot iniciado (modo nativo)', mode: 'native', pid: _botProcess.pid });
  } catch(e) {
    res.status(500).json({ ok: false, error: 'Erro ao iniciar bot: ' + e.message.slice(0,300) });
  }
});

app.post('/api/bot/stop', requireAuth, (req, res) => {
  // 1. Tenta PM2
  const pm2 = _tryFindPM2();
  if (pm2) {
    try {
      execSync(`${pm2} stop cryptoedge-bot`, { encoding:'utf8', timeout:5000 });
      return res.json({ ok: true, message: 'Bot parado via PM2' });
    } catch {}
  }
  // 2. Mata processo nativo
  if (_botIsRunning()) {
    try {
      _botProcess.kill('SIGTERM');
      setTimeout(() => { try { if (_botIsRunning()) _botProcess.kill('SIGKILL'); } catch {} }, 5000);
      _appendBotLog('🛑 Bot parado pelo usuário');
      res.json({ ok: true, message: 'Bot parado' });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  } else {
    res.json({ ok: true, message: 'Bot já estava parado' });
  }
});

app.get('/api/bot/logs', requireAuth, (req, res) => {
  // 1. Tenta log file
  try {
    const logFile = path.join(__dirname, 'gridbot.log');
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines   = content.trim().split('\n').filter(Boolean).slice(-100);
      if (lines.length) return res.json({ ok: true, lines, source: 'file' });
    }
  } catch {}
  // 2. Fallback: buffer em memória
  res.json({ ok: true, lines: _botLogs.slice(-100), source: 'memory' });
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
