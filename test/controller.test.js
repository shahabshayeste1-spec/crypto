import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Controller } from '../src/controller.js';
import { Store } from '../src/store.js';
import { validateResponse, message } from '../src/messages.js';
import { config, NOW, newStore, candles, fixtureMarket, fixtureAgents } from './helpers.js';
const analyst = { decision: 'BUY', amountUsd: 500, evidence: ['OFFLINE evidence'], reason: 'OFFLINE fixture' };
const critique = decision => ({ decision, amountUsd: 0, evidence: ['OFFLINE critique'], reason: 'OFFLINE fixture' });
const create = (s = newStore(), m = fixtureMarket(), a = fixtureAgents()) => new Controller(s, m, a, config, () => NOW);
test('approved paper trade has full validated message history; same candle runs exactly once', async () => {
  const s = newStore(), agents = fixtureAgents(), c = create(s, fixtureMarket(), agents);
  await c.tick(); await c.tick();
  assert.equal(agents.calls, 2); assert.equal(s.recent('trades').length, 1); assert.equal(s.recent('decisions')[0].status, 'EXECUTED');
  const messages = s.recent('messages'); assert.equal(messages.length, 5);
  assert.equal(new Set(messages.map(m => m.proposalId)).size, 1);
  assert.equal(messages.find(m => m.sender === 'Critic').source, 'offline-fixture'); s.close();
});
test('critic rejection and excessive AI buy never execute', async () => {
  for (const responses of [[analyst, critique('REJECT')], [{ ...analyst, amountUsd: 501 }, critique('ACCEPT')]]) {
    const s = newStore(), c = create(s, fixtureMarket(), fixtureAgents(responses)); await c.tick();
    assert.equal(s.recent('trades').length, 0); assert.equal(s.recent('decisions')[0].status, 'REJECTED'); s.close();
  }
});
test('one revision ends cycle without unreviewed execution or endless debate', async () => {
  const s = newStore(), a = fixtureAgents([analyst, critique('REQUEST REVISION'), { ...analyst, amountUsd: 250 }]), c = create(s, fixtureMarket(), a);
  await c.tick(); await c.tick(); assert.equal(a.calls, 3); assert.equal(s.recent('trades').length, 0); assert.equal(s.recent('decisions')[0].status, 'REVISION DEFERRED'); s.close();
});
test('failed/invalid agents fail closed, redact errors and do not retry consumed candle', async () => {
  for (const responses of [[Error('secret-value')], [analyst, Error('secret-value')], [{ ...analyst, extra: 'unexpected' }], [analyst, critique('REQUEST REVISION'), Error('secret-value')]]) {
    const s = newStore(), a = fixtureAgents(responses), c = create(s, fixtureMarket(), a);
    await c.tick(); await c.tick(); assert.equal(s.recent('trades').length, 0); assert.equal(s.get('agents').healthy, false);
    assert.equal(s.recent('decisions')[0].status, 'FAILED'); assert.ok(!JSON.stringify(s.recent('messages')).includes('secret-value')); s.close();
  }
});
test('stale or failed data does not call agents; data becoming stale during calls blocks buys', async () => {
  const s = newStore(), a = fixtureAgents(), m = fixtureMarket(NOW - 900000), c = create(s, m, a);
  await c.tick(); assert.equal(a.calls, 0); assert.equal(c.status().markets['BTC-USD'].fresh, false);
  m.candles = async () => { throw Error('secret-value'); }; await c.tick(); assert.equal(c.status().markets['BTC-USD'].status, 'fetch failed');
  const freshMarket = fixtureMarket(); let clock = NOW;
  const late = fixtureAgents(); const originalAsk = late.ask; late.ask = async (...args) => { const r = await originalAsk(...args); clock += 300000; return r; };
  freshMarket.quote = async () => ({ price: 100, timestamp: clock });
  const c2 = new Controller(s, freshMarket, late, config, () => clock); await c2.tick(); assert.equal(s.recent('trades').length, 0); assert.equal(s.recent('decisions')[0].status, 'REJECTED'); s.close();
});
test('pause during approval blocks buys, stop cancels in-flight agents', async () => {
  for (const mode of ['paused', 'stopped']) {
    const s = newStore(), a = fixtureAgents(); let c;
    const original = a.ask; a.ask = async (...args) => { const r = await original(...args); c.setMode(mode); return r; };
    c = create(s, fixtureMarket(), a); await c.tick(); assert.equal(s.recent('trades').length, 0);
    assert.equal(s.recent('decisions')[0].status, mode === 'paused' ? 'REJECTED' : 'CANCELLED'); s.close();
  }
});
test('wallet, history, duplicate prevention and interrupted candle survive restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-restart-')); const file = path.join(dir, 'paper.sqlite');
  let s = new Store(file); s.set('mode', 'running'); const c = create(s); await c.tick();
  const wallet = s.get('wallet'), count = s.recent('messages').length; s.claim(candles().at(-1).time + 300000, 'interrupted', NOW); s.close();
  s = new Store(file); assert.equal(s.get('mode'), 'stopped'); assert.deepEqual(s.get('wallet'), wallet); assert.equal(s.recent('messages').length, count + 1);
  assert.equal(s.db.prepare('SELECT status FROM cycles WHERE id=?').get('interrupted').status, 'INTERRUPTED');
  const a = fixtureAgents(), restarted = create(s, fixtureMarket(), a); restarted.setMode('running'); await restarted.tick(); assert.equal(a.calls, 0); assert.equal(s.recent('trades').length, 1);
  s.close(); fs.rmSync(dir, { recursive: true });
});
test('manual exit remains available when stopped, with no agent calls', async () => {
  const s = newStore(), a = fixtureAgents(), c = create(s, fixtureMarket(), a); await c.tick(); c.setMode('stopped'); s.set('agents', { healthy: false });
  const r = await c.exitAll(); assert.equal(r.status, 'EXECUTED'); assert.equal(s.get('wallet').positions['BTC-USD'].qty, 0); assert.equal(a.calls, 2); s.close();
});
test('invalid schemas, envelope recipients and HOLD amounts are rejected', () => {
  assert.throws(() => validateResponse({ ...analyst, decision: 'HOLD', amountUsd: 1 }, 'Analyst'));
  assert.throws(() => validateResponse({ ...analyst, evidence: [] }, 'Analyst'));
  assert.throws(() => message('id', 'Intruder', 'Risk', analyst));
});
test('quote failure after approval does not fill; manual exit failure preserves the position', async () => {
  const s = newStore(), m = fixtureMarket(); let quotes = 0;
  m.quote = async () => { if (++quotes > 1) throw Error('network-secret'); return { price: 100, timestamp: NOW }; };
  const c = create(s,m); await c.tick();
  assert.equal(s.recent('trades').length,0); assert.equal(s.recent('decisions')[0].status,'FAILED');
  assert.ok(s.recent('messages').some(m=>m.decision==='APPROVED'));
  const before=s.get('wallet'); before.positions['BTC-USD']={qty:1,costBasis:100};before.cash=9900;s.set('wallet',before);
  const result=await c.exitAll();assert.equal(result.status,'PARTIAL');assert.equal(result.results[0].status,'FAILED');assert.deepEqual(s.get('wallet'),before);s.close();
});
test('concurrent scheduler calls cannot create overlapping cycles', async () => {
  const s=newStore(), a=fixtureAgents(); const original=a.ask; let unblock;
  const gate=new Promise(r=>{unblock=r;});a.ask=async(...args)=>{await gate;return original(...args);};
  const c=create(s,fixtureMarket(),a);const first=c.tick();await c.tick();unblock();await first;
  assert.equal(a.calls,2);assert.equal(s.recent('trades').length,1);s.close();
});
test('restart recovers a fill committed before its final cycle status, without replaying it', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-committed-')), file=path.join(dir,'paper.sqlite');
  let s=new Store(file);s.set('mode','running');await create(s).tick();
  const id=s.recent('trades')[0].id, wallet=s.get('wallet');
  s.db.prepare("UPDATE cycles SET status='processing' WHERE id=?").run(id);s.close();
  s=new Store(file);assert.deepEqual(s.get('wallet'),wallet);assert.equal(s.recent('decisions')[0].status,'EXECUTED');assert.match(s.recent('decisions')[0].reason,/Recovered/);
  const a=fixtureAgents(),c=create(s,fixtureMarket(),a);c.setMode('running');await c.tick();assert.equal(a.calls,0);assert.equal(s.recent('trades').length,1);
  s.close();fs.rmSync(dir,{recursive:true});
});
