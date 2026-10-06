import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Controller } from '../src/controller.js';
import { newStore, fixtureMarket, fixtureAgents, config, NOW } from './helpers.js';
const settle = () => new Promise(resolve => setImmediate(resolve));
test('dashboard loads as a classic browser script, renders wallet, and sends authenticated Start/Pause/Stop controls', async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(html, /\sstyle=/);
  assert.match(html, /<script src="\/app\.js"><\/script>/);
  // Parse as the classic script actually used in the HTML, rather than Node ESM.
  const script = new vm.Script(fs.readFileSync('public/app.js', 'utf8'), { filename: 'app.js' });
  const store = newStore(), controller = new Controller(store, fixtureMarket(), fixtureAgents(), config, () => NOW);
  controller.setMode('stopped');
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], { innerHTML: '', textContent: '', hidden: false, dataset: {} }]));
  const agents=['Controller','Analyst','Critic','Risk'].map(agent=>({dataset:{agent},classList:{toggle(){}}}));
  const controls = ['start', 'pause', 'stop', 'exit'].map(action => ({ dataset: { action }, disabled: false }));
  const requests = []; let polling;
  const context = vm.createContext({
    document: { getElementById: id => nodes[id], querySelectorAll: selector => selector === '[data-action]' ? controls : agents },
    confirm: () => true,
    setInterval: callback => { polling = callback; },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === '/api/state') return { ok: true, json: async () => ({ ...controller.status(), controlToken: 'test-token' }) };
      assert.equal(options.method, 'POST'); assert.equal(options.headers['X-Control-Token'], 'test-token');
      const action = url.slice(5); controller.setMode({ start: 'running', pause: 'paused', stop: 'stopped' }[action]);
      if (action === 'start') await controller.tick();
      return { ok: true, json: async () => ({ mode: store.get('mode') }) };
    }
  });
  script.runInContext(context); await settle();
  assert.match(nodes['room-mode'].textContent, /STOPPED/); assert.match(nodes.wallet.innerHTML, /\$10,000\.00/);
  assert.match(nodes.messages.innerHTML, /Bot messages appear/); assert.equal(typeof polling, 'function');
  await controls[0].onclick();
  assert.match(nodes['room-mode'].textContent, /RUNNING/); assert.match(nodes.decisions.innerHTML, /EXECUTED/); assert.match(nodes.messages.innerHTML, /Analyst/); assert.match(nodes.trades.innerHTML, /BUY/);
  assert.match(nodes.notice.textContent, /running/);
  assert.match(nodes.candles.innerHTML, /candle-hit/);
  agents[1].onclick();assert.match(nodes['message-filter'].textContent,/Analyst/);nodes['clear-filter'].onclick();assert.match(nodes['message-filter'].textContent,/All agents/);
  nodes['coin-tabs'].onclick({target:{closest:()=>({dataset:{symbol:'BTC-USD'}})}});assert.equal(nodes['follow-team'].textContent,'Follow team: off');
  nodes.candles.onmousemove({target:{closest:()=>({dataset:{candle:'0'}})}});assert.match(nodes['chart-tooltip'].textContent,/O \$/); assert.equal(controls[0].disabled, false);
  await controls[1].onclick(); assert.match(nodes['room-mode'].textContent, /PAUSED/);
  await controls[2].onclick(); assert.match(nodes['room-mode'].textContent, /STOPPED/);
  assert.deepEqual(requests.filter(r => r.options.method === 'POST').map(r => r.url), ['/api/start', '/api/pause', '/api/stop']);
  store.close();
});
