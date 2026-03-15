/**
 * CryptoEdge Pro — SQLite Database Layer (sql.js / pure JS)
 */
'use strict';

const path    = require('path');
const fs      = require('fs');
const initSQL = require('sql.js');

const DB_PATH = process.env.DB_PATH || './data';
const DB_FILE = path.join(DB_PATH, 'cryptoedge.db');

let _db = null;
let _saveTimer = null;

async function init() {
  fs.mkdirSync(DB_PATH, { recursive: true });
  const SQL = await initSQL();

  if (fs.existsSync(DB_FILE)) {
    _db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    _db = new SQL.Database();
  }

  _db.run('PRAGMA journal_mode=WAL');
  _db.run('PRAGMA foreign_keys=ON');

  _db.run(`CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username       TEXT UNIQUE NOT NULL,
    email          TEXT,
    password       TEXT NOT NULL,
    role           TEXT DEFAULT 'user',
    plan           TEXT DEFAULT 'basic',
    status         TEXT DEFAULT 'active',
    binance_key    TEXT DEFAULT '',
    binance_secret TEXT DEFAULT '',
    laozhang_key   TEXT DEFAULT '',
    telegram_token TEXT DEFAULT '',
    telegram_chatid TEXT DEFAULT '',
    invite_code    TEXT DEFAULT '',
    created_at     TEXT DEFAULT (datetime('now')),
    last_login     TEXT
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS trades (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username   TEXT DEFAULT '',
    pair       TEXT, direction TEXT, entry REAL, exit REAL,
    size REAL, leverage TEXT DEFAULT '1x', reason TEXT,
    result TEXT DEFAULT 'pending', pnl REAL DEFAULT 0, pnl_pct REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS watchlist (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username   TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    added_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(username, symbol)
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS alerts (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username    TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    condition   TEXT NOT NULL,
    price       REAL NOT NULL,
    note        TEXT DEFAULT '',
    triggered   INTEGER DEFAULT 0,
    triggered_at TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS settings (
    username TEXT PRIMARY KEY,
    data     TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS analysis_history (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username    TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    timeframe   TEXT,
    price       REAL,
    suggestion  TEXT,
    tech_score  REAL,
    smc_bias    TEXT,
    patterns    TEXT DEFAULT '[]',
    outcome     TEXT DEFAULT 'pending',
    outcome_price REAL,
    pnl_pct     REAL,
    month       TEXT,
    year        TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    closed_at   TEXT
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
  _db.run('CREATE INDEX IF NOT EXISTS idx_analysis_user ON analysis_history(username, month)');
  _db.run('CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(username, triggered)');
  _db.run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');

  // Default platform settings
  [
    ['registration_mode', 'invite'],
    ['platform_name',     'CryptoEdge Pro'],
    ['max_users',         '100'],
  ].forEach(([k,v]) => {
    try { _db.run("INSERT OR IGNORE INTO platform_settings (key,value) VALUES (?,?)", [k,v]); } catch(e){}
  });

  save();
  console.log('[DB] SQLite initialized ->', DB_FILE);
  return _db;
}

function save() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
    } catch(e) { console.error('[DB] Save error:', e.message); }
  }, 500);
}

function all(sql, params = []) {
  try {
    const stmt = _db.prepare(sql); const rows = [];
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch(e) { console.error('[DB] all error:', e.message); return []; }
}

function get(sql, params = []) { return all(sql, params)[0] || null; }

function run(sql, params = []) {
  try { _db.run(sql, params); save(); return true; }
  catch(e) { console.error('[DB] run error:', e.message); return false; }
}

function insert(table, obj) {
  const noPkTables = ['sessions', 'settings', 'watchlist', 'platform_settings'];
  const hasPk = noPkTables.includes(table) || 'token' in obj || ('username' in obj && table === 'settings');
  const id     = hasPk ? null : require('crypto').randomBytes(8).toString('hex');
  const record = id ? { id, ...obj } : { ...obj };
  const cols   = Object.keys(record);
  const vals   = Object.values(record);
  const phs    = cols.map(() => '?').join(',');
  run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${phs})`, vals);
  return id || obj.token || obj.code || (obj.username && obj.username);
}

function update(table, set, where, whereVals = []) {
  const setCols = Object.keys(set).map(k => k + '=?').join(',');
  run(`UPDATE ${table} SET ${setCols} WHERE ${where}`, [...Object.values(set), ...whereVals]);
}

function remove(table, where, whereVals = []) {
  run(`DELETE FROM ${table} WHERE ${where}`, whereVals);
}

function count(table, where = '1=1', params = []) {
  const r = get(`SELECT COUNT(*) as n FROM ${table} WHERE ${where}`, params);
  return r ? r.n : 0;
}

process.on('exit',    () => { try { fs.writeFileSync(DB_FILE, Buffer.from(_db.export())); } catch{} });
process.on('SIGINT',  () => { try { fs.writeFileSync(DB_FILE, Buffer.from(_db.export())); } catch{} process.exit(0); });
process.on('SIGTERM', () => { try { fs.writeFileSync(DB_FILE, Buffer.from(_db.export())); } catch{} process.exit(0); });

module.exports = { init, all, get, run, insert, update, remove, count, save };
