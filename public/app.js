const $ = id => document.getElementById(id);
const money = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token;
function empty(rows, text) { return rows.length ? rows.join('') : `<p>${text}</p>`; }
async function refresh() {
  try {
    const r = await fetch('/api/state'); if (!r.ok) throw Error(); const s = await r.json(); token = s.controlToken;
    const m = s.market;
    $('status').innerHTML = `<b>${escape(s.mode.toUpperCase())}</b> ${s.busy ? '· Cycle in progress' : ''}<p>Data: ${m ? escape(m.status) + ' · ' + (m.fresh ? 'fresh' : 'entries blocked') + ' · candle completed ' + escape(m.candle ? new Date(m.candle.time + s.config.intervalSeconds * 1000).toLocaleString() : 'unknown') : 'waiting for Start'}<br>Valuation timestamp: ${s.wallet.markTimestamp ? escape(new Date(s.wallet.markTimestamp).toLocaleString()) : 'not observed'} (last available quote)<br>Analyst: ${escape(s.agents.Analyst)} · Critic: ${escape(s.agents.Critic)} · AI: actual Codex calls<br>Daily drawdown pause: ${s.wallet.drawdownPaused ? 'YES — exits remain available' : 'no'} · Interval: ${s.config.intervalSeconds / 60} min · Fees: ${s.config.feeBps} bps · Slippage: ${s.config.slippageBps} bps</p>`;
    const w = s.wallet;
    $('wallet').innerHTML = [['Virtual equity',money(w.equity)],['Cash',money(w.cash)],['BTC position',w.btc.toFixed(8)],['BTC value',money(w.marketValue)],['Total P/L',money(w.pnl)],['Realized P/L',money(w.realizedPnl)],['Unrealized P/L',money(w.unrealizedPnl)],['Fees paid',money(w.fees)],['Daily start',money(w.dailyStart)]].map(([label,value])=>`<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('decisions').innerHTML = empty(s.decisions.map(d=>`<div class="event"><span class="decision">${escape(d.status)}</span> · ${escape(d.proposal?.decision ?? '')}<p class="reason">${escape(d.reason)}</p><small>${escape(d.id)} · ${escape(d.timestamp)}</small></div>`),'No decisions yet.');
    $('trades').innerHTML = empty(s.trades.map(t=>`<div class="event"><b>${escape(t.side)}</b> ${t.qty.toFixed(8)} BTC @ ${money(t.fillPrice)}<p>Fee ${money(t.fee)} · ${escape(t.source)}</p><small>${escape(t.timestamp)} · ${escape(t.id)}</small></div>`),'No paper fills yet.');
    $('messages').innerHTML = empty(s.messages.map(m=>`<article class="event"><div class="meta">${escape(m.sender)} → ${escape(m.recipient)} · ${escape(m.timestamp)} · ${escape(m.source)} · ${escape(m.proposalId)}</div><p class="reason"><span class="decision">${escape(m.decision)}</span> ${escape(m.reason)}</p><details><summary>Evidence</summary><div class="evidence">${m.evidence.map(escape).join('\n\n')}</div></details></article>`),'Bot messages appear after Start.');
  } catch { $('notice').textContent = 'Dashboard disconnected. Check the Terminal window.'; }
}
for (const button of document.querySelectorAll('[data-action]')) button.onclick = async () => {
  if (button.dataset.action === 'exit' && !confirm('Sell all virtual BTC using a fresh public quote? This is paper trading only.')) return;
  button.disabled = true;
  try {
    const r = await fetch(`/api/${button.dataset.action}`, { method: 'POST', headers: { 'X-Control-Token': token } });
    const data = await r.json(); $('notice').textContent = data.error ?? data.reason ?? `Control set to ${data.mode}.`;
    await refresh();
  } catch { $('notice').textContent = 'Control failed: local server unavailable.'; }
  finally { button.disabled = false; }
};
await refresh(); setInterval(refresh, 2000);
