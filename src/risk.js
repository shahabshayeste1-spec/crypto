import { LIMITS } from './config.js';
import { SUPPORTED_SYMBOLS, priceMap, valuePortfolio } from './portfolio.js';
export function markDaily(store, prices, now = Date.now()) {
  const w = store.get('wallet'), equity = valuePortfolio(w, prices).equity;
  if (equity === null) return w; // Never reset a daily baseline using a partially valued portfolio.
  const date = new Date(now).toISOString().slice(0, 10);
  if (w.dailyDate !== date) { w.dailyDate = date; w.dailyStart = equity; w.drawdownPaused = false; }
  if (equity <= w.dailyStart * (1 - LIMITS.dailyDrawdown)) w.drawdownPaused = true;
  store.set('wallet', w); return w;
}
export function execute(store, proposal, quote, config, context = {}, now = Date.now()) {
  return store.transaction(() => {
    const reject = reason => ({ status: 'REJECTED', reason });
    const symbol = proposal.symbol ?? 'BTC-USD';
    if (!SUPPORTED_SYMBOLS.includes(symbol)) return reject('Unsupported coin');
    if (typeof proposal.id !== 'string' || !proposal.id) return reject('Proposal ID required');
    if (store.hasTrade(proposal.id)) return reject('Duplicate proposal: already executed');
    if (!['BUY', 'SELL'].includes(proposal.decision) || !Number.isFinite(proposal.amountUsd) || proposal.amountUsd <= 0) return reject('Invalid trade');
    if (context.approved !== true || !Number.isFinite(context.approvedAt) || context.approvedAt > now) return reject('Approval required');
    if (!Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(quote.timestamp) || quote.timestamp > now || now - quote.timestamp > 30000 || quote.timestamp < context.approvedAt) return reject('Fresh execution quote after approval required');
    if (![config.feeBps, config.slippageBps].every(v => Number.isFinite(v) && v >= 0 && v <= 1000)) return reject('Invalid costs');
    const marks = { ...priceMap(context.marks ?? store.get('marks')), [symbol]: quote };
    let w = store.get('wallet');
    const portfolioFresh = Object.entries(w.positions).every(([s,p]) => !p.qty || (Number.isFinite(marks[s]?.price) && marks[s].price > 0 && Number.isFinite(marks[s].timestamp) && now - marks[s].timestamp <= 30000 && marks[s].timestamp <= now));
    if (portfolioFresh) w = markDaily(store, marks, now);
    const p = w.positions[symbol] ?? { qty: 0, costBasis: 0 }, buying = proposal.decision === 'BUY';
    if (buying && !portfolioFresh) return reject('Fresh prices for all held coins required');
    if (buying && (context.mode !== 'running' || !context.agentsHealthy || !context.dataFresh || w.drawdownPaused)) return reject('New entries paused: controls, freshness, agent failure, or daily drawdown');
    const fill = quote.price * (1 + (buying ? 1 : -1) * config.slippageBps / 10000);
    let qty, notional, fee;
    if (buying) {
      if (proposal.amountUsd > LIMITS.maxBuy) return reject('Buy exceeds $500 total cash limit');
      notional = proposal.amountUsd / (1 + config.feeBps / 10000); fee = proposal.amountUsd - notional; qty = notional / fill;
      if (proposal.amountUsd > w.cash + 1e-9) return reject('Insufficient virtual cash');
      const currentValue = valuePortfolio(w, marks).marketValue;
      const afterValue = currentValue + qty * quote.price, cashAfter = w.cash - proposal.amountUsd;
      if (afterValue > (cashAfter + afterValue) * LIMITS.maxExposure + 1e-9) return reject('Buy exceeds 20% combined crypto exposure');
      w.cash = cashAfter; p.qty += qty; p.costBasis += proposal.amountUsd;
    } else {
      qty = context.exitAll ? p.qty : proposal.amountUsd / quote.price;
      if (qty <= 0 || qty > p.qty + 1e-12) return reject('Cannot sell more coins than owned');
      qty = Math.min(qty, p.qty); notional = qty * fill; fee = notional * config.feeBps / 10000;
      const cost = p.costBasis * qty / p.qty;
      w.cash += notional - fee; w.realizedPnl += notional - fee - cost; p.costBasis -= cost; p.qty -= qty;
      if (p.qty < 1e-12) { p.qty = 0; p.costBasis = 0; }
    }
    w.positions[symbol] = p; w.fees += fee;
    const equityAfter = valuePortfolio(w, marks).equity;
    if (equityAfter !== null && w.dailyStart !== null && equityAfter <= w.dailyStart * (1 - LIMITS.dailyDrawdown)) w.drawdownPaused = true;
    const trade = { id: proposal.id, symbol, side: proposal.decision, qty, quotePrice: quote.price, fillPrice: fill, notional, fee, timestamp: new Date(now).toISOString(), quoteTimestamp: new Date(quote.timestamp).toISOString(), marketTimestamp: quote.marketTimestamp ? new Date(quote.marketTimestamp).toISOString() : null, approvedAt: new Date(context.approvedAt).toISOString(), source: context.source ?? 'paper' };
    store.set('wallet', w); store.set('marks', marks);
    store.db.prepare('INSERT INTO trades VALUES (?,?)').run(proposal.id, JSON.stringify(trade));
    return { status: 'EXECUTED', reason: 'Paper fill passed fixed portfolio risk checks', trade };
  });
}
