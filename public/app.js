const $ = id => document.getElementById(id);
const money = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n > 0 && n < 1 ? 6 : 2 }).format(n);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = symbol => symbol.replace('-USD','');
const names = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', ZEC: 'Zcash', PUMP: 'Pump.fun' };
let token, state, selected = 'BTC-USD', followTeam = true, agentFilter = null, refreshing = false;
const seen = new Set();
function empty(rows, text) { return rows.length ? rows.join('') : `<p class="empty">${text}</p>`; }
function stamp(time) { return time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'not observed'; }
function drawChart(s) {
  const m = s.markets[selected], rows = m?.candles ?? [], position = s.wallet.positions[selected];
  $('chart-title').textContent = `${short(selected)} / USD · ${names[short(selected)] ?? ''}`;
  $('chart-price').textContent = money(position?.price ?? (m?.candle?.close ?? null));
  $('chart-freshness').textContent = `${m?.provider ?? ''} · ${m?.fresh ? 'fresh' : m?.status ?? 'waiting'} · ${s.config.intervalSeconds / 60}m candles`;
  $('chart-empty').hidden = rows.length > 0;
  if (!rows.length) { $('candles').innerHTML = ''; $('chart-empty').textContent = m?.status === 'waiting' ? 'Press Start to load public candle data.' : `${short(selected)}: ${m?.status ?? 'waiting'}. No synthetic candles are substituted.`; $('indicators').innerHTML = ''; return; }
  const width = 900, height = 350, left = 12, right = 100, top = 20, bottom = 45;
  const min = Math.min(...rows.map(c => c.low)), max = Math.max(...rows.map(c => c.high));
  const pad = Math.max((max-min)*.12, max*.001), lo = min-pad, hi = max+pad;
  const y = p => top + (hi-p)/(hi-lo)*(height-top-bottom), dx = (width-left-right)/rows.length;
  let svg = '';
  for (let i=0;i<5;i++) { const price=lo+(hi-lo)*i/4, yy=y(price); svg += `<line class="chart-grid" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text class="chart-text" x="${width-right+10}" y="${yy+4}">${escape(money(price))}</text>`; }
  rows.forEach((c,i) => {
    const x=left+(i+.5)*dx, klass=c.close>=c.open?'up':'down', bodyTop=y(Math.max(c.open,c.close)), bodyHeight=Math.max(1,Math.abs(y(c.open)-y(c.close)));
    svg += `<g><line class="${klass}" x1="${x}" x2="${x}" y1="${y(c.high)}" y2="${y(c.low)}"/><rect class="${klass}" x="${x-dx*.29}" y="${bodyTop}" width="${Math.max(1,dx*.58)}" height="${bodyHeight}"/><rect class="candle-hit" data-candle="${i}" x="${left+i*dx}" y="${top}" width="${dx}" height="${height-top-bottom}"/></g>`;
    if(i%Math.max(1,Math.floor(rows.length/5))===0) svg+=`<text class="chart-text" x="${x}" y="${height-15}" text-anchor="middle">${escape(new Date(c.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</text>`;
  });
  const price = position?.price;
  if(Number.isFinite(price)&&price>=lo&&price<=hi) svg += `<line class="price-marker" x1="${left}" y1="${y(price)}" x2="${width-right}" y2="${y(price)}"/>`;
  $('candles').innerHTML=svg;
  const ind=m.indicators;const learning=s.learning?.[selected];
  $('indicators').innerHTML=ind ? `${learning ? `<span>Strategy <b>${escape(learning.mode)}</b></span><span>Entry signals <b>${learning.signalScore}/${learning.entryScoreRequired} required</b></span><span>Learning <b>${learning.closedTradeCount} closed trades · ${learning.observations.length} observations</b></span>` : ''}<span>RSI 14 <b>${ind.rsi14.toFixed(1)}</b></span><span>SMA 5 <b>${money(ind.sma5)}</b></span><span>SMA 20 <b>${money(ind.sma20)}</b></span><span>Last return <b>${(ind.lastReturn*100).toFixed(2)}%</b></span>` : '';
}
function renderRoom(s) {
  const a=s.activity ?? {phase:'idle',detail:'Waiting'}, phase=a.phase;
  $('room-mode').textContent=s.mode.toUpperCase();
  $('room').dataset.phase=phase;
  $('hub-symbol').textContent=short(a.symbol??selected);
  $('room-activity').textContent=`${a.symbol ? short(a.symbol)+' · ' : ''}${a.detail}`;
  const phases=['scan','analysis','critique','risk','execution'];
  $('workflow').innerHTML=phases.map((p,i)=>`<span class="${phase===p||(p==='analysis'&&phase==='revision')?'current':''}">${i+1}. ${['Scan','Analyze','Challenge','Risk','Fill'][i]}</span>`).join('');
  const active={Controller:['scan'].includes(phase),Analyst:['analysis','revision'].includes(phase),Critic:phase==='critique',Risk:['risk','execution'].includes(phase)};
  for(const node of document.querySelectorAll('[data-agent]')) {
    node.classList.toggle('active',!!active[node.dataset.agent]);node.classList.toggle('filtered',agentFilter===node.dataset.agent);
  }
  $('state-controller').textContent=phase==='scan'?'Fetching markets':s.busy?'Coordinating':'Waiting';
  $('state-analyst').textContent=active.Analyst?`${phase==='revision'?'Revising':'Analyzing'} ${short(a.symbol)}`:s.agents.Analyst;
  $('state-critic').textContent=active.Critic?`Challenging ${short(a.symbol)}`:s.agents.Critic;
  $('state-risk').textContent=active.Risk?(phase==='risk'?'Checking limits':'Paper execution'):'Fixed code · no AI override';
  const paths={ 'Controller-Analyst':'M400 96V219Q240 225 150 275', 'Analyst-Critic':'M150 275Q400 215 650 275', 'Critic-Controller':'M650 275Q560 220 400 219V96', 'Analyst-Controller':'M150 275Q240 225 400 219V96', 'Controller-Risk':'M400 96V448', 'Risk-User':'M400 448L680 502' };
  const newMessages=s.messages.filter(m=>!seen.has(m.id)&&Date.now()-Date.parse(m.timestamp)<15000&&Date.now()>=Date.parse(m.timestamp));
  if(newMessages.length) $('packets').innerHTML=newMessages.slice(0,6).map(m=>paths[`${m.sender}-${m.recipient}`]?`<circle class="packet" r="4"><animateMotion dur="1.8s" repeatCount="2" fill="remove" path="${paths[`${m.sender}-${m.recipient}`]}"/><animate attributeName="opacity" values="1;1;0" dur="3.6s" fill="freeze"/></circle>`:'').join('');
  s.messages.forEach(m=>seen.add(m.id));if(seen.size>1000)seen.clear();
  const stale=s.symbols.filter(symbol=>!s.markets[symbol]?.fresh);
  $('status').innerHTML=`<b>${s.entriesPaused?'Entries paused':'Entries enabled'}</b> · ${s.mode==='stopped'?'Monitoring stopped by you':s.mode==='paused'?'New buys paused by you':s.wallet.drawdownPaused?'2% daily loss pause':stale.length?'Data needs attention: '+escape(stale.map(short).join(', ')):s.agents.failedSymbols?.length?'Agent failure: '+escape(s.agents.failedSymbols.map(short).join(', ')):!s.agents.healthy?'Awaiting a completed independent review':'Portfolio limits enforced'}<br>AI: ${s.messages.some(m=>m.source==='offline-fixture')?'offline test fixtures':'actual Codex SDK calls'} · interval ${s.config.intervalSeconds/60}m · fees ${s.config.feeBps} bps · slippage ${s.config.slippageBps} bps`;
  $('paper-label').textContent=s.messages.some(m=>m.source==='offline-fixture')?'OFFLINE FIXTURE PREVIEW':'PAPER ONLY';
}
function render(s) {
  state=s;
  if(!s.symbols.includes(selected))selected=s.symbols[0];
  if(followTeam&&s.activity?.symbol&&s.symbols.includes(s.activity.symbol))selected=s.activity.symbol;
  const w=s.wallet;
  $('wallet').innerHTML=[['Virtual equity',money(w.equity),'One shared account'],['Virtual cash',money(w.cash),'Available to trade'],['Crypto value',money(w.marketValue),w.exposure===null?'Needs a quote':`${(w.exposure*100).toFixed(1)}% / 20% cap`],['Total P/L',money(w.pnl),'Includes simulated costs'],['Realized P/L',money(w.realizedPnl),`Unrealized ${money(w.unrealizedPnl)}`],['Fees paid',money(w.fees),`Daily start ${money(w.dailyStart)}`]].map(([label,value,note])=>`<div class="stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
  $('coin-tabs').innerHTML=s.symbols.map(symbol=>`<button data-symbol="${escape(symbol)}" class="coin-tab ${symbol===selected?'selected':''} ${s.markets[symbol]?.fresh?'':'stale'}"><strong>${escape(short(symbol))}</strong><span>${escape(s.markets[symbol]?.fresh?'● fresh':s.markets[symbol]?.status??'waiting')}</span></button>`).join('');
  $('positions').innerHTML=s.symbols.map(symbol=>{const p=w.positions[symbol]??{qty:0,marketValue:0,unrealizedPnl:0};return `<div class="position"><strong>${escape(short(symbol))} <small>${escape(names[short(symbol)])}</small></strong><div class="position-value">${money(p.marketValue)}</div><p>${p.qty.toLocaleString('en-US',{maximumFractionDigits:8})} ${escape(short(symbol))}</p><p class="${p.unrealizedPnl<0?'negative':'positive'}">P/L ${money(p.unrealizedPnl)}</p><p>Quote ${stamp(p.markTimestamp)}</p></div>`;}).join('');
  $('decisions').innerHTML=empty(s.decisions.map(d=>`<div class="event"><span class="decision ${escape(d.status.split(' ')[0])}">${escape(d.status)}</span> · <b>${escape(short(d.symbol??'BTC-USD'))}</b> · ${escape(d.proposal?.decision??'')}<p class="reason">${escape(d.reason)}</p><small>${escape(d.id)} · ${escape(stamp(d.timestamp))}</small></div>`),'No decisions yet. Start the team to evaluate completed candles.');
  $('trades').innerHTML=empty(s.trades.map(t=>`<div class="event"><b>${escape(t.side)} ${escape(short(t.symbol))}</b> · ${t.qty.toLocaleString('en-US',{maximumFractionDigits:8})} @ ${money(t.fillPrice)}<p class="reason">Fee ${money(t.fee)} · ${escape(t.source)}</p><small>${escape(stamp(t.timestamp))} · ${escape(t.id)}</small></div>`),'No paper fills yet. An accepted HOLD is a valid decision.');
  renderMessages(s);renderRoom(s);drawChart(s);
}
function renderMessages(s) {
  const messages=s.messages.filter(m=>!agentFilter||m.sender===agentFilter||m.recipient===agentFilter);
  $('message-filter').textContent=`${agentFilter??'All agents'} · all coins · newest first · final messages and evidence`;
  $('clear-filter').textContent=agentFilter?'Clear agent filter':'All agents';
  $('messages').innerHTML=empty(messages.map(m=>`<article class="message-bubble ${escape(m.sender)}"><div class="meta">${escape(m.sender)} → ${escape(m.recipient)} · ${escape(short(m.symbol??'BTC-USD'))} · ${escape(stamp(m.timestamp))} · ${escape(m.source)}</div><p class="reason"><span class="decision ${escape(m.decision.split(' ')[0])}">${escape(m.decision)}</span> ${escape(m.reason)}</p><details><summary>Evidence · proposal ${escape(m.proposalId)}</summary><div class="evidence">${m.evidence.map(escape).join('\n\n')}</div></details></article>`),'Bot messages appear after Start.');
}
async function refresh() {
  if(refreshing)return;refreshing=true;
  try {const r=await fetch('/api/state');if(!r.ok)throw Error();const s=await r.json();token=s.controlToken;render(s);}
  catch{$('notice').textContent='Dashboard disconnected or unable to render. Check the Terminal window.';}
  finally{refreshing=false;}
}
for(const button of document.querySelectorAll('[data-action]'))button.onclick=async()=>{
  if(button.dataset.action==='exit'&&!confirm('Sell all virtual positions using fresh quotes? This is paper trading only.'))return;
  button.disabled=true;
  try{const r=await fetch(`/api/${button.dataset.action}`,{method:'POST',headers:{'X-Control-Token':token}});const data=await r.json();$('notice').textContent=data.error??data.reason??`Control set to ${data.mode}.`;await refresh();}
  catch{$('notice').textContent='Control failed: local server unavailable.';}
  finally{button.disabled=false;}
};
$('coin-tabs').onclick=e=>{const button=e.target.closest('[data-symbol]');if(!button)return;selected=button.dataset.symbol;followTeam=false;$('follow-team').textContent='Follow team: off';if(state)render(state);};
$('follow-team').onclick=()=>{followTeam=!followTeam;$('follow-team').textContent=`Follow team: ${followTeam?'on':'off'}`;if(state)render(state);};
for(const node of document.querySelectorAll('[data-agent]'))node.onclick=()=>{agentFilter=node.dataset.agent;if(state)render(state);};
$('clear-filter').onclick=()=>{agentFilter=null;if(state)render(state);};
$('candles').onmousemove=e=>{const hit=e.target.closest('[data-candle]');if(!hit||!state)return;const c=state.markets[selected]?.candles?.[Number(hit.dataset.candle)];if(c)$('chart-tooltip').textContent=`${new Date(c.time).toLocaleString()} · O ${money(c.open)} · H ${money(c.high)} · L ${money(c.low)} · C ${money(c.close)} · Volume ${c.volume.toLocaleString()}`;};
void refresh();setInterval(refresh,2000);
