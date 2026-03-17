/**
 * CryptoEdge Pro — SQLite Database Layer v2.0
 * Melhorias: save urgente para operações críticas, tabela password_resets,
 *            webhook_token dedicado, colunas screenshot/notes/tags em trades
 */
'use strict';

const path    = require('path');
const fs      = require('fs');
const initSQL = require('sql.js');

const DB_PATH = process.env.DB_PATH || '/data';
const DB_FILE = path.join(DB_PATH, 'cryptoedge.db');

let _db = null;
let _saveTimer = null;

function saveNow() {
  try {
    fs.mkdirSync(DB_PATH, { recursive: true });
    fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
  } catch(e) { console.error('[DB] SaveNow error:', e.message); }
}

function save(urgent = false) {
  if (urgent) { saveNow(); return; }
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DB_PATH, { recursive: true });
      fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
    } catch(e) { console.error('[DB] Save error:', e.message); }
  }, 300);
}

function all(sql, params = []) {
  try {
    const stmt = _db.prepare(sql); const rows = [];
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch(e) { console.error('[DB] all error:', e.message, '|', sql.slice(0,80)); return []; }
}

function get(sql, params = []) { return all(sql, params)[0] || null; }

function run(sql, params = [], urgent = false) {
  try { _db.run(sql, params); save(urgent); return true; }
  catch(e) { console.error('[DB] run error:', e.message); return false; }
}

function insert(table, obj, urgent = false) {
  const noPkTables = ['sessions','settings','watchlist','platform_settings','password_resets'];
  const hasPk = noPkTables.includes(table) || 'token' in obj || (table==='settings' && 'username' in obj);
  const id     = hasPk ? null : require('crypto').randomBytes(8).toString('hex');
  const record = id ? { id, ...obj } : { ...obj };
  const cols   = Object.keys(record);
  const vals   = Object.values(record);
  const phs    = cols.map(() => '?').join(',');
  _db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${phs})`, vals);
  save(urgent);
  return id || obj.token || obj.code || obj.username;
}

function update(table, set, where, whereVals = [], urgent = false) {
  const setCols = Object.keys(set).map(k => k + '=?').join(',');
  run(`UPDATE ${table} SET ${setCols} WHERE ${where}`, [...Object.values(set), ...whereVals], urgent);
}

function remove(table, where, whereVals = []) {
  run(`DELETE FROM ${table} WHERE ${where}`, whereVals);
}

function count(table, where = '1=1', params = []) {
  const r = get(`SELECT COUNT(*) as n FROM ${table} WHERE ${where}`, params);
  return r ? r.n : 0;
}

async function init() {
  fs.mkdirSync(DB_PATH, { recursive: true });
  const SQL = await initSQL();
  _db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();

  _db.run('PRAGMA journal_mode=WAL');
  _db.run('PRAGMA foreign_keys=ON');
  _db.run('PRAGMA synchronous=NORMAL');

  _db.run(`CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username        TEXT UNIQUE NOT NULL,
    email           TEXT,
    password        TEXT NOT NULL,
    role            TEXT DEFAULT 'user',
    plan            TEXT DEFAULT 'basic',
    status          TEXT DEFAULT 'active',
    binance_key     TEXT DEFAULT '',
    binance_secret  TEXT DEFAULT '',
    binance_secret_enc TEXT DEFAULT '',
    laozhang_key    TEXT DEFAULT '',
    telegram_token  TEXT DEFAULT '',
    telegram_chatid TEXT DEFAULT '',
    webhook_token   TEXT DEFAULT '',
    invite_code     TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now')),
    last_login      TEXT
  )`);

  // Migrate existing users table
  const userCols = all("PRAGMA table_info(users)").map(c => c.name);
  if (!userCols.includes('binance_secret_enc'))  { try { _db.run("ALTER TABLE users ADD COLUMN binance_secret_enc TEXT DEFAULT ''"); } catch {} }
  if (!userCols.includes('webhook_token'))        { try { _db.run("ALTER TABLE users ADD COLUMN webhook_token TEXT DEFAULT ''"); } catch {} }
  if (!userCols.includes('signals_enabled'))      { try { _db.run("ALTER TABLE users ADD COLUMN signals_enabled INTEGER DEFAULT 0"); } catch {} }
  if (!userCols.includes('signals_plan'))         { try { _db.run("ALTER TABLE users ADD COLUMN signals_plan TEXT DEFAULT 'free'"); } catch {} }
  // Admin recebe sinais por padrão
  try { _db.run("UPDATE users SET signals_enabled=1 WHERE role='admin' AND signals_enabled=0"); } catch {}

  _db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS password_resets (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS trades (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username   TEXT DEFAULT '',
    pair       TEXT, direction TEXT, entry REAL, exit REAL,
    size REAL, leverage TEXT DEFAULT '1x', reason TEXT,
    result TEXT DEFAULT 'pending', pnl REAL DEFAULT 0, pnl_pct REAL DEFAULT 0,
    screenshot TEXT DEFAULT '',
    notes      TEXT DEFAULT '',
    tags       TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
  )`);

  // Migrate trades table
  const tradeCols = all("PRAGMA table_info(trades)").map(c => c.name);
  if (!tradeCols.includes('screenshot')) { try { _db.run("ALTER TABLE trades ADD COLUMN screenshot TEXT DEFAULT ''"); } catch {} }
  if (!tradeCols.includes('notes'))      { try { _db.run("ALTER TABLE trades ADD COLUMN notes TEXT DEFAULT ''"); } catch {} }
  if (!tradeCols.includes('tags'))       { try { _db.run("ALTER TABLE trades ADD COLUMN tags TEXT DEFAULT '[]'"); } catch {} }

  _db.run(`CREATE TABLE IF NOT EXISTS watchlist (
    id       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username TEXT NOT NULL,
    symbol   TEXT NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(username, symbol)
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS alerts (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username     TEXT NOT NULL,
    symbol       TEXT NOT NULL,
    condition    TEXT NOT NULL,
    price        REAL NOT NULL,
    note         TEXT DEFAULT '',
    triggered    INTEGER DEFAULT 0,
    triggered_at TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS settings (
    username   TEXT PRIMARY KEY,
    data       TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS analysis_history (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username      TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    timeframe     TEXT,
    price         REAL,
    suggestion    TEXT,
    tech_score    REAL,
    smc_bias      TEXT,
    patterns      TEXT DEFAULT '[]',
    outcome       TEXT DEFAULT 'pending',
    outcome_price REAL,
    pnl_pct       REAL,
    month         TEXT,
    year          TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    closed_at     TEXT
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS invite_codes (
    code       TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    used_by    TEXT DEFAULT NULL,
    used_at    TEXT DEFAULT NULL,
    max_uses   INTEGER DEFAULT 1,
    uses       INTEGER DEFAULT 0,
    plan       TEXT DEFAULT 'basic',
    expires_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS platform_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS bot_logs (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username   TEXT,
    event      TEXT,
    data       TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Indexes
  _db.run('CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(username, created_at)');

  _db.run(`CREATE TABLE IF NOT EXISTS bot_trades (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
    entry REAL NOT NULL, exit_price REAL, qty REAL NOT NULL,
    sl REAL DEFAULT 0, tp REAL DEFAULT 0, pnl REAL DEFAULT 0,
    reason TEXT DEFAULT '', strategy TEXT DEFAULT '', status TEXT DEFAULT 'open',
    opened_at TEXT DEFAULT (datetime('now')), closed_at TEXT
  )`);
  _db.run('CREATE INDEX IF NOT EXISTS idx_bot_trades_u ON bot_trades(username, opened_at)');

  _db.run(`CREATE TABLE IF NOT EXISTS paper_accounts (
    username TEXT PRIMARY KEY, balance REAL DEFAULT 1000, initial REAL DEFAULT 1000,
    pnl_total REAL DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username TEXT NOT NULL, plan TEXT DEFAULT 'free', status TEXT DEFAULT 'active',
    price_brl REAL DEFAULT 0, started_at TEXT DEFAULT (datetime('now')), expires_at TEXT
  )`);
  _db.run('CREATE INDEX IF NOT EXISTS idx_subs_u ON subscriptions(username)');

  const alertCols = all("PRAGMA table_info(alerts)").map(c => c.name);
  if (!alertCols.includes('auto_execute')) {
    try { _db.run("ALTER TABLE alerts ADD COLUMN auto_execute INTEGER DEFAULT 0"); } catch {}
    try { _db.run("ALTER TABLE alerts ADD COLUMN execute_side TEXT DEFAULT ''"); } catch {}
    try { _db.run("ALTER TABLE alerts ADD COLUMN execute_capital REAL DEFAULT 0"); } catch {}
  }
  _db.run('CREATE INDEX IF NOT EXISTS idx_analysis_user ON analysis_history(username, month)');
  _db.run('CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(username, triggered)');
  _db.run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');
  _db.run('CREATE INDEX IF NOT EXISTS idx_pw_resets ON password_resets(token, username)');

  // Default platform settings
  [
    ['registration_mode', 'invite'],
    ['platform_name',     'CryptoEdge Pro'],
    ['max_users',         '100'],
  ].forEach(([k,v]) => {
    try { _db.run("INSERT OR IGNORE INTO platform_settings (key,value) VALUES (?,?)", [k,v]); } catch(e){}
  });

  saveNow();
  console.log('[DB] SQLite initialized ->', DB_FILE);
  return _db;
}

process.on('exit',    () => { try { fs.writeFileSync(DB_FILE, Buffer.from(_db.export())); } catch{} });
process.on('SIGINT',  () => { try { fs.writeFileSync(DB_FILE, Buffer.from(_db.export())); } catch{} process.exit(0); });
process.on('SIGTERM', () => { try { fs.writeFileSync(DB_FILE, Buffer.from(_db.export())); } catch{} process.exit(0); });

module.exports = { init, all, get, run, insert, update, remove, count, save, saveNow };
