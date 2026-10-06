const BASE = 'https://api.exchange.coinbase.com';
async function get(url, signal) {
  const r = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]), headers: { 'Accept': 'application/json', 'User-Agent': 'CryptoPaperTeam/1.0' } });
  if (!r.ok) throw Error(`Market data HTTP ${r.status}`);
  return r.json();
}
export class Market {
  async candles(interval, signal) {
    const rows = await get(`${BASE}/products/BTC-USD/candles?granularity=${interval}`, signal);
    const now = Date.now();
    if (!Array.isArray(rows)) throw Error('Invalid candle response');
    const candles = rows.map(r => ({ time: r[0] * 1000, low: r[1], high: r[2], open: r[3], close: r[4], volume: r[5] }))
      .filter(c => c.time + interval * 1000 <= now).sort((a, b) => a.time - b.time);
    if (candles.length < 20 || candles.some(c => !Object.values(c).every(Number.isFinite) || c.close <= 0 || c.open <= 0 || c.low <= 0 || c.high < c.low || c.volume < 0)) throw Error('Invalid or insufficient completed candles');
    for (let i = 1; i < candles.length; i++) if (candles[i].time - candles[i - 1].time !== interval * 1000) throw Error('Candle history has gaps or duplicates');
    return candles.slice(-60);
  }
  async quote(side = 'BUY', signal) {
    const q = await get(`${BASE}/products/BTC-USD/ticker`, signal);
    const price = Number(side === 'SELL' ? q.bid : q.ask);
    const marketTime = Date.parse(q.time); const observed = Date.now();
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(marketTime) || Math.abs(observed - marketTime) > 30000) throw Error('Stale or invalid market quote');
    return { price, timestamp: observed, marketTimestamp: marketTime };
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
