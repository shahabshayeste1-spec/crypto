import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
async function freePort() { const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
function boot(env) {
  const child = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = new Promise((resolve,reject)=> {
    const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);
    child.stdout.on('data', b=>{if(b.toString().includes('Paper trading dashboard:')){clearTimeout(timer);resolve();}});
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited: ${code}`));});
  });
  return {child,ready};
}
async function stop(child) { const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited; }
test('real HTTP dashboard, protected controls, static assets and persistent wallet restart', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-http-')); const port=await freePort();
  const env={PAPER_PORT:String(port),PAPER_DATA_DIR:dir}; let {child,ready}=boot(env);
  const base=`http://127.0.0.1:${port}`;
  try {
    await ready;
    assert.match(await (await fetch(base)).text(), /PAPER TRADING ONLY/);
    for (const asset of ['/app.js','/style.css']) assert.equal((await fetch(base+asset)).status,200);
    let state=await (await fetch(base+'/api/state')).json(); assert.equal(state.wallet.cash,10000);assert.equal(state.mode,'stopped');
    assert.equal((await fetch(base+'/api/start',{method:'POST'})).status,403);
    const headers={'X-Control-Token':state.controlToken,Origin:base};
    assert.equal((await fetch(base+'/api/stop',{method:'POST',headers})).status,200);
    assert.equal((await fetch(base+'/api/unknown',{method:'POST',headers})).status,404);
    assert.equal((await fetch(base+'/api/stop',{method:'POST',headers:{...headers,Origin:'http://evil.example'}})).status,403);
    assert.deepEqual(await (await fetch(base+'/api/history')).json(),{messages:[],decisions:[],trades:[]});
    const duplicate=spawn(process.execPath,['src/server.js'],{env:{...process.env,...env,PAPER_PORT:String(await freePort())},stdio:'ignore'});
    const code=await new Promise(r=>duplicate.once('exit',r));assert.equal(code,1);
    await stop(child);
    ({child,ready}=boot(env));await ready;state=await (await fetch(base+'/api/state')).json();assert.equal(state.wallet.cash,10000);assert.equal(state.mode,'stopped');
  } finally { if(child.exitCode===null) await stop(child);fs.rmSync(dir,{recursive:true,force:true}); }
});
