import { randomUUID } from 'node:crypto';
import { message, validateResponse } from './messages.js';
import { indicators } from './market.js';
import { LIMITS } from './config.js';
import { execute, markDaily } from './risk.js';
export class Controller {
  constructor(store, market, agents, config, clock = Date.now) {
    Object.assign(this, { store, market, agents, config, clock }); this.busy = false; this.abort = null;
    store.set('agents', { Analyst: 'not called', Critic: 'not called', healthy: false });
  }
  setMode(mode) {
    if (!['running', 'paused', 'stopped'].includes(mode)) throw Error('Invalid control');
    this.store.set('mode', mode);
    if (mode === 'stopped') this.abort?.abort();
  }
  log(id, sender, recipient, body, source = 'code') {
    const m = message(id, sender, recipient, body, source, this.clock()); this.store.addMessage(m); return m;
  }
  finish(id, candle, status, reason, proposal = null) {
    this.store.decision({ id, candle, timestamp: new Date(this.clock()).toISOString(), status, reason, proposal });
    this.store.finish(candle, status);
  }
  fresh(candle) {
    const age = this.clock() - (candle.time + this.config.intervalSeconds * 1000);
    return age >= 0 && age <= this.config.staleAfterSeconds * 1000;
  }
  async call(role, context, id, signal) {
    const status = this.store.get('agents'); status[role] = 'working'; this.store.set('agents', status);
    const result = await this.agents.ask(role, context, signal);
    validateResponse(result.body, role);
    if (signal.aborted) throw Error('Cycle cancelled');
    const done = this.store.get('agents'); done[role] = 'ok'; this.store.set('agents', done);
    this.log(id, role, role === 'Analyst' && !context.revision ? 'Critic' : 'Controller', result.body, this.agents.source);
    this.store.set(`last${role}Call`, { proposalId: id, ...result.metadata, timestamp: new Date(this.clock()).toISOString() });
    return result.body;
  }
  async tick() {
    if (this.busy || this.store.get('mode') === 'stopped') return;
    this.busy = true; this.abort = new AbortController();
    let id, candle, proposal;
    try {
      const candles = await this.market.candles(this.config.intervalSeconds, this.abort.signal); candle = candles.at(-1);
      const fresh = this.fresh(candle);
      this.store.set('market', { candle, fetchedAt: this.clock(), fresh, status: fresh ? 'ok' : 'stale' });
      if (!fresh) return; // Do not consume this candle until reliable data is available.
      const mark = await this.market.quote('SELL', this.abort.signal);
      markDaily(this.store, mark.price, this.clock()); this.store.set('markPrice', mark.price); this.store.set('markTimestamp', mark.timestamp);
      id = randomUUID();
      if (!this.store.claim(candle.time, id, this.clock())) return;
      const context = { symbol: LIMITS.symbol, candleCompletedAt: new Date(candle.time + this.config.intervalSeconds * 1000).toISOString(), candles, indicators: indicators(candles), currentQuote: mark, wallet: this.store.snapshot(mark.price), recentTrades: this.store.recent('trades', 10), recentDecisions: this.store.recent('decisions', 5), limits: LIMITS, costs: { feeBps: this.config.feeBps, slippageBps: this.config.slippageBps }, mode: this.store.get('mode') };
      this.log(id, 'Controller', 'Analyst', { decision: 'HOLD', evidence: [JSON.stringify(context)], reason: 'Evaluate this newly completed candle exactly once.' });
      proposal = await this.call('Analyst', context, id, this.abort.signal);
      const critique = await this.call('Critic', { ...context, proposal }, id, this.abort.signal);
      const health = this.store.get('agents'); health.healthy = true; this.store.set('agents', health);
      if (critique.decision === 'REQUEST REVISION') {
        this.log(id, 'Controller', 'Analyst', { decision: 'REQUEST REVISION', evidence: critique.evidence, reason: critique.reason });
        const revision = await this.call('Analyst', { ...context, proposal, critique, revision: true }, id, this.abort.signal);
        this.log(id, 'Controller', 'User', { decision: 'REJECT', evidence: revision.evidence, reason: 'Revision recorded. Revised trades need independent acceptance on a later candle; no second critique or execution this cycle.' });
        return this.finish(id, candle.time, 'REVISION DEFERRED', 'One revision recorded; no accepted trade.', revision);
      }
      if (critique.decision !== 'ACCEPT') {
        this.log(id, 'Controller', 'User', { decision: 'REJECT', evidence: critique.evidence, reason: critique.reason });
        return this.finish(id, candle.time, 'REJECTED', critique.reason, proposal);
      }
      if (proposal.decision === 'HOLD') {
        this.log(id, 'Controller', 'User', { decision: 'HOLD', evidence: critique.evidence, reason: 'Accepted HOLD; no trade.' });
        return this.finish(id, candle.time, 'HOLD', proposal.reason, proposal);
      }
      const approvedAt = this.clock();
      this.log(id, 'Controller', 'Risk', { decision: 'APPROVED', evidence: critique.evidence, reason: 'Critic accepted. Fixed risk code must still approve execution.', amountUsd: proposal.amountUsd });
      const quote = await this.market.quote(proposal.decision, this.abort.signal);
      if (this.abort.signal.aborted) throw Error('Cycle cancelled');
      const result = execute(this.store, { ...proposal, id }, quote, this.config, { approved: true, approvedAt, mode: this.store.get('mode'), agentsHealthy: true, dataFresh: this.fresh(candle), source: this.agents.source === 'offline-fixture' ? 'offline-fixture' : 'paper' }, this.clock());
      this.store.set('markPrice', quote.price); this.store.set('markTimestamp', quote.timestamp);
      this.log(id, 'Risk', 'User', { decision: result.status === 'EXECUTED' ? 'EXECUTED' : 'REJECT', evidence: result.trade ? [JSON.stringify(result.trade)] : ['Fixed limits cannot be overridden by agents.'], reason: result.reason, amountUsd: proposal.amountUsd });
      this.finish(id, candle.time, result.status, result.reason, proposal);
    } catch {
      // Do not persist raw SDK/network errors: they may include authentication details.
      const health = this.store.get('agents');
      if (health.Analyst === 'working') health.Analyst = 'failed';
      if (health.Critic === 'working') health.Critic = 'failed';
      health.healthy = false; this.store.set('agents', health);
      if (!id) this.store.set('market', { ...(this.store.get('market') ?? {}), fresh: false, status: 'fetch failed' });
      if (id && candle) {
        const stopped = this.store.get('mode') === 'stopped';
        const reason = stopped ? 'Stopped by user; cycle cancelled.' : 'Agent or quote failed/timed out. No trade; new entries blocked until a successful cycle. Check Codex login and market connectivity.';
        this.log(id, 'Controller', 'User', { decision: stopped ? 'CANCELLED' : 'FAILED', evidence: ['No fallback AI output and no retrospective fill.'], reason });
        this.finish(id, candle.time, stopped ? 'CANCELLED' : 'FAILED', reason, proposal);
      }
    } finally { this.busy = false; this.abort = null; }
  }
  async exitAll() {
    if (this.busy) throw Error('Wait for the current cycle to finish, or Stop to cancel it.');
    this.busy = true;
    const id = randomUUID(); const approvedAt = this.clock();
    try {
      this.log(id, 'Controller', 'Risk', { decision: 'APPROVED', evidence: ['User requested risk-reducing exit only.'], reason: 'Manual paper exit works even when entries are paused or agents unavailable.' });
      const quote = await this.market.quote('SELL');
      const result = execute(this.store, { id, decision: 'SELL', amountUsd: Math.max(0.01, this.store.get('wallet').btc * quote.price) }, quote, this.config, { approved: true, approvedAt, exitAll: true, source: 'manual-paper-exit' }, this.clock());
      this.store.set('markPrice', quote.price); this.store.set('markTimestamp', quote.timestamp);
      this.log(id, 'Risk', 'User', { decision: result.status === 'EXECUTED' ? 'EXECUTED' : 'REJECT', evidence: [result.trade ? JSON.stringify(result.trade) : 'No shorting permitted.'], reason: result.reason });
      this.store.decision({ id, timestamp: new Date(this.clock()).toISOString(), status: result.status, reason: result.reason, proposal: { decision: 'SELL', manual: true } });
      return result;
    } catch {
      this.log(id, 'Risk', 'User', { decision: 'FAILED', evidence: ['Fresh public quote is required even for an exit.'], reason: 'Exit unavailable: market quote failed. No fill.' });
      throw Error('Exit unavailable: fresh market quote failed.');
    } finally { this.busy = false; }
  }
  status() {
    const m = this.store.get('market');
    return { mode: this.store.get('mode'), busy: this.busy, market: m ? { ...m, fresh: m.status === 'ok' && this.fresh(m.candle) } : null, agents: this.store.get('agents'), wallet: { ...this.store.snapshot(this.store.get('markPrice')), markTimestamp: this.store.get('markTimestamp') }, messages: this.store.recent('messages'), decisions: this.store.recent('decisions'), trades: this.store.recent('trades'), config: this.config, limits: LIMITS };
  }
}
