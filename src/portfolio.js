export const SUPPORTED_SYMBOLS = Object.freeze(['BTC-USD', 'ETH-USD', 'SOL-USD', 'ZEC-USD', 'PUMP-USD']);
export function priceMap(value) { return typeof value === 'number' ? { 'BTC-USD': { price: value } } : (value ?? {}); }
export function valuePortfolio(wallet, input) {
  const marks = priceMap(input); let marketValue = 0, complete = true, costBasis = 0;
  const positions = {};
  for (const [symbol, p] of Object.entries(wallet.positions)) {
    const raw = marks[symbol], price = typeof raw === 'number' ? raw : raw?.price;
    const valid = Number.isFinite(price) && price > 0;
    const value = p.qty === 0 ? 0 : valid ? p.qty * price : null;
    if (value === null) complete = false; else marketValue += value;
    costBasis += p.costBasis;
    positions[symbol] = { ...p, price: valid ? price : null, marketValue: value, unrealizedPnl: value === null ? null : value - p.costBasis, markTimestamp: raw?.timestamp ?? null };
  }
  return { positions, marketValue: complete ? marketValue : null, equity: complete ? wallet.cash + marketValue : null, costBasis };
}
