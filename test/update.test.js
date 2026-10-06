import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SUPPORTED_SYMBOLS } from '../src/portfolio.js';
test('Mac updater preserves original wallet and settings, adds coins, backs up files, and supports paths with spaces',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'old paper team '));
  fs.mkdirSync(path.join(dir,'data'));fs.mkdirSync(path.join(dir,'public'));
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'crypto-paper-team',version:'1.0.0'}));
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({feeBps:12,slippageBps:7,intervalSeconds:300}));
  fs.writeFileSync(path.join(dir,'data/paper.sqlite'),'original wallet retained');fs.writeFileSync(path.join(dir,'public/app.js'),'previous app');
  try{
    const r=spawnSync('bash',['update.command',dir],{env:{...process.env,PAPER_UPDATE_NO_LAUNCH:'1'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);
    assert.equal(fs.readFileSync(path.join(dir,'data/paper.sqlite'),'utf8'),'original wallet retained');
    const c=JSON.parse(fs.readFileSync(path.join(dir,'config.json')));assert.equal(c.feeBps,12);assert.equal(c.slippageBps,7);assert.deepEqual(c.symbols,SUPPORTED_SYMBOLS);
    const backup=path.join(dir,'backups',fs.readdirSync(path.join(dir,'backups'))[0]);assert.equal(fs.readFileSync(path.join(backup,'public/app.js'),'utf8'),'previous app');
    assert.equal(fs.readFileSync(path.join(backup,'data/paper.sqlite'),'utf8'),'original wallet retained');assert.match(fs.readFileSync(path.join(dir,'public/app.js'),'utf8'),/renderRoom/);
    fs.writeFileSync(path.join(dir,'data/server.lock'),String(process.pid));const blocked=spawnSync('bash',['update.command',dir],{env:{...process.env,PAPER_UPDATE_NO_LAUNCH:'1'},encoding:'utf8'});assert.equal(blocked.status,1);assert.match(blocked.stdout,/still running/);
  }finally{fs.rmSync(dir,{recursive:true});}
});
