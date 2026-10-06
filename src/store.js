import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { message } from './messages.js';
import { valuePortfolio } from './portfolio.js';
import { LIMITS } from './config.js';
export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cycles(symbol TEXT NOT NULL, candle INTEGER NOT NULL, id TEXT UNIQUE NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(symbol,candle));
      CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
    // Retain a consistent SQLite backup before the first legacy schema upgrade.
    const legacySchema = !this.db.prepare('PRAGMA table_info(cycles)').all().some(c => c.name === 'symbol');
    if (legacySchema && file !== ':memory:' && !fs.existsSync(file + '.pre-multi-coin.bak')) {
      this.db.exec("VACUUM INTO '" + (file + '.pre-multi-coin.bak').replaceAll("'", "''") + "'");
    }
    // Upgrade the original single-coin database atomically, preserving candle claims and balances.
    if (!this.db.prepare('PRAGMA table_info(cycles)').all().some(c => c.name === 'symbol')) {
      this.transaction(() => {
        this.db.exec(`ALTER TABLE cycles RENAME TO cycles_v1;
          CREATE TABLE cycles(symbol TEXT NOT NULL,candle INTEGER NOT NULL,id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(symbol,candle));
          INSERT INTO cycles SELECT 'BTC-USD',candle,id,status,created FROM cycles_v1;
          DROP TABLE cycles_v1;`);
      });
    }
    if (!this.get('wallet')) this.set('wallet', { cash: LIMITS.initialCash, positions: {}, fees: 0, realizedPnl: 0, dailyDate: null, dailyStart: null, drawdownPaused: false });
    const legacy = this.get('wallet');
    if (!legacy.positions) {
      const { btc, costBasis, ...retained } = legacy;
      this.set('wallet', { ...retained, positions: { 'BTC-USD': { qty: btc ?? 0, costBasis: costBasis ?? 0 } } });
      const price = this.get('markPrice');
      if (price) this.set('marks', { 'BTC-USD': { price, timestamp: this.get('markTimestamp') ?? 0 } });
    }
    this.set('mode', 'stopped'); // Processes never automatically resume after a restart.
    for (const cycle of this.db.prepare("SELECT symbol,candle,id FROM cycles WHERE status='processing'").all()) {
      this.transaction(() => {
        const executed = this.hasTrade(cycle.id);
        const reason = executed ? 'Recovered a committed paper fill after interruption. It will not be replayed.' : 'Process interrupted this cycle. It will not be replayed; wait for the next completed candle.';
        const status = executed ? 'EXECUTED' : 'INTERRUPTED';
        this.finish(cycle.candle, status, cycle.symbol);
        this.decision({ id: cycle.id, symbol: cycle.symbol, candle: cycle.candle, timestamp: new Date().toISOString(), status, reason });
        this.addMessage(message(cycle.id, 'Controller', 'User', { decision: executed ? 'EXECUTED' : 'CANCELLED', reason, symbol: cycle.symbol, evidence: ['Restart recovery from durable cycle and trade records.'] }));
      });
    }
  }
  get(key) { const r = this.db.prepare('SELECT value FROM state WHERE key=?').get(key); return r ? JSON.parse(r.value) : null; }
  set(key, value) { this.db.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run(key, JSON.stringify(value)); }
  addMessage(m) { this.db.prepare('INSERT INTO messages(body) VALUES (?)').run(JSON.stringify(m)); }
  claim(candle, id, now, symbol = 'BTC-USD') { return !!this.db.prepare('INSERT OR IGNORE INTO cycles VALUES (?,?,?,?,?)').run(symbol, candle, id, 'processing', new Date(now).toISOString()).changes; }
  finish(candle, status, symbol = 'BTC-USD') { this.db.prepare('UPDATE cycles SET status=? WHERE symbol=? AND candle=?').run(status, symbol, candle); }
  decision(d) { this.db.prepare('INSERT OR REPLACE INTO decisions VALUES (?,?)').run(d.id, JSON.stringify(d)); }
  hasTrade(id) { return !!this.db.prepare('SELECT id FROM trades WHERE id=?').get(id); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  recent(table, limit = 200) { if (!['messages', 'trades', 'decisions'].includes(table)) throw Error('Invalid table'); return this.db.prepare(`SELECT body FROM ${table} ORDER BY rowid DESC LIMIT ?`).all(limit).map(r => JSON.parse(r.body)); }
  snapshot(marks = this.get('marks')) {
    const w = this.get('wallet'), v = valuePortfolio(w, marks);
    return { ...w, ...v, pnl: v.equity === null ? null : v.equity - LIMITS.initialCash, unrealizedPnl: v.marketValue === null ? null : v.marketValue - v.costBasis, exposure: v.equity ? v.marketValue / v.equity : null };
  }
  close() { this.db.close(); }
}
