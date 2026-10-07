import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { learningContext, observeDecisions } from '../src/learning.js';
import { execute } from '../src/risk.js';
import { config, NOW, newStore, fixtureMarket, fixtureAgents, context, quote } from './helpers.js';
const ind={sma5:101,sma20:100,lastReturn:-.001,rsi14:80};
test('active mode explores with one mild signal; conservative mode and losing feedback require more',()=>{
 const s=newStore();let feedback=learningContext(s,'BTC-USD',ind,config);assert.equal(feedback.entryCandidate,true);assert.equal(feedback.suggestedBuyUsd,100);assert.equal(feedback.closedTradeCount,0);
 assert.equal(learningContext(s,'BTC-USD',ind,{...config,strategyMode:'conservative'}).entryCandidate,false);
 for(let i=0;i<10;i++)s.db.prepare('INSERT INTO trades VALUES (?,?)').run(String(i),JSON.stringify({symbol:'BTC-USD',side:'SELL',positionClosed:true,positionRealizedPnl:-5}));
 feedback=learningContext(s,'BTC-USD',ind,config);assert.equal(feedback.entryScoreRequired,2);assert.equal(feedback.suggestedBuyUsd,50);assert.equal(feedback.entryCandidate,false);
 assert.equal(learningContext(s,'BTC-USD',ind,{...config,learningEnabled:false}).entryScoreRequired,1);s.close();
});
test('positive complete positions permit capped probes; partial sells and other coins are not training samples',()=>{
 const s=newStore();for(let i=0;i<10;i++)s.db.prepare('INSERT INTO trades VALUES (?,?)').run(String(i),JSON.stringify({symbol:'BTC-USD',side:'SELL',positionClosed:true,positionRealizedPnl:5}));
 assert.equal(learningContext(s,'BTC-USD',ind,{...config,probeBuyUsd:150}).suggestedBuyUsd,150);
 assert.equal(learningContext(s,'ETH-USD',ind,config).closedTradeCount,0);
 s.db.prepare('INSERT INTO trades VALUES (?,?)').run('partial',JSON.stringify({symbol:'BTC-USD',side:'SELL',positionClosed:false,realizedPnl:-10000}));
 assert.equal(learningContext(s,'BTC-USD',ind,config).closedTradeCount,10);s.close();
});
test('counterfactual outcomes wait for three truly subsequent completed candles, remain unique and survive restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feedback-')),file=path.join(dir,'paper.sqlite');let s=new Store(file);
 s.decision({id:'hold',symbol:'BTC-USD',timestamp:new Date(NOW).toISOString(),proposal:{decision:'HOLD'},observation:{price:100,signals:{shortTrendUp:true}}});
 const first=Math.ceil(NOW/300000)*300000;const rows=Array.from({length:4},(_,i)=>({time:first-300000+i*300000,close:100+i}));
 observeDecisions(s,'BTC-USD',rows,config,NOW+600000);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM outcomes').get().n,0);
 observeDecisions(s,'BTC-USD',rows,config,NOW+1200000);observeDecisions(s,'BTC-USD',rows,config,NOW+1200000);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM outcomes').get().n,1);
 let f=learningContext(s,'BTC-USD',ind,config);assert.equal(f.observations[0].laterClose,103);assert.match(f.observations[0].label,/NOT an executed/);assert.equal(f.closedTradeCount,0);
 s.close();s=new Store(file);assert.equal(learningContext(s,'BTC-USD',ind,config).observations.length,1);s.close();fs.rmSync(dir,{recursive:true});
});
test('both agents receive the same persistent feedback and decision observations are stored',async()=>{
 const s=newStore(),a=fixtureAgents(),original=a.ask,seen=[];a.ask=async(role,c,signal)=>{seen.push(c.feedback);return original(role,c,signal);};
 const c=new Controller(s,fixtureMarket(),a,config,()=>NOW);await c.tick();assert.equal(seen.length,2);assert.deepEqual(seen[0],seen[1]);assert.equal(s.recent('decisions')[0].observation.price,100);assert.equal(c.status().learning['BTC-USD'].mode,'active');s.close();
});
test('complete position results include earlier partial realization without double counting',()=>{
 const s=newStore();execute(s,{id:'buy',decision:'BUY',amountUsd:500},quote,config,context,NOW);
 const qty=s.get('wallet').positions['BTC-USD'].qty;
 const half=execute(s,{id:'half',decision:'SELL',amountUsd:qty*100/2},quote,config,context,NOW);assert.equal(half.trade.positionClosed,false);
 const rest=execute(s,{id:'rest',decision:'SELL',amountUsd:1},quote,config,{...context,exitAll:true},NOW);assert.equal(rest.trade.positionClosed,true);
 assert.ok(Math.abs(rest.trade.positionRealizedPnl-(half.trade.realizedPnl+rest.trade.realizedPnl))<1e-9);assert.equal(learningContext(s,'BTC-USD',ind,config).closedTradeCount,1);s.close();
});
test('missing original feedback horizons are not replaced by candles from a much later session',()=>{
 const s=newStore();s.decision({id:'old',symbol:'BTC-USD',timestamp:new Date(NOW).toISOString(),proposal:{decision:'HOLD'},observation:{price:100}});
 const rows=Array.from({length:10},(_,i)=>({time:Math.ceil(NOW/300000)*300000+86400000+i*300000,close:110}));
 observeDecisions(s,'BTC-USD',rows,config,NOW+90000000);assert.equal(s.recent('outcomes').length,0);s.close();
});
test('historical positions with unknown prior partial exits are not counted as complete learning samples',()=>{
 const s=newStore(),w=s.get('wallet');w.positions['BTC-USD']={qty:1,costBasis:100};w.cash=9900;s.set('wallet',w);
 const r=execute(s,{id:'legacy-exit',decision:'SELL',amountUsd:1},quote,config,{...context,exitAll:true},NOW);
 assert.equal(r.status,'EXECUTED');assert.equal(r.trade.positionClosed,true);assert.equal(r.trade.positionRealizedPnl,null);assert.equal(learningContext(s,'BTC-USD',ind,config).closedTradeCount,0);s.close();
});
