// Real browser UI verification. Trading dependencies are explicitly offline fixtures.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { loadConfig } from '../src/config.js';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'paper-browser-'));
const listen=net.createServer();await new Promise(r=>listen.listen(0,'127.0.0.1',r));const port=listen.address().port;await new Promise(r=>listen.close(r));
const server=spawn(process.execPath,['src/server.js'],{env:{...process.env,PAPER_PORT:String(port),PAPER_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
const ready=new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(b.toString().includes('Paper trading dashboard:'))resolve();});server.once('exit',code=>reject(Error(`Server exited ${code}`)));});
let browser,store;
const errors=[];
try {
  await ready;
  browser=await chromium.launch({executablePath:process.env.PAPER_BROWSER_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|Refused to/i.test(m.text()))errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${port}`);await page.waitForFunction(()=>document.querySelector('#wallet').textContent.includes('$10,000.00'));
  assert.equal(await page.locator('.coin-tab').count(),5);assert.equal(await page.locator('.agent').count(),4);
  assert.match(await page.locator('#room-mode').textContent(),/STOPPED/);
  console.log('PASS: real server cold boot renders wallet, five coin tabs and four agents.');
  const config=loadConfig(),prices={'BTC-USD':62000,'ETH-USD':2450,'SOL-USD':149,'ZEC-USD':35,'PUMP-USD':.0052};
  const started=Date.now(),latest=Math.floor(started/300000)*300000-300000;
  const market={candles:async(_interval,_signal,symbol)=>Array.from({length:60},(_,i)=>{
    const p=prices[symbol],open=p*(1+Math.sin(i*.7)*.007+i*.00005),close=open*(1+Math.cos(i*.6)*.003);
    return {time:latest-(59-i)*300000,open,close,high:Math.max(open,close)*1.0015,low:Math.min(open,close)*.9985,volume:15+i};
  }),quote:async(_side,_signal,symbol)=>({price:prices[symbol],timestamp:Date.now()})};
  let releaseCritic;const gate=new Promise(r=>{releaseCritic=r;});let firstCritic=true;
  const agents={source:'offline-fixture',ask:async(role,c)=>{
    if(role==='Critic'&&firstCritic){firstCritic=false;await gate;}
    const hold=c.symbol==='ETH-USD'||c.symbol==='SOL-USD';
    return {body:{decision:role==='Critic'?'ACCEPT':hold?'HOLD':'BUY',amountUsd:role==='Critic'||hold?0:c.symbol==='PUMP-USD'?501:500,evidence:['OFFLINE browser fixture: synthetic candles and deterministic responses.'],reason:role==='Critic'?'OFFLINE fixture: independently accepts for UI verification.':hold?'OFFLINE fixture: no convincing edge.':'OFFLINE fixture: test proposal; risk code still enforces limits.'},metadata:{}};
  }};
  store=new Store(':memory:');const controller=new Controller(store,market,agents,config);let cycle;
  await page.route('**/api/state',route=>route.fulfill({json:{...controller.status(),controlToken:'offline-test-token'}}));
  await page.route('**/api/start',async route=>{
    assert.equal(route.request().headers()['x-control-token'],'offline-test-token');controller.setMode('running');cycle=controller.tick();await route.fulfill({json:{mode:'running'}});
  });
  for(const [action,mode] of [['pause','paused'],['stop','stopped']])await page.route(`**/api/${action}`,async route=>{controller.setMode(mode);await route.fulfill({json:{mode}});});
  await page.reload();await page.getByRole('button',{name:'Start / resume'}).click();await page.waitForSelector('.critic.active');
  assert.equal(await page.locator('#paper-label').textContent(),'OFFLINE FIXTURE PREVIEW');
  assert.equal(await page.locator('.candle-hit').count(),60);assert.equal(await page.locator('#chart-empty').isVisible(),false);
  await page.screenshot({path:'docs/dashboard-preview.png',fullPage:true});
  releaseCritic();await cycle;await page.waitForFunction(()=>document.querySelector('#decisions').textContent.includes('20%')||document.querySelector('#decisions').textContent.includes('$500'));
  await page.locator('[data-symbol="PUMP-USD"]').click();assert.match(await page.locator('#chart-title').textContent(),/PUMP/);assert.match(await page.locator('#follow-team').textContent(),/off/);
  await page.locator('[data-candle="25"]').hover();assert.match(await page.locator('#chart-tooltip').textContent(),/O \$/);
  await page.locator('[data-agent="Critic"]').click();assert.match(await page.locator('#message-filter').textContent(),/Critic/);await page.locator('#clear-filter').click();
  await page.getByRole('button',{name:'Pause entries'}).click();await page.waitForFunction(()=>document.querySelector('#room-mode').textContent==='PAUSED');assert.match(await page.locator('#room-mode').textContent(),/PAUSED/);
  await page.getByRole('button',{name:'Stop',exact:false}).click();await page.waitForFunction(()=>document.querySelector('#room-mode').textContent==='STOPPED');assert.match(await page.locator('#room-mode').textContent(),/STOPPED/);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'/tmp/paper-mobile-preview.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: Start, active Critic animation, real SVG candles, coin switch, candle hover, agent filter, Pause, Stop, mobile layout; no browser errors.');
  console.log('Preview screenshot is explicitly labeled OFFLINE FIXTURE PREVIEW; no real AI or market data is claimed.');
} finally {
  await browser?.close();store?.close();
  if(server.exitCode===null){const ended=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await ended;}
  fs.rmSync(data,{recursive:true,force:true});
}
