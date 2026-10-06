# BTC Paper Team

A small local app: a real **Codex SDK Analyst** proposes a trade, a separate **Critic** challenges it, and deterministic code controls a persistent virtual wallet. It cannot place real orders.

## Run on a Mac

1. Install **Node.js 24 LTS** using the Mac installer at [nodejs.org](https://nodejs.org).
2. Open Terminal in this project folder and run:

   ```sh
   ./launch.command
   ```

   You can also double-click `launch.command` in Finder. It installs locked dependencies, asks you to sign into Codex if necessary, starts the server, and opens your browser on a Mac. Codex account/model access is required; actual model calls may incur usage charges. Alternatively, supply your own `OPENAI_API_KEY` in your Terminal environment, never in a source file.
3. Press **Start / resume** in the dashboard. It runs autonomously while Terminal stays open. Press Ctrl+C in Terminal to quit the server.

**Start** evaluates the latest completed candle, then each newly completed candle once. **Pause entries** keeps monitoring and permits agent-approved sells; it blocks buys. **Stop** cancels the current cycle and stops monitoring. **Exit all BTC** sells the virtual position without needing agents, even while paused/stopped; it still requires a fresh public quote. Wait for an in-flight cycle to finish or cancel it first.

Wallet and history persist in `data/paper.sqlite`. A restart starts stopped; press Start again. Interrupted candles are recorded and never replayed. Missed candles are skipped rather than backfilled. Only one server can use a wallet. Keep Terminal running (and prevent Mac sleep) for continuous operation.

## Settings

Edit `config.json`, then restart:

| Setting | Default | Meaning |
| --- | --- | --- |
| `intervalSeconds` | `300` | Coinbase candles: 60, 300, 900, 3600, 21600, or 86400 seconds |
| `pollSeconds` | `30` | Check for a newly completed candle |
| `staleAfterSeconds` | `420` | Maximum age since latest candle completed; must be at least the interval |
| `feeBps` / `slippageBps` | `10` / `5` | 0.10% fee and 0.05% adverse fill movement |
| `agentTimeoutSeconds` | `90` | Timeout per model call |
| `model` | `null` | Use Codex's default model, or your accessible Codex model ID |
| `port` | `8787` | Local dashboard port |

Fixed limits live in risk code, beyond AI control: BTC-USD only, $10,000 starting cash, $500 total cash per buy **including fees**, 20% maximum BTC exposure after costs, no leverage or shorts. At a 2% loss from the day's starting equity, buys pause for the rest of that UTC day, even after a rebound. The daily baseline is the first fresh quote observed that day; exits stay available.

A cycle allows one proposal, one critique and at most one revision. An ACCEPT still needs risk approval. Requested revisions are saved but cannot trade until a later candle gets independent acceptance. Data errors or agent failures never generate fallback AI responses or fills. A successful later cycle restores agent health. Execution uses a newly fetched bid/ask after approval, with fees and slippage; never a previous candle close. Unrealized P/L and exposure use the last observed quote, whose timestamp appears on the dashboard.

## Check it

```sh
npm test           # risk, failure, persistence, accounting and HTTP integration tests
npm run check:ai   # real SDK connectivity check; requires usable Codex authentication/runtime
npm run demo       # OFFLINE fixtures: one approved $500 buy and one rejected $501 buy
```

The demo uses synthetic market data, deterministic agent fixtures and an isolated in-memory wallet. **It is not actual AI output.** Its saved example is [docs/offline-demo.json](docs/offline-demo.json). The full real application history is available from the dashboard's JSON link and SQLite; no credentials or raw SDK errors are logged.

Public data requires access to `api.exchange.coinbase.com`; no exchange API key is needed. To sign in again after installation: `./node_modules/.bin/codex login`. A read-only Codex runtime must be made writable by the host; logging in again does not fix that. Tests and offline fixtures run independently of these prerequisites.

SDK integration follows [OpenAI's official current SDK README](https://github.com/openai/codex/tree/main/sdk/typescript): independent threads, `outputSchema`, cancellation signals, read-only sandbox and no web search. See [validation notes](docs/validation.md) for what was verified in the build environment.
