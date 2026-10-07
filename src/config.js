import fs from 'node:fs';
import { SUPPORTED_SYMBOLS } from './portfolio.js';
export const LIMITS = Object.freeze({ initialCash: 10000, maxBuy: 500, maxExposure: 0.20, dailyDrawdown: 0.02 });
export function loadConfig(file = 'config.json') {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  c.strategyMode ??= 'active';
  c.learningEnabled ??= true;
  c.probeBuyUsd ??= 100;
  if (!['active','conservative'].includes(c.strategyMode) || typeof c.learningEnabled !== 'boolean' || !Number.isFinite(c.probeBuyUsd) || c.probeBuyUsd < 25 || c.probeBuyUsd > 150) throw Error('Invalid strategy settings: mode active/conservative, learning boolean, probe budget $25–$150');
  c.symbols ??= [...SUPPORTED_SYMBOLS];
  if (!Array.isArray(c.symbols) || !c.symbols.length || new Set(c.symbols).size !== c.symbols.length || c.symbols.some(s => !SUPPORTED_SYMBOLS.includes(s))) throw Error('Choose unique supported symbols: ' + SUPPORTED_SYMBOLS.join(', '));
  if (c.symbols.includes('PUMP-USD') && c.intervalSeconds === 21600) throw Error('PUMP data supports 1m, 5m, 15m, 1h or 1d intervals; choose a supported interval.');
  if (process.env.PAPER_PORT) c.port = Number(process.env.PAPER_PORT);
  if (![60, 300, 900, 3600, 21600, 86400].includes(c.intervalSeconds)) throw Error('Unsupported Coinbase candle interval');
  for (const [key, min, max] of [['pollSeconds', 5, 3600], ['staleAfterSeconds', 30, 172800], ['feeBps', 0, 1000], ['slippageBps', 0, 1000], ['agentTimeoutSeconds', 5, 600], ['port', 1024, 65535]]) {
    if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max) throw Error(`Invalid setting: ${key}`);
  }
  if (c.staleAfterSeconds < c.intervalSeconds) throw Error('staleAfterSeconds must be at least intervalSeconds');
  if (c.model !== null && typeof c.model !== 'string') throw Error('Invalid model');
  return Object.freeze(c);
}
