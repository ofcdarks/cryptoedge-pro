require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const axios     = require('axios');
const WebSocket = require('ws');
const path      = require('path');

const app = express();
// Production: trust proxy for HTTPS headers (when behind Nginx)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
// NOTE: express.static is registered AFTER all /api routes (see bottom of file)

// ─── Database (SQLite via sql.js) ─────────────────────────────────────────────
const db = require('./db');
// DB initialized async in server startup — routes use db.all/get/run/insert etc.

// ─── Trades API ────────────────────────────────────────────────────────────────
app.get('/api/trades', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const rows  = db.all('SELECT * FROM trades ORDER BY created_at DESC LIMIT ?', [limit]);
    res.json(rows.map(r => ({ ...r, _id: r.id, pnl: r.pnl||0, pnl_pct: r.pnl_pct||0, createdAt: r.created_at })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/trades', (req, res) => {
  try {
    const b = req.body || {};
    const id = db.insert('trades', {
      pair: b.pair||'', direction: b.direction||'', entry: b.entry||0, exit: b.exit||null,
      size: b.size||0, leverage: b.leverage||'1x', reason: b.reason||'',
      result: b.result||'pending', pnl: b.pnl||0, pnl_pct: b.pnl_pct||0,
      created_at: new Date().toLocaleString('pt-BR'), updated_at: new Date().toISOString()
    });
    res.json({ _id: id, ...b });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/trades/:id', (req, res) => {
  try { db.remove('trades', 'id=?', [req.params.id]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trades/stats', (req, res) => {
  try {
    const all    = db.all('SELECT * FROM trades');
    const totalPnl = all.reduce((s,t) => s+(t.pnl||0), 0);
    const wins   = all.filter(t => t.result==='win').length;
    const losses = all.filter(t => t.result==='loss').length;
    res.json({ total:all.length, wins, losses, winRate: all.length?((wins/all.length)*100).toFixed(1):0, totalPnl: totalPnl.toFixed(2) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Prices REST (fallback para quando WS falha) ──────────────────────────────
app.get('/api/prices', async (req, res) => {
  const SYMBOLS = [
    // Large Cap
    'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT',
    'DOTUSDT','TRXUSDT','LTCUSDT','LINKUSDT','BCHUSDT','XLMUSDT','ETCUSDT','VETUSDT',
    'HBARUSDT','ICPUSDT','FILUSDT','ATOMUSDT',
    // DeFi
    'UNIUSDT','AAVEUSDT','MKRUSDT','CRVUSDT','SNXUSDT','GRTUSDT','COMPUSDT','BALUSDT',
    'SUSHIUSDT','YFIUSDT','1INCHUSDT','DYDXUSDT','LRCUSDT','ZRXUSDT',
    // Layer 2
    'MATICUSDT','ARBUSDT','OPUSDT','STRKUSDT','IMXUSDT',
    // AI & Data
    'FETUSDT','RENDERUSDT','WLDUSDT','AGIXUSDT','OCEANUSDT',
    // Meme
    'SHIBUSDT','PEPEUSDT','WIFUSDT','FLOKIUSDT','BONKUSDT','MEMEUSDT',
    // Solana Ecosystem
    'JUPUSDT','JTOUSDT','RAYUSDT','PYTHUSDT',
    // New L1s
    'NEARUSDT','APTUSDT','SUIUSDT','SEIUSDT','INJUSDT','TIAUSDT','ALTUSDT','TAOUSDT','KASUSDT',
    // Gaming
    'AXSUSDT','SANDUSDT','MANAUSDT','ENJUSDT','GALAUSDT','PIXELUSDT','RONUSDT',
    // Infrastructure
    'RUNEUSDT','ALGOUSDT','QNTUSDT','FLOWUSDT','APEUSDT','LDOUSDT','STXUSDT',
    'EGLDUSDT','THETAUSDT','FTMUSDT','NEOUSDT','WAVESUSDT','KSMUSDT','ZILUSDT',
    'ICXUSDT','ONTUSDT','BATUSDT','DYMUSDT',
    // Privacy
    'XMRUSDT','ZECUSDT','DASHUSDT',
  ];
  try {
    const [tickersRes, statsRes] = await Promise.all([
      axios.get('https://api.binance.com/api/v3/ticker/price', { timeout: 8000 }),
      axios.get('https://api.binance.com/api/v3/ticker/24hr', {
        params: { symbols: JSON.stringify(SYMBOLS) },
        timeout: 8000
      })
    ]);

    const priceMap = {};
    (tickersRes.data || []).forEach(t => { priceMap[t.symbol] = t.price; });

    const result = (statsRes.data || [])
      .filter(t => SYMBOLS.includes(t.symbol))
      .map(t => ({
        s: t.symbol,
        c: t.lastPrice,
        P: t.priceChangePercent,
        h: t.highPrice,
        l: t.lowPrice,
        v: t.volume,
        q: t.quoteVolume,
      }));

    res.json({ ok: true, data: result });
  } catch (err) {
    // Tenta endpoint alternativo
    try {
      const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 8000 });
      const result = (r.data || [])
        .filter(t => SYMBOLS.includes(t.symbol))
        .map(t => ({
          s: t.symbol, c: t.lastPrice, P: t.priceChangePercent,
          h: t.highPrice, l: t.lowPrice, v: t.volume, q: t.quoteVolume,
        }));
      res.json({ ok: true, data: result });
    } catch (e2) {
      res.status(503).json({ ok: false, error: 'Binance indisponível', data: [] });
    }
  }
});

// ─── Single symbol price ──────────────────────────────────────────────────────
app.get('/api/price/:symbol', async (req, res) => {
  try {
    const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: { symbol: req.params.symbol.toUpperCase() },
      timeout: 6000
    });
    res.json(r.data);
  } catch (err) {
    res.status(503).json({ error: 'Binance indisponível' });
  }
});

// ─── AI Expert — laozhang.ai ──────────────────────────────────────────────────
app.post('/api/ai', async (req, res) => {
  const apiKey  = process.env.LAOZHANG_API_KEY;
  const baseUrl = process.env.LAOZHANG_BASE_URL || 'https://api.laozhang.ai/v1';
  const model   = process.env.AI_MODEL          || 'qwen3-30b-a3b';

  if (!apiKey) {
    return res.status(400).json({
      content: [{ type: 'text', text: 'Configure LAOZHANG_API_KEY no arquivo .env para usar a IA Expert.' }]
    });
  }

  const sysPrompt = 'Você é um especialista sênior em day trade de criptomoedas com 12+ anos de experiência em futuros, alavancagem e gestão de risco. Responda em português brasileiro, de forma direta, técnica e objetiva. Use exemplos com números reais quando possível. Seja honesto sobre riscos — nunca prometa lucros. Máximo 300 palavras.';

  const { messages } = req.body;

  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const baseMessages = [{ role: 'system', content: sysPrompt }, ...messages];

  // For qwen3 models, thinking must be explicitly disabled
  // Try the format that works with laozhang's proxy
  const isQwen3 = model.toLowerCase().includes('qwen3') || model.toLowerCase().includes('qwen-3');

  const body = {
    model,
    max_tokens: 1024,
    temperature: 0.7,
    messages: baseMessages,
    ...(isQwen3 ? { enable_thinking: false } : {})
  };

  try {
    let response;
    try {
      response = await axios.post(`${baseUrl}/chat/completions`, body,
        { headers, timeout: 30000 });
    } catch (firstErr) {
      // If thinking-related, try without the thinking param entirely
      const errMsg = (firstErr.response?.data?.error?.message || firstErr.message || '').toLowerCase();
      if (errMsg.includes('think') || errMsg.includes('enable_thinking')) {
        const body2 = { model, max_tokens: 1024, temperature: 0.7, messages: baseMessages };
        try {
          response = await axios.post(`${baseUrl}/chat/completions`, body2,
            { headers, timeout: 30000 });
        } catch (secondErr) {
          // Last attempt: use a non-thinking compatible model name
          const body3 = { model: model.replace('-a3b','').replace('qwen3','qwen2.5'),
            max_tokens: 1024, temperature: 0.7, messages: baseMessages };
          response = await axios.post(`${baseUrl}/chat/completions`, body3,
            { headers, timeout: 30000 });
        }
      } else {
        throw firstErr;
      }
    }

    let text = response.data?.choices?.[0]?.message?.content || '';
    // Strip <think>...</think> blocks (qwen3 extended thinking)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text) text = 'Modelo não retornou resposta. Tente novamente.';
    res.json({ content: [{ type: 'text', text }], model });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[AI] Final error:', msg);
    res.status(500).json({ content: [{ type: 'text', text: `Erro na API de IA: ${msg}` }] });
  }
});

// ─── Fear & Greed ──────────────────────────────────────────────────────────────
app.get('/api/feargreed', async (req, res) => {
  try {
    const r = await axios.get('https://api.alternative.me/fng/?limit=7', { timeout: 6000 });
    res.json(r.data);
  } catch {
    // Fallback determinístico baseado no dia
    const val = 45 + (new Date().getDate() % 30);
    res.json({
      data: [{
        value: val.toString(),
        value_classification: val < 25 ? 'Extreme Fear' : val < 45 ? 'Fear' : val < 55 ? 'Neutral' : val < 75 ? 'Greed' : 'Extreme Greed',
        timestamp: Math.floor(Date.now()/1000).toString()
      }]
    });
  }
});

// ─── Bot Config — save/load .env + start/stop status ────────────────────────
const fs   = require('fs');
const { execSync, spawn } = require('child_process');
const BOT_ENV_PATH = process.env.BOT_ENV_PATH || './.bot.env';

app.get('/api/bot/config', (req, res) => {
  try {
    const raw = fs.existsSync(BOT_ENV_PATH) ? fs.readFileSync(BOT_ENV_PATH, 'utf8') : '';
    // Parse key=value lines
    const cfg = {};
    raw.split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (m) cfg[m[1].trim()] = m[2].trim();
    });
    res.json({ ok: true, config: cfg, raw });
  } catch (e) {
    res.json({ ok: false, config: {}, raw: '' });
  }
});

app.post('/api/bot/config', (req, res) => {  // No auth required - local server
  try {
    const { config } = req.body;
    if (!config || typeof config !== 'object') return res.status(400).json({ ok: false, error: 'config required' });
    const lines = [
      '# CryptoEdge Pro — Bot config (gerado automaticamente)',
      '# ' + new Date().toLocaleString('pt-BR'),
      '',
      ...Object.entries(config).map(([k, v]) => `${k}=${v}`)
    ];
    fs.writeFileSync(BOT_ENV_PATH, lines.join('\n') + '\n', 'utf8');
    res.json({ ok: true, path: BOT_ENV_PATH, saved: Object.keys(config).length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Bot status — checks if pm2 process is running
app.get('/api/bot/status', (req, res) => {
  const isWin = process.platform === 'win32';
  // Try multiple PM2 invocation methods
  const pm2Cmds = isWin
    ? ['pm2 jlist', 'npx pm2 jlist']
    : ['pm2 jlist', 'npx pm2 jlist', process.env.HOME + '/.npm-global/bin/pm2 jlist', '/usr/local/bin/pm2 jlist', '/usr/bin/pm2 jlist'];

  for (const cmd of pm2Cmds) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['pipe','pipe','pipe'] });
      const raw = (out || '').trim();
      // PM2 sometimes outputs logs before JSON — find the JSON array
      const jsonStart = raw.lastIndexOf('[');
      const jsonStr   = jsonStart >= 0 ? raw.slice(jsonStart) : raw;
      let list = [];
      try { list = JSON.parse(jsonStr || '[]'); } catch { list = []; }
      const bot = Array.isArray(list) ? list.find(p => p.name === 'cryptoedge-bot') : null;
      if (bot) {
        return res.json({ running: bot.pm2_env?.status === 'online', status: bot.pm2_env?.status, pid: bot.pid, restarts: bot.pm2_env?.restart_time, pm2_found: true });
      }
      // PM2 is installed but bot not running
      return res.json({ running: false, status: 'stopped', pid: null, pm2_found: true });
    } catch(e) {
      // Try next command
      continue;
    }
  }
  // PM2 not found in any path
  res.json({ running: false, status: 'pm2_not_found', pid: null, pm2_found: false });
});

// Start bot
app.post('/api/bot/start', (req, res) => {
  try {
    const isWin2   = process.platform === 'win32';
    const pyInterp = isWin2 ? 'python' : 'python3';
    const botScript= require('path').join(__dirname, 'bot', 'gridbot.py');
    const envFile  = require('path').resolve(BOT_ENV_PATH);
    // Try to find pm2 in multiple locations
    const pm2Paths = isWin2
      ? ['pm2', 'npx pm2']
      : ['pm2', 'npx pm2', (process.env.HOME||'')+'/.npm-global/bin/pm2', '/usr/local/bin/pm2', '/usr/bin/pm2'];
    // Write a launcher script that loads the .bot.env and runs the bot
    const fsSync    = require('fs');
    const scriptExt = isWin2 ? '.bat' : '.sh';
    const launcher  = require('path').join(__dirname, 'bot', 'start_bot' + scriptExt);

    if (isWin2) {
      // Windows batch script
      const batLines = [
        '@echo off',
        'cd /d "' + __dirname + '"',
        'for /f "tokens=1,* delims==" %%a in (' + envFile + ') do (',
        '  if not "%%a"=="" if not "%%a:~0,1%"=="#" set "%%a=%%b"',
        ')',
        'python "' + botScript + '"',
      ];
      fsSync.writeFileSync(launcher, batLines.join('\r\n'), 'utf8');
    } else {
      // Unix shell script
      const shLines = [
        '#!/bin/sh',
        'cd "' + __dirname + '"',
        '[ -f "' + envFile + '" ] && export $(grep -v "^#" "' + envFile + '" | xargs)',
        '"' + pyInterp + '" "' + botScript + '"',
      ];
      fsSync.writeFileSync(launcher, shLines.join('\n'), { encoding:'utf8', mode: 0o755 });
    }

    let started = false, lastErr = '';
    for (const pm2 of pm2Paths) {
      try {
        const startCmd = isWin2
          ? pm2 + ' start "' + launcher + '" --name cryptoedge-bot'
          : pm2 + ' start "' + launcher + '" --name cryptoedge-bot --interpreter bash';
        execSync(startCmd, { encoding: 'utf8', timeout: 10000, cwd: __dirname });
        started = true; break;
      } catch(e2) { lastErr = e2.message; }
    }
    if (!started) {
      // Fallback: try direct python without PM2 wrapper
      throw new Error('PM2 falhou: ' + lastErr.slice(0,200) + '\n\nTente iniciar manualmente: python bot/gridbot.py');
    }
    res.json({ ok: true, message: 'Bot iniciado com PM2' });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Erro ao iniciar: ' + e.message.slice(0,300) });
  }
});

// Stop bot
app.post('/api/bot/stop', (req, res) => {
  try {
    const pm2Paths = process.platform === 'win32'
      ? ['pm2', 'npx pm2']
      : ['pm2', 'npx pm2', (process.env.HOME||'')+'/.npm-global/bin/pm2', '/usr/local/bin/pm2'];
    let stopped = false, lastErr = '';
    for (const pm2 of pm2Paths) {
      try { execSync(pm2 + ' stop cryptoedge-bot 2>&1', { encoding:'utf8', timeout:5000 }); stopped=true; break; }
      catch(e2) { lastErr = e2.message; }
    }
    if (!stopped) throw new Error(lastErr);
    res.json({ ok: true, message: 'Bot parado' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message.slice(0,200) });
  }
});

// Bot logs (last 50 lines)
app.get('/api/bot/logs', (req, res) => {
  try {
    const logFile = require('path').join(__dirname, 'gridbot.log');
    if (!fs.existsSync(logFile)) return res.json({ ok: true, lines: [] });
    const content = fs.readFileSync(logFile, 'utf8');
    const lines   = content.trim().split('\n').slice(-80);
    res.json({ ok: true, lines });
  } catch (e) {
    res.json({ ok: false, lines: [`Erro: ${e.message}`] });
  }
});

// ─── Backtesting ──────────────────────────────────────────────────────────────
const { execFile } = require('child_process');

app.post('/api/backtest', (req, res) => {
  const params  = req.body || {};
  const payload = JSON.stringify(params);
  const timeout = 90000;
  const isWin   = process.platform === 'win32';
  const pyCmd   = isWin ? 'python' : 'python3';
  const script  = require('path').join(__dirname, 'bot', 'backtest.py');

  execFile(pyCmd, [script, payload], { timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
    if (err) {
      let msg = stderr || err.message || 'Backtesting falhou';
      if (msg.includes("No module named 'binance'")) {
        msg = 'Dependências Python não instaladas. Execute: pip install python-binance python-dotenv';
      } else if (msg.includes('No module named')) {
        msg = 'Módulo Python faltando. Execute: pip install -r bot/requirements.txt';
      }
      return res.status(500).json({ error: msg.slice(0, 600) });
    }
    try {
      const result = JSON.parse(stdout.trim());
      res.json(result);
    } catch(e) {
      res.status(500).json({ error: 'Resposta inválida do Python: ' + stdout.slice(0, 300) });
    }
  });
});

// ─── PnL Chart data ────────────────────────────────────────────────────────────
app.get('/api/pnl/chart', (req, res) => {
  try {
    const range = req.query.range || 'week';
    const all   = db.all('SELECT * FROM trades ORDER BY created_at ASC');
    if (!all.length) return res.json({ labels:[], data:[], cumulative:[], days:[] });

    const byDay = {};
    all.forEach(t => {
      const date = (t.created_at||'').split(',')[0].trim() || 'Unknown';
      if (!byDay[date]) byDay[date] = { pnl:0, trades:0, wins:0 };
      byDay[date].pnl    += t.pnl||0;
      byDay[date].trades += 1;
      byDay[date].wins   += t.result==='win' ? 1 : 0;
    });

    let days = Object.entries(byDay).map(([date,d]) => ({ date, ...d }));
    if (range==='week')  days = days.slice(-7);
    if (range==='month') days = days.slice(-30);

    const labels     = days.map(d => d.date);
    const daily      = days.map(d => parseFloat((d.pnl||0).toFixed(2)));
    let cum = 0;
    const cumulative = daily.map(v => parseFloat((cum+=v).toFixed(2)));
    res.json({ labels, data:daily, cumulative, days });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Telegram test ─────────────────────────────────────────────────────────────
app.post('/api/telegram/test', async (req, res) => {
  const token  = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(400).json({ ok: false, error: 'Configure TELEGRAM_TOKEN e TELEGRAM_CHAT_ID no .env' });
  }
  try {
    const testMsg = '\u2705 <b>CryptoEdge Pro</b> \u2014 Telegram conectado! Notifica\u00e7\u00f5es ativas.';
    const r = await axios.post('https://api.telegram.org/bot' + token + '/sendMessage', {
      chat_id:    chatId,
      text:       testMsg,
      parse_mode: 'HTML'
    }, { timeout: 8000 });
    res.json({ ok: r.data.ok, result: r.data.result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.response?.data?.description || e.message });
  }
});

// ─── Auth — Simple session-based login ────────────────────────────────────────
const crypto = require('crypto');
// sessions stored in SQLite

function hashPass(p) { return crypto.createHash('sha256').update(p + 'cryptoedge_salt').digest('hex'); }
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
// ─── Auth Routes (Multi-User) ──────────────────────────────────────────────────
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

// First-time admin setup
app.post('/api/auth/setup', (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password || password.length < 6)
    return res.status(400).json({ error: 'Username e senha (mín. 6 chars) obrigatórios' });
  try {
    const existing = db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (existing) return res.status(400).json({ error: 'Admin já configurado' });
    const id = db.insert('users', { username, email: email||null, password: hashPass(password), role: 'admin', plan: 'admin', status: 'active' });
    const token = genToken(), exp = new Date(Date.now()+30*24*60*60*1000).toISOString();
    db.insert('sessions', { token, username, expires_at: exp });
    res.json({ ok: true, token, username, role: 'admin' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// User self-registration (respects regMode)
app.post('/api/auth/register', (req, res) => {
  const { username, password, email, inviteCode } = req.body || {};
  if (!username || !password || password.length < 6)
    return res.status(400).json({ error: 'Username e senha (mín. 6 chars) obrigatórios' });
  try {
    const mode = db.get("SELECT value FROM platform_settings WHERE key='registration_mode'")?.value || 'invite';
    
    // Check invite code if required
    let plan = 'basic';
    if (mode === 'invite') {
      if (!inviteCode) return res.status(400).json({ error: 'Código de convite obrigatório' });
      const invite = db.get('SELECT * FROM invite_codes WHERE code=? AND (expires_at IS NULL OR expires_at > datetime("now"))', [inviteCode]);
      if (!invite) return res.status(400).json({ error: 'Código de convite inválido ou expirado' });
      if (invite.uses >= invite.max_uses) return res.status(400).json({ error: 'Código de convite já utilizado' });
      plan = invite.plan || 'basic';
      db.run('UPDATE invite_codes SET uses=uses+1, used_by=?, used_at=datetime("now") WHERE code=?', [username, inviteCode]);
    } else if (mode === 'closed') {
      return res.status(403).json({ error: 'Cadastros desativados. Entre em contato com o administrador.' });
    }
    // Open mode: allow registration

    // Check username/email uniqueness
    const exists = db.get('SELECT id FROM users WHERE username=?', [username]);
    if (exists) return res.status(400).json({ error: 'Nome de usuário já existe' });
    if (email) {
      const emailExists = db.get('SELECT id FROM users WHERE email=?', [email]);
      if (emailExists) return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    // Check max users
    const maxUsers = parseInt(db.get("SELECT value FROM platform_settings WHERE key='max_users'")?.value || '100');
    const userCount = db.count('users');
    if (userCount >= maxUsers) return res.status(403).json({ error: 'Limite de usuários atingido' });

    const id = db.insert('users', { username, email: email||null, password: hashPass(password), role: 'user', plan, status: 'active', invite_code: inviteCode||'' });
    const token = genToken(), exp = new Date(Date.now()+30*24*60*60*1000).toISOString();
    db.insert('sessions', { token, username, expires_at: exp });
    res.json({ ok: true, token, username, role: 'user', plan });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  try {
    const user = db.get('SELECT * FROM users WHERE username=? AND password=?', [username, hashPass(password)]);
    if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Conta desativada. Contate o administrador.' });
    const token = genToken(), exp = new Date(Date.now()+30*24*60*60*1000).toISOString();
    db.insert('sessions', { token, username, expires_at: exp });
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

// Get own profile + API keys
app.get('/api/auth/me', requireAuth, (req, res) => {
  try {
    const user = db.get('SELECT id,username,email,role,plan,status,binance_key,telegram_token,telegram_chatid,created_at,last_login FROM users WHERE username=?', [req.user]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    // Mask secrets
    res.json({ ok: true, user: {
      ...user,
      binance_key:     user.binance_key    ? user.binance_key.slice(0,8)+'••••••••' : '',
      has_binance_key: !!user.binance_key,
      has_telegram:    !!user.telegram_token,
    }});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update own API keys
app.post('/api/auth/keys', requireAuth, (req, res) => {
  try {
    const { binance_key, binance_secret, telegram_token, telegram_chatid, email } = req.body || {};
    const updates = {};
    if (binance_key    !== undefined) updates.binance_key    = binance_key;
    if (binance_secret !== undefined) updates.binance_secret = binance_secret;
    if (telegram_token !== undefined) updates.telegram_token = telegram_token;
    if (telegram_chatid!== undefined) updates.telegram_chatid= telegram_chatid;
    if (email          !== undefined) updates.email          = email;
    if (!Object.keys(updates).length) return res.json({ ok: true });
    db.update('users', updates, 'username=?', [req.user]);
    res.json({ ok: true, message: 'Chaves salvas com sucesso' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Change password
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  try {
    const { current, newPass } = req.body || {};
    if (!current || !newPass || newPass.length < 6)
      return res.status(400).json({ error: 'Senhas inválidas' });
    const user = db.get('SELECT * FROM users WHERE username=? AND password=?', [req.user, hashPass(current)]);
    if (!user) return res.status(401).json({ error: 'Senha atual incorreta' });
    db.run('UPDATE users SET password=? WHERE username=?', [hashPass(newPass), req.user]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Watchlist ──────────────────────────────────────────────────────────────────
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
    (pairs||[]).forEach(sym => {
      try { db.insert('watchlist', { username: req.user, symbol: sym }); } catch {}
    });
    res.json({ ok: true, pairs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Alerts ─────────────────────────────────────────────────────────────────────
app.get('/api/alerts', requireAuth, (req, res) => {
  try {
    const rows = db.all('SELECT * FROM alerts WHERE username=? ORDER BY created_at DESC', [req.user]);
    res.json(rows.map(r => ({ ...r, _id: r.id, user: r.username, triggered: !!r.triggered })));
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

// ─── Settings ────────────────────────────────────────────────────────────────────
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
    const data    = JSON.stringify(settings);
    const exists  = db.get('SELECT username FROM settings WHERE username=?', [req.user]);
    if (exists) db.run('UPDATE settings SET data=?, updated_at=datetime("now") WHERE username=?', [data, req.user]);
    else        db.insert('settings', { username: req.user, data });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});


// ─── Admin Routes ──────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const user = db.get("SELECT role FROM users WHERE username=?", [req.user]);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado — apenas admin' });
  next();
}

// List all users (admin)
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = db.all('SELECT id,username,email,role,plan,status,created_at,last_login FROM users ORDER BY created_at DESC');
    res.json({ ok: true, users, total: users.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update user (admin)
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

// Delete user (admin)
app.delete('/api/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
  try {
    if (req.params.username === req.user) return res.status(400).json({ error: 'Não pode deletar a si mesmo' });
    db.run('DELETE FROM users WHERE username=?', [req.params.username]);
    db.run('DELETE FROM sessions WHERE username=?', [req.params.username]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Generate invite code (admin)
app.post('/api/admin/invite', requireAuth, requireAdmin, (req, res) => {
  try {
    const { plan='basic', maxUses=1, expiresInDays=30 } = req.body || {};
    const code     = require('crypto').randomBytes(6).toString('hex').toUpperCase();
    const expiresAt= new Date(Date.now()+(expiresInDays||30)*24*60*60*1000).toISOString();
    db.run('INSERT INTO invite_codes (code,created_by,max_uses,plan,expires_at) VALUES (?,?,?,?,?)',
      [code, req.user, maxUses, plan, expiresAt]);
    res.json({ ok: true, code, plan, maxUses, expiresAt });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// List invite codes (admin)
app.get('/api/admin/invites', requireAuth, requireAdmin, (req, res) => {
  try {
    const codes = db.all('SELECT * FROM invite_codes ORDER BY created_at DESC LIMIT 50');
    res.json({ ok: true, codes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete invite code (admin)
app.delete('/api/admin/invites/:code', requireAuth, requireAdmin, (req, res) => {
  try {
    db.run('DELETE FROM invite_codes WHERE code=?', [req.params.code]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Platform settings (admin)
app.get('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  try {
    const rows = db.all('SELECT * FROM platform_settings');
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ ok: true, settings: s });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  try {
    const { settings } = req.body || {};
    Object.entries(settings||{}).forEach(([k, v]) => {
      db.run('INSERT OR REPLACE INTO platform_settings (key,value,updated_at) VALUES (?,?,datetime("now"))', [k, String(v)]);
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Platform stats (admin)
app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  try {
    res.json({
      ok: true,
      users:     db.count('users'),
      active:    db.count('users', "status='active'"),
      admins:    db.count("users", "role='admin'"),
      trades:    db.count('trades'),
      analyses:  db.count('analysis_history'),
      invites:   db.count('invite_codes'),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Pattern Scanner ───────────────────────────────────────────────────────────
app.post('/api/scanner', (req, res) => {
  // Scanner runs client-side (browser calls Binance directly)
  res.json({ run_client_side: true, params: req.body });
});

// ─── Performance Report export ────────────────────────────────────────────────
app.get('/api/report/json', requireAuth, (req, res) => {
  try {
    const all      = db.all('SELECT * FROM trades ORDER BY created_at DESC');
    const wins     = all.filter(t=>t.result==='win').length;
    const losses   = all.filter(t=>t.result==='loss').length;
    const totalPnl = all.reduce((s,t)=>s+(t.pnl||0), 0);
    res.json({
      generated: new Date().toISOString(),
      summary: {
        total: all.length, wins, losses,
        winRate: all.length ? ((wins/all.length)*100).toFixed(1)+'%' : '0%',
        totalPnl: totalPnl.toFixed(2),
        avgPnl: all.length ? (totalPnl/all.length).toFixed(2) : '0'
      },
      trades: all.map(t => ({ ...t, _id: t.id }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Analysis AI — tells client to run client-side ──────────────────────────
// Analysis runs in the browser which can access Binance directly
app.post('/api/analysis', (req, res) => {
  // Return a signal to run client-side (browser calls Binance directly)
  res.json({ run_client_side: true, params: req.body });
});


// ─── PM2 Diagnostic ───────────────────────────────────────────────────────────
app.get('/api/bot/pm2-check', (req, res) => {
  const results = {};
  const { execSync: es } = require('child_process');
  const isWin = process.platform === 'win32';
  
  // Check which pm2 commands work
  const cmds = isWin
    ? ['pm2 --version', 'npx pm2 --version']
    : ['pm2 --version', 'npx pm2 --version',
       (process.env.HOME||'')+'/.npm-global/bin/pm2 --version',
       '/usr/local/bin/pm2 --version', '/usr/bin/pm2 --version'];

  let found = false;
  for (const cmd of cmds) {
    try {
      const v = es(cmd, { encoding:'utf8', timeout:3000 }).trim().split('\n').pop();
      results[cmd] = 'OK — v' + v;
      found = true; break;
    } catch(e) {
      results[cmd] = 'FAIL: ' + e.message.slice(0,80);
    }
  }
  
  // Also check PATH
  try { results['which pm2'] = es('which pm2', { encoding:'utf8', timeout:2000 }).trim(); } catch { results['which pm2'] = 'not found'; }
  try { results['where pm2'] = es('where pm2', { encoding:'utf8', timeout:2000 }).trim(); } catch { results['where pm2'] = 'n/a (Linux)'; }
  
  res.json({ platform: process.platform, pm2_found: found, node_version: process.version, cwd: process.cwd(), results });
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
    const data = JSON.stringify(settings);
    const exists = db.get('SELECT username FROM settings WHERE username=?', [req.user]);
    if (exists) db.run('UPDATE settings SET data=?, updated_at=datetime("now") WHERE username=?', [data, req.user]);
    else        db.insert('settings', { username: req.user, data });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Analysis AI History ───────────────────────────────────────────────────────
app.post('/api/analysis/save', requireAuth, (req, res) => {
  try {
    const { symbol, timeframe, suggestion, techScore, smc, patterns, price } = req.body || {};
    const now   = new Date();
    const id    = db.insert('analysis_history', {
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
      if (a.outcome==='win')   { byMonth[m].wins++;   byMonth[m].pnlSum+=(a.pnl_pct||0); }
      if (a.outcome==='loss')  { byMonth[m].losses++; byMonth[m].pnlSum+=(a.pnl_pct||0); }
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

// ─── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  status:   'ok',
  model:    process.env.AI_MODEL || 'qwen3-30b-a3b',
  env:      process.env.NODE_ENV || 'development',
  ts:       new Date().toISOString(),
  uptime:   Math.round(process.uptime()) + 's',
  protocol: req.protocol,
  host:     req.hostname,
}));


// ─── Email System ──────────────────────────────────────────────────────────────
const nodemailer  = require('nodemailer');
const emailTpls   = require('./templates/email');

function getMailer() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host, port: parseInt(process.env.SMTP_PORT||'587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendMail({ to, subject, html }) {
  const mailer = getMailer();
  if (!mailer) { console.log('[EMAIL] SMTP not configured — skip:', subject); return; }
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || '"CryptoEdge Pro" <no-reply@cryptoedge.pro>',
      to, subject, html
    });
    console.log('[EMAIL] Sent:', subject, '->', to);
  } catch(e) { console.error('[EMAIL] Error:', e.message); }
}

// ─── Password Reset ────────────────────────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
  try {
    const user = db.get('SELECT * FROM users WHERE email=?', [email]);
    // Always return success to avoid enumeration attacks
    if (!user) return res.json({ ok: true, message: 'Se o e-mail existir, você receberá as instruções' });

    const resetToken = require('crypto').randomBytes(32).toString('hex');
    const exp        = new Date(Date.now() + 30*60*1000).toISOString(); // 30 min
    
    // Store reset token in sessions table (reuse for simplicity)
    db.run('DELETE FROM sessions WHERE username=? AND token LIKE "reset_%"', [user.username]);
    db.insert('sessions', { token: 'reset_' + resetToken, username: user.username, expires_at: exp });

    const platformName = db.get("SELECT value FROM platform_settings WHERE key='platform_name'")?.value || 'CryptoEdge Pro';
    const resetLink    = (process.env.APP_URL || 'http://localhost:3000') + '/reset-password?token=' + resetToken;
    
    await sendMail({
      to: email,
      subject: '[' + platformName + '] Redefinição de senha',
      html: emailTpls.resetPassword(user.username, resetLink, '30 minutos')
    });

    res.json({ ok: true, message: 'Se o e-mail existir, você receberá as instruções em breve' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Validate reset token page
app.get('/reset-password', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'reset-password.html'));
});

// Execute password reset
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Token e nova senha (mín. 6 chars) obrigatórios' });
  try {
    const sess = db.get('SELECT * FROM sessions WHERE token=? AND expires_at > datetime("now")', ['reset_' + token]);
    if (!sess) return res.status(400).json({ error: 'Token inválido ou expirado. Solicite nova redefinição.' });
    
    db.run('UPDATE users SET password=? WHERE username=?', [hashPass(newPassword), sess.username]);
    db.run('DELETE FROM sessions WHERE token=?', ['reset_' + token]);

    // Send confirmation email
    const user = db.get('SELECT email FROM users WHERE username=?', [sess.username]);
    if (user?.email) {
      await sendMail({ to: user.email, subject: 'Senha alterada — CryptoEdge Pro', html: emailTpls.passwordChanged(sess.username) });
    }

    res.json({ ok: true, message: 'Senha redefinida com sucesso! Faça login com sua nova senha.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: Send invite via email
app.post('/api/admin/invite-email', requireAuth, (req, res) => {
  const { username } = db.get('SELECT role FROM users WHERE username=?', [req.user]) || {};
  if (username !== 'admin' && db.get('SELECT role FROM users WHERE username=?', [req.user])?.role !== 'admin')
    return res.status(403).json({ error: 'Apenas admins' });
  
  const user = db.get('SELECT role FROM users WHERE username=?', [req.user]);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
  
  const { toEmail, code, plan, expiresAt } = req.body || {};
  if (!toEmail || !code) return res.status(400).json({ error: 'E-mail e código obrigatórios' });
  
  const platformName = db.get("SELECT value FROM platform_settings WHERE key='platform_name'")?.value || 'CryptoEdge Pro';
  const expDate = expiresAt ? new Date(expiresAt).toLocaleDateString('pt-BR') : '30 dias';

  sendMail({
    to: toEmail,
    subject: 'Você foi convidado — ' + platformName,
    html: emailTpls.invite(req.user, code, platformName, plan, expDate)
  }).then(() => res.json({ ok: true })).catch(e => res.status(500).json({ error: e.message }));
});

// ─── MT5 / ProfitChart Integration ────────────────────────────────────────────
// Webhook: receive signals FROM MT5/ProfitChart → register trade
app.post('/api/webhook/signal', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (!apiKey) return res.status(401).json({ error: 'x-api-key header required' });
  
  try {
    const user = db.get('SELECT * FROM users WHERE binance_key=?', [apiKey]);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });

    const { symbol, direction, entry, exit, size, leverage, pnl, pnl_pct, result, reason } = req.body || {};
    if (!symbol || !direction) return res.status(400).json({ error: 'symbol and direction required' });

    const id = db.insert('trades', {
      username: user.username, pair: symbol.replace('USDT','').replace('USD','')+'/USDT',
      direction: direction === 'BUY' || direction === 'Long' ? 'Long' : 'Short',
      entry: parseFloat(entry)||0, exit: exit ? parseFloat(exit) : null,
      size: parseFloat(size)||0, leverage: leverage ? leverage+'x' : '1x',
      reason: reason || 'Sinal MT5/ProfitChart',
      result: result || (exit ? (pnl>0?'win':'loss') : 'pending'),
      pnl: parseFloat(pnl)||0, pnl_pct: parseFloat(pnl_pct)||0,
      created_at: new Date().toLocaleString('pt-BR')
    });
    res.json({ ok: true, id, message: 'Trade registrado com sucesso' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Webhook: send signals TO MT5/ProfitChart (poll endpoint)
app.get('/api/webhook/signals', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (!apiKey) return res.status(401).json({ error: 'x-api-key header required' });
  try {
    const user = db.get('SELECT * FROM users WHERE binance_key=?', [apiKey]);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    const since = req.query.since || new Date(Date.now()-60000).toISOString();
    const signals = db.all(
      'SELECT * FROM analysis_history WHERE username=? AND created_at > ? AND outcome="pending" ORDER BY created_at DESC LIMIT 10',
      [user.username, since]
    );
    res.json({ ok: true, signals: signals.map(s => ({
      id: s.id, symbol: s.symbol.replace('/',''), timeframe: s.timeframe,
      price: s.price, suggestion: JSON.parse(s.suggestion||'{}'),
      created_at: s.created_at
    })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// MT5/ProfitChart: get user API key for webhook authentication
app.get('/api/webhook/my-key', requireAuth, (req, res) => {
  try {
    const user = db.get('SELECT binance_key, username FROM users WHERE username=?', [req.user]);
    const webhook = (process.env.APP_URL || 'http://localhost:3000') + '/api/webhook/signal';
    res.json({
      ok: true,
      api_key: user?.binance_key || 'Configure sua Binance API Key em Meu Perfil primeiro',
      webhook_url: webhook,
      instructions: 'Use x-api-key: SUA_BINANCE_KEY no header das requisições'
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Binance API Proxy (fixes CORS on localhost) ──────────────────────────────
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
    const { symbol } = req.query;
    const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: { symbol }, timeout: 8000
    });
    res.json(r.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Analysis AI Auto-Track P&L ───────────────────────────────────────────────
// Cron-like check: update outcomes for pending analyses based on price movement
app.post('/api/analysis/auto-track', requireAuth, async (req, res) => {
  try {
    const pending = db.all(
      "SELECT * FROM analysis_history WHERE username=? AND outcome='pending' AND created_at > datetime('now','-7 days') ORDER BY created_at DESC LIMIT 20",
      [req.user]
    );
    if (!pending.length) return res.json({ ok: true, updated: 0 });

    // Get current prices for relevant symbols
    const symbols = [...new Set(pending.map(a => a.symbol.replace('/','').replace('-','') + 'USDT'))];
    const updates = [];

    await Promise.allSettled(symbols.map(async sym => {
      try {
        const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
          params: { symbol: sym }, timeout: 5000
        });
        const currentPrice = parseFloat(r.data.lastPrice);
        // Update analyses for this symbol
        pending.filter(a => a.symbol.includes(sym.replace('USDT',''))).forEach(a => {
          const sg = JSON.parse(a.suggestion || '{}');
          const dir = sg.direction;
          const entry = a.price;
          if (!entry || !dir || dir === 'flat') return;
          const pnlPct = dir === 'long'
            ? ((currentPrice - entry) / entry) * 100
            : ((entry - currentPrice) / entry) * 100;
          // Signal reached +2% = win, -1.5% = loss (based on ATR logic)
          let outcome = 'pending';
          if (pnlPct >= 2.0)  outcome = 'win';
          if (pnlPct <= -1.5) outcome = 'loss';
          if (outcome !== 'pending') {
            db.run(
              'UPDATE analysis_history SET outcome=?, outcome_price=?, pnl_pct=?, closed_at=datetime("now") WHERE id=? AND username=?',
              [outcome, currentPrice, Math.round(pnlPct*100)/100, a.id, req.user]
            );
            updates.push({ id: a.id, symbol: a.symbol, outcome, pnlPct: Math.round(pnlPct*100)/100 });
          }
        });
      } catch {}
    }));

    res.json({ ok: true, updated: updates.length, updates });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get detailed P&L stats for AI signals
app.get('/api/analysis/pnl-stats', requireAuth, (req, res) => {
  try {
    const { period } = req.query; // 'week' | 'month' | 'year' | 'all'
    let sinceDate = '';
    if (period === 'week')  sinceDate = "AND created_at > datetime('now','-7 days')";
    if (period === 'month') sinceDate = "AND created_at > datetime('now','-30 days')";
    if (period === 'year')  sinceDate = "AND created_at > datetime('now','-365 days')";

    const all = db.all(
      `SELECT * FROM analysis_history WHERE username=? ${sinceDate} ORDER BY created_at DESC`,
      [req.user]
    );
    const closed = all.filter(a => a.outcome && a.outcome !== 'pending');
    const wins   = closed.filter(a => a.outcome === 'win');
    const losses = closed.filter(a => a.outcome === 'loss');
    const pnlSum = closed.reduce((s,a) => s + (a.pnl_pct||0), 0);
    const avgPnl = closed.length ? pnlSum / closed.length : 0;
    const bestWin  = wins.length   ? Math.max(...wins.map(a => a.pnl_pct||0))   : 0;
    const worstLoss= losses.length ? Math.min(...losses.map(a => a.pnl_pct||0)) : 0;

    // By symbol performance
    const bySymbol = {};
    closed.forEach(a => {
      if (!bySymbol[a.symbol]) bySymbol[a.symbol] = { symbol:a.symbol, trades:0, wins:0, losses:0, pnl:0 };
      bySymbol[a.symbol].trades++;
      if (a.outcome==='win')  { bySymbol[a.symbol].wins++;  bySymbol[a.symbol].pnl+=(a.pnl_pct||0); }
      if (a.outcome==='loss') { bySymbol[a.symbol].losses++; bySymbol[a.symbol].pnl+=(a.pnl_pct||0); }
    });

    // Daily P&L
    const dailyPnl = {};
    closed.forEach(a => {
      const day = (a.closed_at||a.created_at||'').slice(0,10);
      if (!dailyPnl[day]) dailyPnl[day] = { day, pnl:0, wins:0, losses:0 };
      dailyPnl[day].pnl += (a.pnl_pct||0);
      if (a.outcome==='win')  dailyPnl[day].wins++;
      if (a.outcome==='loss') dailyPnl[day].losses++;
    });

    res.json({
      ok: true,
      period: period || 'all',
      summary: {
        total: all.length, closed: closed.length, pending: all.length - closed.length,
        wins: wins.length, losses: losses.length,
        accuracy: closed.length ? Math.round(wins.length/closed.length*100) : null,
        pnlSum: Math.round(pnlSum*100)/100,
        avgPnl: Math.round(avgPnl*100)/100,
        bestWin: Math.round(bestWin*100)/100,
        worstLoss: Math.round(worstLoss*100)/100,
      },
      bySymbol: Object.values(bySymbol)
        .sort((a,b) => b.pnl - a.pnl)
        .map(s => ({ ...s, accuracy: Math.round(s.wins/(s.trades||1)*100), pnl: Math.round(s.pnl*100)/100 })),
      dailyPnl: Object.values(dailyPnl).sort((a,b) => a.day.localeCompare(b.day))
        .map(d => ({ ...d, pnl: Math.round(d.pnl*100)/100 })),
      recentSignals: all.slice(0, 20)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Binance Account Balance (real) ───────────────────────────────────────────
app.get('/api/binance/balance', requireAuth, async (req, res) => {
  try {
    const user = db.get('SELECT binance_key, binance_secret FROM users WHERE username=?', [req.user]);
    if (!user?.binance_key || !user?.binance_secret)
      return res.json({ ok: false, error: 'Binance API Key não configurada em Meu Perfil', simulated: true, balance: 500 });

    const crypto   = require('crypto');
    const ts       = Date.now();
    const qsFutures = `timestamp=${ts}`;
    const sigF     = crypto.createHmac('sha256', user.binance_secret).update(qsFutures).digest('hex');

    // Try Futures balance first (USD-M)
    let totalUSDT = 0, walletData = [], source = 'futures';
    try {
      const rF = await axios.get('https://fapi.binance.com/fapi/v2/balance', {
        params: { timestamp: ts, signature: sigF },
        headers: { 'X-MBX-APIKEY': user.binance_key },
        timeout: 8000
      });
      const futuresBalances = rF.data.filter(b => parseFloat(b.balance) > 0);
      totalUSDT = futuresBalances.reduce((s, b) => s + parseFloat(b.balance), 0);
      walletData = futuresBalances.map(b => ({
        asset: b.asset, balance: parseFloat(b.balance).toFixed(2),
        unrealizedProfit: parseFloat(b.crossUnPnl||0).toFixed(2)
      }));
    } catch {
      // Fallback: Spot balance
      source = 'spot';
      const qsSpot = `timestamp=${ts}`;
      const sigS   = crypto.createHmac('sha256', user.binance_secret).update(qsSpot).digest('hex');
      const rS = await axios.get('https://api.binance.com/api/v3/account', {
        params: { timestamp: ts, signature: sigS },
        headers: { 'X-MBX-APIKEY': user.binance_key },
        timeout: 8000
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
    const errMsg = e.response?.data?.msg || e.message;
    res.json({ ok: false, error: errMsg, simulated: true, balance: 500 });
  }
});

// ─── Legal pages ──────────────────────────────────────────────────────────────
const path2 = require('path');
app.get('/privacy', (req, res) => res.sendFile(path2.join(__dirname, 'public', 'privacy.html')));
app.get('/terms',   (req, res) => res.sendFile(path2.join(__dirname, 'public', 'terms.html')));
app.get('/offline', (req, res) => res.sendFile(path2.join(__dirname, 'public', 'offline.html')));

// ─── Static files + SPA Fallback ──────────────────────────────────────────────
// Registered LAST so /api routes take priority
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag: true,
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── HTTP + WebSocket Server ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// Initialize SQLite then start server
db.init().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`\n  🚀  CryptoEdge Pro  →  http://localhost:${PORT}`);
    console.log(`  🤖  Modelo IA: ${process.env.AI_MODEL || 'qwen3-30b-a3b'}`);
    console.log(`  💾  SQLite: ${process.env.DB_PATH || './data'}/cryptoedge.db\n`);
  });

// WebSocket relay — tenta conectar na Binance e repassa ao browser
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
  // Binance allows max ~200 streams per connection — split into chunks of 50
  const chunk1 = PAIRS.slice(0,  50).map(p => p + '@ticker').join('/');
  const chunk2 = PAIRS.slice(50, 100).map(p => p + '@ticker').join('/');
  const streams = chunk1;  // primary stream
  const wsUrl   = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  let bWs = null;
  let retries = 0;

  function connect() {
    try {
      bWs = new WebSocket(wsUrl);

      bWs.on('open', () => {
        retries = 0;
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'ws_connected' }));
        }
      });

      bWs.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
      });

      bWs.on('error', () => {});
      bWs.on('close', () => {
        if (clientWs.readyState === WebSocket.OPEN && retries < 3) {
          retries++;
          setTimeout(connect, 3000 * retries);
        }
      });
    } catch {}
  }

  connect();
  clientWs.on('close', () => { try { bWs?.close(); bWs2?.close(); } catch {} });
  clientWs.on('error', () => { try { bWs?.close(); bWs2?.close(); } catch {} });
});

  process.on('SIGTERM', () => { server.close(); process.exit(0); });

}).catch(err => {
  console.error('❌ Failed to initialize SQLite:', err);
  process.exit(1);
});
