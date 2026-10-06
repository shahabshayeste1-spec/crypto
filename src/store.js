import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { message } from './messages.js';
import { LIMITS } from './config.js';
export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cycles(candle INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
    if (!this.get('wallet')) this.set('wallet', { cash: LIMITS.initialCash, btc: 0, costBasis: 0, fees: 0, realizedPnl: 0, dailyDate: null, dailyStart: null, drawdownPaused: false });
    this.set('mode', 'stopped'); // Processes never automatically resume after a restart.
    for (const cycle of this.db.prepare("SELECT candle,id FROM cycles WHERE status='processing'").all()) {
      this.transaction(() => {
        const executed = this.hasTrade(cycle.id);
        const reason = executed ? 'Recovered a committed paper fill after interruption. It will not be replayed.' : 'Process interrupted this cycle. It will not be replayed; wait for the next completed candle.';
        const status = executed ? 'EXECUTED' : 'INTERRUPTED';
        this.finish(cycle.candle, status);
        this.decision({ id: cycle.id, candle: cycle.candle, timestamp: new Date().toISOString(), status, reason });
        this.addMessage(message(cycle.id, 'Controller', 'User', { decision: executed ? 'EXECUTED' : 'CANCELLED', reason, evidence: ['Restart recovery from durable cycle and trade records.'] }));
      });
    }
  }
  get(key) { const r = this.db.prepare('SELECT value FROM state WHERE key=?').get(key); return r ? JSON.parse(r.value) : null; }
  set(key, value) { this.db.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run(key, JSON.stringify(value)); }
  addMessage(m) { this.db.prepare('INSERT INTO messages(body) VALUES (?)').run(JSON.stringify(m)); }
  claim(candle, id, now) { return !!this.db.prepare('INSERT OR IGNORE INTO cycles VALUES (?,?,?,?)').run(candle, id, 'processing', new Date(now).toISOString()).changes; }
  finish(candle, status) { this.db.prepare('UPDATE cycles SET status=? WHERE candle=?').run(status, candle); }
  decision(d) { this.db.prepare('INSERT OR REPLACE INTO decisions VALUES (?,?)').run(d.id, JSON.stringify(d)); }
  hasTrade(id) { return !!this.db.prepare('SELECT id FROM trades WHERE id=?').get(id); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  recent(table, limit = 200) { if (!['messages', 'trades', 'decisions'].includes(table)) throw Error('Invalid table'); return this.db.prepare(`SELECT body FROM ${table} ORDER BY rowid DESC LIMIT ?`).all(limit).map(r => JSON.parse(r.body)); }
  snapshot(price) {
    const w = this.get('wallet');
    const marketValue = price ? w.btc * price : null;
    const equity = marketValue === null ? (w.btc === 0 ? w.cash : null) : w.cash + marketValue;
    return { ...w, marketValue, equity, pnl: equity === null ? null : equity - LIMITS.initialCash, unrealizedPnl: marketValue === null ? null : marketValue - w.costBasis, exposure: equity ? marketValue / equity : null };
  }
  close() { this.db.close(); }
}
