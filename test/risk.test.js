import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, markDaily } from '../src/risk.js';
import { config, NOW, newStore, context, quote } from './helpers.js';
const buy = (id, amountUsd = 500) => ({ id, decision: 'BUY', amountUsd });
const run = (s, p, ctx = context, q = quote) => execute(s, p, q, config, ctx, NOW);
test('fixed buy, exposure and cash limits; no shorting; approvals required', () => {
  const s = newStore();
  assert.match(run(s, buy('too-big', 501)).reason, /500/);
  assert.match(run(s, buy('no-approval'), { ...context, approved: false }).reason, /Approval/);
  for (let i = 0; i < 4; i++) assert.equal(run(s, buy(`buy-${i}`)).status, 'EXECUTED');
  assert.match(run(s, buy('exposure')).reason, /20%/);
  assert.ok(s.snapshot(100).exposure <= .2);
  assert.match(run(s, { id: 'short', decision: 'SELL', amountUsd: 100000 }).reason, /owned/);
  const w = s.get('wallet'); w.cash = 1; w.dailyStart = w.cash + w.positions['BTC-USD'].qty * 100; w.drawdownPaused = false; s.set('wallet', w);
  assert.match(run(s, buy('cash')).reason, /cash/); s.close();
});
test('duplicates do not change wallet; stale, earlier and invalid quotes cannot fill', () => {
  const s = newStore(); assert.equal(run(s, buy('one')).status, 'EXECUTED');
  const before = s.get('wallet'); assert.match(run(s, buy('one')).reason, /Duplicate/); assert.deepEqual(s.get('wallet'), before);
  for (const q of [{ price: 100, timestamp: NOW - 1 }, { price: 100, timestamp: NOW - 31000 }, { price: NaN, timestamp: NOW }, { price: 100, timestamp: NOW + 2000 }]) assert.equal(run(s, buy('invalid'), context, q).status, 'REJECTED');
  assert.equal(s.recent('trades').length, 1); s.close();
});
test('paused entries, failed agents and stale data reject buys but permit exits', () => {
  const s = newStore(); run(s, buy('open'));
  for (const ctx of [{ ...context, mode: 'paused' }, { ...context, mode: 'stopped' }, { ...context, agentsHealthy: false }, { ...context, dataFresh: false }]) assert.equal(run(s, buy('blocked'), ctx).status, 'REJECTED');
  assert.equal(run(s, { id: 'exit', decision: 'SELL', amountUsd: 1 }, { ...context, exitAll: true, mode: 'stopped', dataFresh: false, agentsHealthy: false }).status, 'EXECUTED');
  assert.equal((s.get('wallet').positions['BTC-USD']?.qty ?? 0), 0); s.close();
});
test('daily 2% equity pause latches, survives rebound, resets on next UTC day; exits allowed', () => {
  const s = newStore(); run(s, buy('initial'));
  const w = s.get('wallet'); w.dailyStart = 11000; s.set('wallet', w);
  markDaily(s, 100, NOW); assert.equal(s.get('wallet').drawdownPaused, true);
  markDaily(s, 1000, NOW); assert.equal(s.get('wallet').drawdownPaused, true);
  assert.equal(run(s, buy('drawdown')).status, 'REJECTED');
  assert.equal(run(s, { id: 'exit', decision: 'SELL', amountUsd: 100 }, { ...context, exitAll: true }).status, 'EXECUTED');
  markDaily(s, 100, NOW + 86400000); assert.equal(s.get('wallet').drawdownPaused, false); s.close();
});
test('cash, fee-inclusive basis, realized/unrealized P&L and slippage calculations', () => {
  const s = newStore(); const r = run(s, buy('buy'));
  const qty = (500 / 1.001) / 100.05;
  assert.ok(Math.abs(r.trade.qty - qty) < 1e-12);
  assert.equal(s.get('wallet').cash, 9500); assert.equal(s.get('wallet').positions['BTC-USD'].costBasis, 500);
  const snap = s.snapshot(100); assert.ok(Math.abs(snap.pnl - (qty * 100 - 500)) < 1e-10);
  const sale = run(s, { id: 'sell', decision: 'SELL', amountUsd: 100 }, { ...context, exitAll: true }, { price: 110, timestamp: NOW });
  const proceeds = qty * 110 * .9995 * .999;
  const final = s.snapshot(110);
  assert.ok(Math.abs(final.cash - (9500 + proceeds)) < 1e-9);
  assert.ok(Math.abs(final.realizedPnl - (proceeds - 500)) < 1e-9);
  assert.equal(final.unrealizedPnl, 0); assert.equal(final.positions['BTC-USD'].qty, 0);
  assert.ok(Math.abs(final.fees - (r.trade.fee + sale.trade.fee)) < 1e-9); s.close();
});
test('partial sales retain proportional basis, then final sale reconciles P/L', () => {
  const s = newStore(); run(s, buy('open'));
  const before = s.get('wallet');
  run(s, { id: 'half', decision: 'SELL', amountUsd: before.positions['BTC-USD'].qty * 100 / 2 });
  const half = s.get('wallet'); assert.ok(Math.abs(half.positions['BTC-USD'].costBasis - 250) < 1e-9); assert.ok(Math.abs(half.positions['BTC-USD'].qty - before.positions['BTC-USD'].qty / 2) < 1e-12);
  run(s, { id: 'rest', decision: 'SELL', amountUsd: 1 }, { ...context, exitAll: true });
  const snap = s.snapshot(100); assert.ok(Math.abs(snap.realizedPnl - snap.pnl) < 1e-9); s.close();
});
