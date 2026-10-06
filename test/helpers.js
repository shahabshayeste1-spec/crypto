import { Store } from '../src/store.js';
export const config = { symbols: ['BTC-USD'], intervalSeconds: 300, pollSeconds: 30, staleAfterSeconds: 420, feeBps: 10, slippageBps: 5, agentTimeoutSeconds: 10, model: null, port: 8787 };
export const NOW = Date.parse('2026-10-06T12:05:05Z');
export function candles(now = NOW) {
  const latestOpen = Math.floor(now / 300000) * 300000 - 300000;
  return Array.from({ length: 30 }, (_, i) => ({ time: latestOpen - (29 - i) * 300000, low: 99, high: 102, open: 100, close: 100 + i / 30, volume: 10 }));
}
export function fixtureMarket(now = NOW) { return { candles: async () => candles(now), quote: async () => ({ price: 100, timestamp: now }) }; }
export function fixtureAgents(responses = [{ decision: 'BUY', amountUsd: 500, evidence: ['OFFLINE FIXTURE: test market'], reason: 'OFFLINE fixture purchase' }, { decision: 'ACCEPT', amountUsd: 0, evidence: ['OFFLINE FIXTURE: critique'], reason: 'OFFLINE fixture acceptance' }]) {
  let count = 0;
  return { source: 'offline-fixture', get calls() { return count; }, ask: async () => { const body = responses[count++]; if (body instanceof Error) throw body; return { body, metadata: {} }; } };
}
export function newStore() { const s = new Store(':memory:'); s.set('mode', 'running'); return s; }
export const context = { approved: true, approvedAt: NOW, mode: 'running', agentsHealthy: true, dataFresh: true };
export const quote = { price: 100, timestamp: NOW };
