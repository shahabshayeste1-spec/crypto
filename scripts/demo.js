import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { config, NOW, candles, fixtureMarket, fixtureAgents } from '../test/helpers.js';
const store = new Store(':memory:'); store.set('mode', 'running');
let now = NOW;
const market = fixtureMarket(); market.candles = async () => candles(now); market.quote = async () => ({ price: 100, timestamp: now });
const agents = fixtureAgents([
  { decision: 'BUY', amountUsd: 500, evidence: ['OFFLINE fixture: rising prices'], reason: 'OFFLINE fixture proposes paper buy' },
  { decision: 'ACCEPT', amountUsd: 0, evidence: ['OFFLINE fixture: affordable budget'], reason: 'OFFLINE fixture acceptance' },
  { decision: 'BUY', amountUsd: 501, evidence: ['OFFLINE fixture: deliberately excessive budget'], reason: 'OFFLINE fixture tests immutable cap' },
  { decision: 'ACCEPT', amountUsd: 0, evidence: ['OFFLINE fixture: critic deliberately accepts'], reason: 'OFFLINE fixture tests code overriding AI approval' }
]);
const controller = new Controller(store, market, agents, config, () => now);
await controller.tick(); now += config.intervalSeconds * 1000; await controller.tick();
const result = { label: 'OFFLINE DEMONSTRATION — deterministic fixtures, NOT actual AI responses or live market data. Separate in-memory wallet.', decisions: store.recent('decisions').reverse(), trades: store.recent('trades'), wallet: store.snapshot(100), messages: store.recent('messages').reverse() };
console.log(JSON.stringify(result, null, 2));
if (result.trades.length !== 1 || result.decisions[1].status !== 'REJECTED') process.exitCode = 1;
store.close();
