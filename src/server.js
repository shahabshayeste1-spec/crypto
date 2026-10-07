import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { acquireLock } from './lock.js';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Market } from './market.js';
import { Agents } from './agents.js';
import { Controller } from './controller.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const config = loadConfig();
const dataDirectory = process.env.PAPER_DATA_DIR ? path.resolve(process.env.PAPER_DATA_DIR) : path.join(root, 'data');
let releaseLock;
try { releaseLock = acquireLock(dataDirectory); } catch (e) { console.error(e.message); process.exit(1); }
const store = new Store(path.join(dataDirectory, 'paper.sqlite'));
const controller = new Controller(store, new Market(), new Agents(config, dataDirectory), config);
const token = randomBytes(24).toString('hex');
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  // Loopback binding + exact Host check prevent DNS rebinding. All writes require same-origin token.
  if (![`127.0.0.1:${config.port}`, `localhost:${config.port}`].includes(req.headers.host)) return json(403, { error: 'Local dashboard only' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/api/state') return json(200, { ...controller.status(), controlToken: token });
  if (req.method === 'GET' && url.pathname === '/api/history') return json(200, { outcomes: store.recent('outcomes', 1000000).reverse(), messages: store.recent('messages', 1000000).reverse(), decisions: store.recent('decisions', 1000000).reverse(), trades: store.recent('trades', 1000000).reverse() });
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    if (req.headers['x-control-token'] !== token || req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Invalid dashboard origin or control token' });
    try {
      const action = url.pathname.slice(5);
      if (action === 'exit') return json(200, await controller.exitAll());
      const mode = { start: 'running', pause: 'paused', stop: 'stopped' }[action];
      if (!mode) return json(404, { error: 'Unknown action' });
      controller.setMode(mode);
      if (mode !== 'stopped') void controller.tick();
      return json(200, { mode });
    } catch (e) { return json(409, { error: e.message }); }
  }
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  if (req.method === 'GET' && files[url.pathname]) {
    const [name, mime] = files[url.pathname]; res.writeHead(200, { 'Content-Type': mime }); return res.end(fs.readFileSync(path.join(root, 'public', name)));
  }
  json(404, { error: 'Not found' });
});
const timer = setInterval(() => void controller.tick(), config.pollSeconds * 1000);
server.on('error', e => { clearInterval(timer); store.close(); releaseLock(); console.error(e.code === 'EADDRINUSE' ? 'Dashboard port already in use. Close the other instance or change config.json.' : 'Could not start local server.'); process.exitCode = 1; });
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Paper trading dashboard: http://localhost:${config.port}\nStarts stopped. Open the dashboard and press Start. No real orders are supported.`);
  if (process.platform === 'darwin') { const browser = spawn('open', [`http://localhost:${config.port}`], { stdio: 'ignore' }); browser.on('error', () => {}); }
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  clearInterval(timer); controller.setMode('stopped'); server.close();
  while (controller.busy) await new Promise(r => setTimeout(r, 50));
  store.close(); releaseLock(); process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
