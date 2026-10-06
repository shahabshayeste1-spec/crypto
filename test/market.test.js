import test from 'node:test';
import assert from 'node:assert/strict';
import { Market, indicators } from '../src/market.js';
import { candles } from './helpers.js';
test('provider uses only completed candles, orders history, rejects gaps and malformed quotes', async t => {
  const now=Date.now(), interval=300, base=Math.floor(now/300000)*300;
  const rows=Array.from({length:30},(_,i)=>[base-(29-i)*interval,90,110,100,101,10]);
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify([...rows].reverse()),{status:200}));
  const market=new Market(), result=await market.candles(interval);
  assert.equal(result.length,29);assert.ok(result.every(c=>c.time+interval*1000<=Date.now()));assert.equal(result.at(-1).time,(base-interval)*1000);
  globalThis.fetch=async()=>new Response(JSON.stringify(rows.filter((_,i)=>i!==10)),{status:200});await assert.rejects(market.candles(interval),/gaps/);
  globalThis.fetch=async()=>new Response(JSON.stringify({ask:'bad',bid:'100',time:new Date().toISOString()}),{status:200});await assert.rejects(market.quote('BUY'),/invalid/);
  globalThis.fetch=async()=>new Response(JSON.stringify({ask:'101',bid:'99',time:new Date(Date.now()-60000).toISOString()}),{status:200});await assert.rejects(market.quote('SELL'),/Stale/);
  globalThis.fetch=async()=>new Response(JSON.stringify({ask:'101',bid:'99',time:new Date().toISOString()}),{status:200});assert.equal((await market.quote('BUY')).price,101);assert.equal((await market.quote('SELL')).price,99);
});
test('indicators reflect supplied completed history', () => {
  const facts=indicators(candles());assert.equal(facts.rsi14,100);assert.ok(facts.sma5>facts.sma20);assert.ok(facts.lastReturn>0);
});
