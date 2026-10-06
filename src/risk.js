import { LIMITS } from './config.js';
export function markDaily(store, price, now = Date.now()) {
  const w = store.get('wallet'); const date = new Date(now).toISOString().slice(0, 10);
  const equity = w.cash + w.btc * price;
  if (w.dailyDate !== date) { w.dailyDate = date; w.dailyStart = equity; w.drawdownPaused = false; }
  if (equity <= w.dailyStart * (1 - LIMITS.dailyDrawdown)) w.drawdownPaused = true;
  store.set('wallet', w); return w;
}
export function execute(store, proposal, quote, config, context = {}, now = Date.now()) {
  return store.transaction(() => {
    const reject = reason => ({ status: 'REJECTED', reason });
    if (typeof proposal.id !== 'string' || !proposal.id) return reject('Proposal ID required');
    if (store.hasTrade(proposal.id)) return reject('Duplicate proposal: already executed');
    if (!['BUY', 'SELL'].includes(proposal.decision) || !Number.isFinite(proposal.amountUsd) || proposal.amountUsd <= 0) return reject('Invalid trade');
    if (context.approved !== true || !Number.isFinite(context.approvedAt) || context.approvedAt > now) return reject('Approval required');
    if (!Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(quote.timestamp) || quote.timestamp > now || now - quote.timestamp > 30000 || quote.timestamp < context.approvedAt) return reject('Fresh execution quote after approval required');
    if (![config.feeBps, config.slippageBps].every(v => Number.isFinite(v) && v >= 0 && v <= 1000)) return reject('Invalid costs');
    const w = markDaily(store, quote.price, now);
    const buying = proposal.decision === 'BUY';
    if (buying && (context.mode !== 'running' || !context.agentsHealthy || !context.dataFresh || w.drawdownPaused)) return reject('New entries paused: controls, freshness, agent failure, or daily drawdown');
    const fill = quote.price * (1 + (buying ? 1 : -1) * config.slippageBps / 10000);
    let qty, notional, fee;
    if (buying) {
      // amountUsd is the total cash budget, INCLUDING fees.
      if (proposal.amountUsd > LIMITS.maxBuy) return reject('Buy exceeds $500 total cash limit');
      notional = proposal.amountUsd / (1 + config.feeBps / 10000); fee = proposal.amountUsd - notional; qty = notional / fill;
      if (proposal.amountUsd > w.cash + 1e-9) return reject('Insufficient virtual cash');
      const cashAfter = w.cash - proposal.amountUsd, btcAfter = w.btc + qty;
      const equityAfter = cashAfter + btcAfter * quote.price;
      if (btcAfter * quote.price > equityAfter * LIMITS.maxExposure + 1e-9) return reject('Buy exceeds 20% crypto exposure');
      w.cash = cashAfter; w.btc = btcAfter; w.costBasis += proposal.amountUsd;
    } else {
      // SELL amount specifies gross quote value; no borrowing or short selling.
      qty = context.exitAll ? w.btc : proposal.amountUsd / quote.price;
      if (qty <= 0 || qty > w.btc + 1e-12) return reject('Cannot sell more BTC than owned');
      qty = Math.min(qty, w.btc); notional = qty * fill; fee = notional * config.feeBps / 10000;
      const cost = w.costBasis * qty / w.btc;
      w.cash += notional - fee; w.realizedPnl += notional - fee - cost; w.costBasis -= cost; w.btc -= qty;
      if (w.btc < 1e-12) { w.btc = 0; w.costBasis = 0; }
    }
    w.fees += fee;
    const equityAfter = w.cash + w.btc * quote.price;
    if (equityAfter <= w.dailyStart * (1 - LIMITS.dailyDrawdown)) w.drawdownPaused = true;
    const trade = { id: proposal.id, symbol: LIMITS.symbol, side: proposal.decision, qty, quotePrice: quote.price, fillPrice: fill, notional, fee, timestamp: new Date(now).toISOString(), quoteTimestamp: new Date(quote.timestamp).toISOString(), marketTimestamp: quote.marketTimestamp ? new Date(quote.marketTimestamp).toISOString() : null, approvedAt: new Date(context.approvedAt).toISOString(), source: context.source ?? 'paper' };
    store.set('wallet', w);
    store.db.prepare('INSERT INTO trades VALUES (?,?)').run(proposal.id, JSON.stringify(trade));
    return { status: 'EXECUTED', reason: 'Paper fill passed fixed risk checks', trade };
  });
}
