import { SUPPORTED_SYMBOLS } from './portfolio.js';
export function providerFor(symbol) { return symbol === 'PUMP-USD' ? 'Kraken' : 'Coinbase'; }
async function get(url, signal) {
  const r = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]), headers: { Accept: 'application/json', 'User-Agent': 'CryptoPaperTeam/2.0', 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw Error(`Market data HTTP ${r.status}`);
  const data = await r.json();
  if (data.error?.length) throw Error('Unavailable market or provider error');
  return { data, serverTime: Date.parse(r.headers.get('date')) };
}
function validSymbol(symbol) { if (!SUPPORTED_SYMBOLS.includes(symbol)) throw Error('Unsupported coin'); }
function validateCandles(candles, interval) {
  const now = Date.now();
  candles = candles.filter(c => c.time + interval * 1000 <= now).sort((a, b) => a.time - b.time);
  if (candles.length < 20 || candles.some(c => !Object.values(c).every(Number.isFinite) || c.close <= 0 || c.open <= 0 || c.low <= 0 || c.high < c.low || c.volume < 0)) throw Error('Invalid or insufficient completed candles');
  for (let i = 1; i < candles.length; i++) if (candles[i].time - candles[i - 1].time !== interval * 1000) throw Error('Candle history has gaps or duplicates');
  return candles.slice(-60);
}
export class Market {
  async candles(interval, signal, symbol = 'BTC-USD') {
    validSymbol(symbol);
    let candles;
    if (providerFor(symbol) === 'Kraken') {
      if (![60,300,900,3600,86400].includes(interval)) throw Error('Unsupported PUMP candle interval');
      const { data } = await get(`https://api.kraken.com/0/public/OHLC?pair=PUMPUSD&interval=${interval / 60}`, signal);
      const key = Object.keys(data.result ?? {}).find(k => k !== 'last');
      if (!key || !Array.isArray(data.result[key])) throw Error('Unavailable market');
      candles = data.result[key].map(r => ({ time: Number(r[0]) * 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[6]) }));
    } else {
      const { data: rows } = await get(`https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${interval}`, signal);
      if (!Array.isArray(rows)) throw Error('Unavailable market');
      candles = rows.map(r => ({ time: r[0] * 1000, low: r[1], high: r[2], open: r[3], close: r[4], volume: r[5] }));
    }
    return validateCandles(candles, interval);
  }
  async quote(side = 'BUY', signal, symbol = 'BTC-USD') {
    validSymbol(symbol);
    let price, marketTime;
    if (providerFor(symbol) === 'Kraken') {
      const { data, serverTime } = await get('https://api.kraken.com/0/public/Ticker?pair=PUMPUSD', signal);
      const q = Object.values(data.result ?? {})[0];
      if (!q) throw Error('Unavailable market');
      price = Number((side === 'SELL' ? q.b : q.a)?.[0]); marketTime = serverTime;
    } else {
      const { data: q } = await get(`https://api.exchange.coinbase.com/products/${symbol}/ticker`, signal);
      price = Number(side === 'SELL' ? q.bid : q.ask); marketTime = Date.parse(q.time);
    }
    const observed = Date.now();
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(marketTime) || Math.abs(observed - marketTime) > 30000) throw Error('Stale or invalid market quote');
    return { price, timestamp: observed, marketTimestamp: marketTime, provider: providerFor(symbol) };
  }
}
export function indicators(candles) {
  const closes = candles.map(c => c.close);
  const sma = n => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
  const changes = closes.slice(-15).map((v, i, a) => i ? v - a[i - 1] : 0).slice(1);
  const gains = changes.reduce((s, v) => s + Math.max(0, v), 0) / 14;
  const losses = changes.reduce((s, v) => s + Math.max(0, -v), 0) / 14;
  return { sma5: sma(5), sma20: sma(20), rsi14: losses === 0 ? (gains === 0 ? 50 : 100) : 100 - 100 / (1 + gains / losses), lastReturn: closes.at(-1) / closes.at(-2) - 1 };
}
