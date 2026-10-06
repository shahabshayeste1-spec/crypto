import { Agents } from '../src/agents.js';
import { loadConfig } from '../src/config.js';
const agents = new Agents(loadConfig());
try {
  const context = { purpose: 'Connectivity check only, not a trading cycle. No market data is supplied; choose HOLD with amountUsd 0.', wallet: { virtualCash: 10000 }, tradingDisabled: true };
  const analyst = await agents.ask('Analyst', context);
  const critic = await agents.ask('Critic', { ...context, proposal: analyst.body });
  console.log(JSON.stringify({ source: 'actual-codex-model-calls', analyst, critic }, null, 2));
} catch (error) {
  const text = String(error.message);
  const hint = /read-only file system/i.test(text) ? 'Codex runtime storage is read-only. Run on your Mac with a writable normal Codex profile; this is not proof of missing authentication.'
    : /auth|login|401|credential/i.test(text) ? 'Authenticate with: npx --no-install codex login. Alternatively export your own OPENAI_API_KEY locally, never in source or chat.'
    : /abort|timeout/i.test(text) ? 'Call timed out. Check connectivity, model access and agentTimeoutSeconds.'
    : 'Check your Codex login, writable profile, selected model, and API connectivity.';
  console.error(`Real Codex SDK check failed. No mocked fallback. ${hint}`); process.exitCode = 1;
}
