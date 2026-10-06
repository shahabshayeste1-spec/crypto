import { randomUUID } from 'node:crypto';
import { message, validateResponse } from './messages.js';
import { indicators, providerFor } from './market.js';
import { LIMITS } from './config.js';
import { execute, markDaily } from './risk.js';
export class Controller {
  constructor(store, market, agents, config, clock = Date.now) {
    Object.assign(this, { store, market, agents, config, clock }); this.busy = false; this.abort = null;
    this.symbols = config.symbols ?? ['BTC-USD'];
    store.set('agents', { Analyst: 'not called', Critic: 'not called', healthy: false, failedSymbols: (store.get('agents')?.failedSymbols ?? []).filter(s => this.symbols.includes(s)), bySymbol: {} });
    this.activity('idle', null, 'Stopped — ready when you are');
  }
  activity(phase, symbol, detail) { this.store.set('activity', { phase, symbol, detail, timestamp: this.clock() }); }
  setMode(mode) {
    if (!['running', 'paused', 'stopped'].includes(mode)) throw Error('Invalid control');
    this.store.set('mode', mode);
    if (mode === 'stopped') { this.abort?.abort(); this.activity('idle', null, 'Stopped by you'); }
  }
  log(id, sender, recipient, body, source = 'code', symbol = 'BTC-USD') {
    const m = message(id, sender, recipient, { ...body, symbol }, source, this.clock()); this.store.addMessage(m); return m;
  }
  finish(id, candle, status, reason, proposal = null, symbol = 'BTC-USD') {
    this.store.transaction(() => {
      this.store.decision({ id, symbol, candle, timestamp: new Date(this.clock()).toISOString(), status, reason, proposal });
      this.store.finish(candle, status, symbol);
    });
  }
  fresh(candle) {
    if (!candle) return false;
    const age = this.clock() - (candle.time + this.config.intervalSeconds * 1000);
    return age >= 0 && age <= this.config.staleAfterSeconds * 1000;
  }
  watchSymbols() { return [...new Set([...this.symbols, ...Object.entries(this.store.get('wallet').positions).filter(([,p]) => p.qty > 0).map(([s]) => s)])]; }
  dataFresh() { const markets = this.store.get('markets') ?? {}; return this.watchSymbols().every(s => markets[s]?.status === 'ok' && this.fresh(markets[s].candle)); }
  async call(role, context, id, signal) {
    const symbol = context.symbol, status = this.store.get('agents'); status[role] = 'working';
    status.bySymbol[symbol] ??= {}; status.bySymbol[symbol][role] = 'working'; this.store.set('agents', status);
    this.activity(role === 'Critic' ? 'critique' : context.revision ? 'revision' : 'analysis', symbol, role === 'Critic' ? 'Challenging the proposal' : context.revision ? 'Revising once' : 'Reading candles and portfolio');
    const result = await this.agents.ask(role, context, signal);
    validateResponse(result.body, role);
    if (signal.aborted) throw Error('Cycle cancelled');
    const done = this.store.get('agents'); done[role] = 'ok'; done.bySymbol[symbol][role] = 'ok'; this.store.set('agents', done);
    this.log(id, role, role === 'Analyst' && !context.revision ? 'Critic' : 'Controller', result.body, this.agents.source, symbol);
    this.store.set(`last${role}Call`, { proposalId: id, symbol, ...result.metadata, timestamp: new Date(this.clock()).toISOString() });
    return result.body;
  }
  async refreshHeldMarks(symbol, quote, signal) {
    const marks = { ...(this.store.get('marks') ?? {}), [symbol]: quote };
    const others = Object.entries(this.store.get('wallet').positions).filter(([s,p]) => p.qty > 0 && s !== symbol);
    await Promise.all(others.map(async ([s]) => { marks[s] = await this.market.quote('SELL', signal, s); }));
    this.store.set('marks', marks); return marks;
  }
  async tick() {
    if (this.busy || this.store.get('mode') === 'stopped') return;
    this.busy = true; this.abort = new AbortController();
    try {
      this.activity('scan', null, `Fetching ${this.symbols.length} markets`);
      const markets = { ...(this.store.get('markets') ?? {}) }, marks = { ...(this.store.get('marks') ?? {}) };
      const held = Object.entries(this.store.get('wallet').positions).filter(([,p]) => p.qty > 0).map(([s]) => s);
      const watch = this.watchSymbols();
      await Promise.all(watch.map(async symbol => {
        try {
          const candles = await this.market.candles(this.config.intervalSeconds, this.abort.signal, symbol), candle = candles.at(-1);
          const quote = await this.market.quote('SELL', this.abort.signal, symbol);
          marks[symbol] = quote;
          markets[symbol] = { symbol, provider: providerFor(symbol), candles, candle, indicators: indicators(candles), fetchedAt: this.clock(), status: this.fresh(candle) ? 'ok' : 'stale' };
        } catch (error) {
          markets[symbol] = { ...(markets[symbol] ?? {}), symbol, provider: providerFor(symbol), fetchedAt: this.clock(), status: /Unavailable market/.test(String(error.message)) ? 'unavailable market' : 'fetch failed' };
        }
      }));
      this.store.set('markets', markets); this.store.set('marks', marks);
      if (held.every(s => marks[s]?.timestamp <= this.clock() && this.clock() - marks[s]?.timestamp <= 30000)) markDaily(this.store, marks, this.clock());
      const startIndex = (this.store.get('nextSymbolIndex') ?? 0) % this.symbols.length;
      for (let offset = 0; offset < this.symbols.length; offset++) {
        const index = (startIndex + offset) % this.symbols.length, symbol = this.symbols[index];
        if (this.abort.signal.aborted || this.store.get('mode') === 'stopped') break;
        const m = markets[symbol]; if (m.status !== 'ok' || !this.fresh(m.candle)) continue;
        await this.cycle(symbol, m, marks[symbol], this.abort.signal);
        this.store.set('nextSymbolIndex', (index + 1) % this.symbols.length);
      }
    } finally {
      this.busy = false; this.abort = null;
      this.activity('idle', null, this.store.get('mode') === 'stopped' ? 'Stopped' : this.dataFresh() ? 'Waiting for the next completed candles' : 'Data needs attention — new entries blocked');
    }
  }
  async cycle(symbol, market, mark, signal) {
    const candle = market.candle, id = randomUUID();
    if (!this.store.claim(candle.time, id, this.clock(), symbol)) return;
    let proposal;
    try {
      const context = { symbol, candleCompletedAt: new Date(candle.time + this.config.intervalSeconds * 1000).toISOString(), candles: market.candles, indicators: market.indicators, currentQuote: mark, wallet: this.store.snapshot(), recentTrades: this.store.recent('trades', 10), recentDecisions: this.store.recent('decisions', 5), limits: LIMITS, costs: { feeBps: this.config.feeBps, slippageBps: this.config.slippageBps }, mode: this.store.get('mode') };
      this.log(id, 'Controller', 'Analyst', { decision: 'HOLD', evidence: [JSON.stringify(context)], reason: `Evaluate ${symbol} for this completed candle exactly once.` }, 'code', symbol);
      proposal = await this.call('Analyst', context, id, signal);
      const critique = await this.call('Critic', { ...context, proposal }, id, signal);
      const health = this.store.get('agents'); health.failedSymbols = health.failedSymbols.filter(s => s !== symbol); health.healthy = health.failedSymbols.length === 0; this.store.set('agents', health);
      if (critique.decision === 'REQUEST REVISION') {
        this.log(id, 'Controller', 'Analyst', { decision: 'REQUEST REVISION', evidence: critique.evidence, reason: critique.reason }, 'code', symbol);
        const revision = await this.call('Analyst', { ...context, proposal, critique, revision: true }, id, signal);
        this.log(id, 'Controller', 'User', { decision: 'REJECT', evidence: revision.evidence, reason: 'Revision saved. A revised trade needs independent acceptance on a later candle.' }, 'code', symbol);
        return this.finish(id, candle.time, 'REVISION DEFERRED', 'One revision recorded; no accepted trade.', revision, symbol);
      }
      if (critique.decision !== 'ACCEPT') {
        this.log(id, 'Controller', 'User', { decision: 'REJECT', evidence: critique.evidence, reason: critique.reason }, 'code', symbol);
        return this.finish(id, candle.time, 'REJECTED', critique.reason, proposal, symbol);
      }
      if (proposal.decision === 'HOLD') {
        this.log(id, 'Controller', 'User', { decision: 'HOLD', evidence: critique.evidence, reason: 'Accepted HOLD; no trade.' }, 'code', symbol);
        return this.finish(id, candle.time, 'HOLD', proposal.reason, proposal, symbol);
      }
      const approvedAt = this.clock(); this.activity('risk', symbol, 'Checking fixed portfolio limits');
      this.log(id, 'Controller', 'Risk', { decision: 'APPROVED', evidence: critique.evidence, reason: 'Critic accepted. Fixed risk code still decides execution.', amountUsd: proposal.amountUsd }, 'code', symbol);
      const quote = await this.market.quote(proposal.decision, signal, symbol);
      let marks = { ...(this.store.get('marks') ?? {}), [symbol]: quote };
      if (proposal.decision === 'BUY') marks = await this.refreshHeldMarks(symbol, quote, signal);
      if (signal.aborted) throw Error('Cycle cancelled');
      const result = execute(this.store, { ...proposal, id, symbol }, quote, this.config, { approved: true, approvedAt, marks, mode: this.store.get('mode'), agentsHealthy: this.store.get('agents').healthy, dataFresh: this.dataFresh(), source: this.agents.source === 'offline-fixture' ? 'offline-fixture' : 'paper' }, this.clock());
      this.activity(result.status === 'EXECUTED' ? 'execution' : 'rejected', symbol, result.reason);
      this.log(id, 'Risk', 'User', { decision: result.status === 'EXECUTED' ? 'EXECUTED' : 'REJECT', evidence: result.trade ? [JSON.stringify(result.trade)] : ['Combined portfolio limits cannot be overridden.'], reason: result.reason, amountUsd: proposal.amountUsd }, 'code', symbol);
      this.finish(id, candle.time, result.status, result.reason, proposal, symbol);
    } catch {
      const health = this.store.get('agents'), stopped = signal.aborted;
      for (const role of ['Analyst','Critic']) if (health[role] === 'working') { health[role] = 'failed'; health.bySymbol[symbol][role] = 'failed'; }
      if (!stopped && !health.failedSymbols.includes(symbol)) health.failedSymbols.push(symbol);
      health.healthy = false; this.store.set('agents', health);
      const reason = stopped ? 'Stopped by user; cycle cancelled.' : 'Agent or execution quote failed/timed out. No trade; entries blocked until this coin completes a successful cycle.';
      this.log(id, 'Controller', 'User', { decision: stopped ? 'CANCELLED' : 'FAILED', evidence: ['No fallback AI output and no retrospective fill.'], reason }, 'code', symbol);
      this.finish(id, candle.time, stopped ? 'CANCELLED' : 'FAILED', reason, proposal, symbol);
    }
  }
  async exitAll() {
    if (this.busy) throw Error('Wait for this cycle to finish, or Stop to cancel it.');
    this.busy = true; const results = [];
    try {
      const held = Object.entries(this.store.get('wallet').positions).filter(([,p]) => p.qty > 0);
      if (!held.length) return { status: 'REJECTED', reason: 'No virtual positions to exit.' };
      for (const [symbol,p] of held) {
        const id = randomUUID(), approvedAt = this.clock(); this.activity('execution', symbol, 'Manual paper exit');
        this.log(id, 'Controller', 'Risk', { decision: 'APPROVED', evidence: ['User requested a risk-reducing exit.'], reason: 'Manual exits remain available when agents or other markets fail.' }, 'code', symbol);
        try {
          const quote = await this.market.quote('SELL', undefined, symbol);
          const result = execute(this.store, { id, symbol, decision: 'SELL', amountUsd: Math.max(.01, p.qty * quote.price) }, quote, this.config, { approved: true, approvedAt, exitAll: true, source: 'manual-paper-exit' }, this.clock());
          this.log(id, 'Risk', 'User', { decision: result.status === 'EXECUTED' ? 'EXECUTED' : 'REJECT', evidence: [result.trade ? JSON.stringify(result.trade) : 'No shorting.'], reason: result.reason }, 'code', symbol);
          this.store.decision({ id, symbol, timestamp: new Date(this.clock()).toISOString(), status: result.status, reason: result.reason, proposal: { decision: 'SELL', manual: true } });
          results.push({ symbol, ...result });
        } catch {
          const reason = 'Exit unavailable: fresh market quote failed. No fill.';
          this.log(id, 'Risk', 'User', { decision: 'FAILED', evidence: ['Fresh quote required for this coin.'], reason }, 'code', symbol);
          this.store.decision({ id, symbol, timestamp: new Date(this.clock()).toISOString(), status: 'FAILED', reason });
          results.push({ symbol, status: 'FAILED', reason });
        }
      }
      return { status: results.every(r => r.status === 'EXECUTED') ? 'EXECUTED' : 'PARTIAL', reason: results.map(r => `${r.symbol}: ${r.status}`).join(' · '), results };
    } finally { this.busy = false; this.activity('idle', null, 'Manual exits complete'); }
  }
  status() {
    const raw = this.store.get('markets') ?? {}, markets = {};
    const wallet = this.store.snapshot(), symbols = this.watchSymbols();
    for (const symbol of symbols) if (!wallet.positions[symbol]) {
      const mark = this.store.get('marks')?.[symbol];
      wallet.positions[symbol] = { qty: 0, costBasis: 0, marketValue: 0, unrealizedPnl: 0, price: mark?.price ?? null, markTimestamp: mark?.timestamp ?? null };
    }
    for (const symbol of symbols) markets[symbol] = { ...(raw[symbol] ?? { symbol, status: 'waiting', provider: providerFor(symbol), candles: [] }), fresh: raw[symbol]?.status === 'ok' && this.fresh(raw[symbol]?.candle) };
    return { mode: this.store.get('mode'), busy: this.busy, activity: this.store.get('activity'), markets, agents: this.store.get('agents'), wallet, messages: this.store.recent('messages'), decisions: this.store.recent('decisions'), trades: this.store.recent('trades'), config: this.config, symbols, enabledSymbols: this.symbols, limits: LIMITS, entriesPaused: this.store.get('mode') !== 'running' || !this.dataFresh() || !this.store.get('agents').healthy || this.store.get('wallet').drawdownPaused };
  }
}
