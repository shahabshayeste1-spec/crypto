// Outcome memory changes advisory strategy settings, never account risk limits.
export function strategyConfig(config) {
  return { mode: config.strategyMode ?? 'active', learningEnabled: config.learningEnabled ?? true, probeBuyUsd: config.probeBuyUsd ?? 100, horizonCandles: 3 };
}
export function observeDecisions(store, symbol, candles, config, now) {
  const strategy = strategyConfig(config);
  if (!strategy.learningEnabled) return;
  const decisions = store.recent('decisions', 1000).filter(d => d.symbol === symbol && d.observation && ['BUY','HOLD','SELL'].includes(d.proposal?.decision));
  store.transaction(() => {
    for (const d of decisions) {
      if (!Number.isFinite(d.observation.price) || d.observation.price <= 0 || !Number.isFinite(Date.parse(d.timestamp))) continue;
      if (store.db.prepare('SELECT id FROM outcomes WHERE id=?').get(d.id)) continue;
      // Only candles that OPENED after this decision can supply subsequent outcomes.
      const intervalMs = (d.observation.intervalSeconds ?? config.intervalSeconds) * 1000;
      const firstOpen = Math.ceil(Date.parse(d.timestamp) / intervalMs) * intervalMs;
      const future = Array.from({length: strategy.horizonCandles}, (_, i) => candles.find(c => c.time === firstOpen + i * intervalMs && c.time + intervalMs <= now));
      if (future.some(c => !c)) continue; // Missing horizons are not replaced by later convenient candles.
      const end = future.at(-1);
      const gross = end.close / d.observation.price - 1;
      const estimatedNet = gross - 2 * ((d.observation.feeBps ?? config.feeBps) + (d.observation.slippageBps ?? config.slippageBps)) / 10000;
      const outcome = { id: d.id, symbol, decision: d.proposal.decision, decisionAt: d.timestamp, evaluatedAt: new Date(now).toISOString(), horizonEndedAt: new Date(end.time + intervalMs).toISOString(), referencePrice: d.observation.price, laterClose: end.close, estimatedNetReturn: estimatedNet, label: 'Counterfactual price observation, NOT an executed fill or realized profit', signals: d.observation.signals };
      store.db.prepare('INSERT INTO outcomes VALUES (?,?)').run(d.id, JSON.stringify(outcome));
    }
  });
}
export function learningContext(store, symbol, indicators, config) {
  const settings = strategyConfig(config);
  const signals = { shortTrendUp: indicators.sma5 > indicators.sma20, candleMomentumUp: indicators.lastReturn > 0, rsiConstructive: indicators.rsi14 >= 40 && indicators.rsi14 <= 70 };
  const score = Object.values(signals).filter(Boolean).length;
  // Adapt only from actual closed paper trades with explicit fee-inclusive realized P/L.
  const closed = store.recent('trades', 1000).filter(t => t.symbol === symbol && t.side === 'SELL' && t.positionClosed === true && Number.isFinite(t.positionRealizedPnl)).slice(0, 20);
  const wins = closed.filter(t => t.positionRealizedPnl > 0).length;
  const netRealized = closed.reduce((sum,t) => sum + t.positionRealizedPnl, 0);
  const enough = settings.learningEnabled && closed.length >= 10;
  const losing = enough && netRealized < 0;
  const successful = enough && netRealized > 0 && wins / closed.length >= .6;
  const entryScoreRequired = settings.mode === 'conservative' ? 3 : losing ? 2 : 1;
  const suggestedBuyUsd = Math.min(settings.probeBuyUsd, losing ? 50 : successful ? 150 : 100);
  const observations = store.db.prepare("SELECT body FROM outcomes WHERE json_extract(body,'$.symbol')=? ORDER BY rowid DESC LIMIT 20").all(symbol).map(r=>JSON.parse(r.body));
  const recentDecisions = store.recent('decisions', 200).filter(d=>d.symbol===symbol).slice(0, 10);
  return { ...settings, signals, signalScore: score, entryScoreRequired, entryCandidate: score >= entryScoreRequired, suggestedBuyUsd, closedTradeCount: closed.length, wins, netRealizedPnl: netRealized, adaptation: losing ? 'Recent closed trades lost money: require more signals and smaller probes.' : successful ? 'Recent closed trades were positive: permit probes up to the configured cap.' : 'Exploration phase: modest paper probes on a mild signal; insufficient closed trades to infer an edge.', observations, recentDecisions, caution: 'Counterfactual observations are not fills or proof of profitability. Repeated nearby outcomes are correlated. No model weights are trained; persistent feedback guides the next model call.' };
}
