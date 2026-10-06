import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { execute, markDaily } from '../src/risk.js';
import { SUPPORTED_SYMBOLS } from '../src/portfolio.js';
import { loadConfig } from '../src/config.js';
import { candles, config, NOW, context, newStore } from './helpers.js';
const prices = { 'BTC-USD':60000, 'ETH-USD':2500, 'SOL-USD':150, 'ZEC-USD':30, 'PUMP-USD':.005 };
const multiConfig = { ...config, symbols:[...SUPPORTED_SYMBOLS] };
function market() { return { candles:async(_i,_signal,symbol)=>candles().map(c=>Object.fromEntries(Object.entries(c).map(([k,v])=>[k,['open','high','low','close'].includes(k)?v*prices[symbol]/100:v]))), quote:async(_side,_signal,symbol)=>({price:prices[symbol],timestamp:NOW}) }; }
function agents(failSymbol=null) {
  let count=0;return {source:'offline-fixture',get calls(){return count;},ask:async(role,c)=>{count++;if(c.symbol===failSymbol)throw Error('offline failure');return {body:{decision:role==='Analyst'?'BUY':'ACCEPT',amountUsd:role==='Analyst'?500:0,evidence:['OFFLINE multi-coin fixture'],reason:'OFFLINE only'},metadata:{}};}};
}
test('five coins evaluate identical candle times independently, obey combined 20% cap, and do not replay',async()=>{
  const s=newStore(),a=agents(),c=new Controller(s,market(),a,multiConfig,()=>NOW);
  await c.tick();assert.equal(a.calls,10);assert.equal(s.recent('decisions').length,5);assert.equal(s.recent('trades').length,4);
  assert.equal(s.recent('decisions')[0].symbol,'PUMP-USD');assert.match(s.recent('decisions')[0].reason,/20% combined/);
  assert.ok(s.snapshot().exposure<=.2);assert.equal(s.snapshot().cash,8000);
  assert.equal(new Set(s.recent('messages').map(m=>m.symbol)).size,5);
  await c.tick();assert.equal(a.calls,10);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM cycles').get().n,5);s.close();
});
test('one failed coin feed or agent blocks entries for the portfolio, without invented chart data',async()=>{
  for(const kind of ['market','agent']){
    const s=newStore(),m=market();if(kind==='market'){const original=m.candles;m.candles=async(...args)=>{if(args[2]==='PUMP-USD')throw Error('Unavailable market');return original(...args);};}
    const c=new Controller(s,m,agents(kind==='agent'?'BTC-USD':null),multiConfig,()=>NOW);await c.tick();
    assert.equal(s.recent('trades').length,0);assert.equal(c.status().entriesPaused,true);
    if(kind==='market'){assert.equal(c.status().markets['PUMP-USD'].status,'unavailable market');assert.equal(c.status().markets['PUMP-USD'].candles,undefined);}
    else assert.deepEqual(c.status().agents.failedSymbols,['BTC-USD']);s.close();
  }
});
test('fresh aggregate prices required for buys; stale other coins never prevent a risk-reducing sale',()=>{
  const s=newStore();const first=execute(s,{id:'btc',symbol:'BTC-USD',decision:'BUY',amountUsd:500},{price:60000,timestamp:NOW},config,context,NOW);assert.equal(first.status,'EXECUTED');
  const stale={...context,marks:{'BTC-USD':{price:60000,timestamp:NOW-31000}}};
  const rejected=execute(s,{id:'eth',symbol:'ETH-USD',decision:'BUY',amountUsd:500},{price:2500,timestamp:NOW},config,stale,NOW);assert.match(rejected.reason,/all held coins/);
  const w=s.get('wallet');w.positions['ETH-USD']={qty:.1,costBasis:250};w.cash-=250;s.set('wallet',w);
  const sell=execute(s,{id:'sell-eth',symbol:'ETH-USD',decision:'SELL',amountUsd:1},{price:2500,timestamp:NOW},config,{...stale,mode:'stopped',exitAll:true,agentsHealthy:false},NOW);
  assert.equal(sell.status,'EXECUTED');assert.equal(s.get('wallet').positions['ETH-USD'].qty,0);assert.ok(s.get('wallet').positions['BTC-USD'].qty>0);s.close();
});
test('combined equity drawdown pauses all coins and unknown valuations do not reset the daily baseline',()=>{
  const s=newStore();const w=s.get('wallet');w.positions={'BTC-USD':{qty:.01,costBasis:600},'ZEC-USD':{qty:10,costBasis:300}};w.cash=9100;s.set('wallet',w);
  markDaily(s,{'BTC-USD':60000,'ZEC-USD':30},NOW);assert.equal(s.get('wallet').dailyStart,10000);
  markDaily(s,{'BTC-USD':30000,'ZEC-USD':30},NOW);assert.equal(s.get('wallet').drawdownPaused,true);
  markDaily(s,{'BTC-USD':30000},NOW+86400000);assert.equal(s.get('wallet').dailyStart,10000);assert.equal(s.get('wallet').drawdownPaused,true);
  assert.equal(s.snapshot({'BTC-USD':30000}).equity,null);s.close();
});
test('legacy BTC database upgrades without changing wallet, cost basis, history, daily pause or claims; backup retained',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-wallet-')),file=path.join(dir,'paper.sqlite');let db=new DatabaseSync(file);
  db.exec('CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE cycles(candle INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL);');
  const old={cash:9000,btc:.01,costBasis:1000,fees:1.5,realizedPnl:12,dailyDate:'2026-10-06',dailyStart:10000,drawdownPaused:true};
  const put=(key,value)=>db.prepare('INSERT INTO state VALUES (?,?)').run(key,JSON.stringify(value));put('wallet',old);put('markPrice',60000);put('markTimestamp',NOW);
  db.prepare('INSERT INTO cycles VALUES (?,?,?,?)').run(123,'old-cycle','HOLD',new Date(NOW).toISOString());db.close();
  let s=new Store(file);let w=s.get('wallet');assert.equal(w.cash,9000);assert.equal(w.positions['BTC-USD'].qty,.01);assert.equal(w.positions['BTC-USD'].costBasis,1000);assert.equal(w.drawdownPaused,true);assert.equal(s.snapshot().equity,9600);
  assert.equal(s.claim(123,'btc-replay',NOW,'BTC-USD'),false);assert.equal(s.claim(123,'eth-new',NOW,'ETH-USD'),true);s.finish(123,'HOLD','ETH-USD');s.close();
  s=new Store(file);assert.deepEqual(s.get('wallet'),w);s.close();
  db=new DatabaseSync(file+'.pre-multi-coin.bak');assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM state WHERE key='wallet'").get().value),old);db.close();fs.rmSync(dir,{recursive:true});
});
test('manual all-coin exits report partial failure and still sell other coins',async()=>{
  const s=newStore();const w=s.get('wallet');w.positions={'BTC-USD':{qty:.01,costBasis:600},'PUMP-USD':{qty:1000,costBasis:5}};w.cash=9395;s.set('wallet',w);s.set('mode','stopped');
  const m=market();const original=m.quote;m.quote=async(...args)=>{if(args[2]==='PUMP-USD')throw Error('Unavailable market');return original(...args);};
  const c=new Controller(s,m,agents(),multiConfig,()=>NOW);const result=await c.exitAll();assert.equal(result.status,'PARTIAL');assert.equal(s.get('wallet').positions['BTC-USD'].qty,0);assert.equal(s.get('wallet').positions['PUMP-USD'].qty,1000);assert.equal(result.results[1].status,'FAILED');s.close();
});
test('configuration permits selected coins and rejects ambiguous tickers and unsupported PUMP intervals',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coins-config-')),file=path.join(dir,'config.json');
  const write=c=>fs.writeFileSync(file,JSON.stringify(c));write(multiConfig);assert.deepEqual(loadConfig(file).symbols,SUPPORTED_SYMBOLS);
  write({...multiConfig,symbols:['PUMP']});assert.throws(()=>loadConfig(file),/supported symbols/);
  write({...multiConfig,intervalSeconds:21600,staleAfterSeconds:22000});assert.throws(()=>loadConfig(file),/PUMP data/);fs.rmSync(dir,{recursive:true});
});
test('held coins remain visible and valued after disabling their new analyses',async()=>{
  const s=newStore(),w=s.get('wallet');w.positions['ZEC-USD']={qty:5,costBasis:150};w.cash-=150;s.set('wallet',w);
  const c=new Controller(s,market(),agents(),{...config,symbols:['BTC-USD']},()=>NOW);await c.tick();const status=c.status();
  assert.deepEqual(status.symbols,['BTC-USD','ZEC-USD']);assert.equal(status.wallet.positions['ZEC-USD'].qty,5);assert.equal(status.markets['ZEC-USD'].provider,'Coinbase');assert.ok(status.wallet.marketValue>=150);s.close();
});
