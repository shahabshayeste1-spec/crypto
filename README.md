# Paper Team · Five-coin trading room

A local **paper-only** app: real Codex SDK Analyst and Critic calls discuss trades, a Controller coordinates them, and fixed code enforces one shared virtual account. Default coins: **BTC, ETH, SOL, Zcash (ZEC), and Pump.fun (PUMP)**. It cannot place real orders.

## Run on a Mac

Install **Node.js 24 LTS** from [nodejs.org](https://nodejs.org), open Terminal in this folder, and run:

```sh
bash launch.command
```

It installs locked dependencies, guides Codex sign-in if needed, starts the server, and opens the browser on your Mac. Press **Start / resume**. Keep Terminal open and your Mac awake. Ctrl+C quits the server; your wallet stays saved. A restart starts stopped. Codex account/model access is required. Five coins can use 10 model calls per candle, plus up to one revision per coin; actual model usage may incur charges. An `OPENAI_API_KEY` may instead be supplied in your Terminal environment, never in source files.

## Update an existing installation without losing the wallet

1. Press **Ctrl+C** in the original app's Terminal.
2. Download and unzip the new GitHub ZIP **as a separate folder**; retain your original folder.
3. Run `bash update.command` from the NEW folder. On a Mac, it asks you to select your ORIGINAL Paper Team folder, backs up its files and wallet, installs the update there, preserves other settings, enables the five requested coins, and launches it.
4. Refresh your dashboard with **Command+Shift+R**, then press Start.

You may also pass the original path: `bash update.command "/path/to/original/folder"`. The updater refuses to modify a running wallet. Backups remain in the original folder's `backups/`. The database also makes `data/paper.sqlite.pre-multi-coin.bak` before migrating the old BTC schema. Never delete `data/` to fix startup.

## The animated dashboard

The robot room highlights real scanning, analysis, critique, risk checks and paper execution. Moving packets represent newly recorded message handoffs. Click an agent to filter its messages. Animations stop when no work is occurring and respect reduced-motion settings.

Click BTC, ETH, SOL, ZEC or PUMP to view its completed candlestick chart; hover for OHLC and volume. **Follow team** automatically selects the coin currently being analyzed. Quotes, data availability, indicators, positions, fees and P/L appear alongside the charts. An unavailable feed is reported, with no synthetic replacement. The [preview screenshot](docs/dashboard-preview.png) is explicitly labeled **OFFLINE FIXTURE PREVIEW**, not live AI or market data.

**Pause entries** blocks buys while monitoring and agent-approved sells continue. **Stop** cancels the cycle and stops monitoring. **Exit all positions** attempts a fresh-quote sale for each held coin without needing agents, even while paused/stopped. Failed exits are reported individually; other coins can still exit. Cancel an in-flight cycle or wait for it first.

## Settings and limits

Edit `config.json` and restart:

| Setting | Default | Meaning |
| --- | --- | --- |
| `symbols` | BTC/ETH/SOL/ZEC/PUMP USD pairs | Enabled analyses; select a subset of these exact symbols if desired |
| `intervalSeconds` | `300` | 60, 300, 900, 3600 or 86400; 21600 also works without PUMP |
| `pollSeconds` | `30` | Check for completed candles |
| `staleAfterSeconds` | `420` | Maximum age since candle completion; at least the interval |
| `feeBps` / `slippageBps` | `10` / `5` | 0.10% fee and 0.05% adverse fill movement |
| `agentTimeoutSeconds` | `90` | Timeout per model call |
| `model` | `null` | Codex default, or your accessible model ID |
| `port` | `8787` | Local dashboard port |

Fixed limits: **$10,000** initial virtual cash, **$500 per buy including fees**, **20% total crypto exposure across all coins**, no leverage or shorts. A 2% loss from daily starting equity pauses all buys until the next UTC day, even after a rebound. The baseline is the first fully valued observation that day. Fresh quotes for every held asset are required before buying. Existing holdings remain visible and valued even if you disable that coin's analyses.

Each coin/candle has a unique durable claim and proposal ID: one proposal, one independent critique, at most one revision. Revisions are saved but deferred until a later candle can receive independent acceptance. Failed agents or any watched stale/unavailable data block new entries; exits remain possible. Execution uses a quote obtained after approval with simulated costs, never a past candle close. Quotes older than 30 seconds cannot fill. P/L uses each asset's last observed quote, with its timestamp shown. Missed or interrupted candles are never backfilled or replayed.

## Active strategy and persistent learning

Version 1.2 defaults to `strategyMode: "active"`, `learningEnabled: true`, and `probeBuyUsd: 100` (allowed $25–$150). The Analyst considers a small paper probe with at least one of: SMA5 above SMA20, positive last-candle return, or RSI14 between 40 and 70. It must explain a specific blocker when holding despite a candidate. The Critic evaluates modest experiments without demanding certainty; it still independently rejects weak or inconsistent proposals. No trade is forced.

Feedback persists in SQLite and is sent to both agents. After three fully completed candles that **opened after** a decision, the program records a counterfactual return with estimated costs. These observations are explicitly hypothetical: they are never fills, cash or realized profits. No future candles enter an earlier decision. Nearby observations are correlated, so they do not establish a profitable edge.

Actual fully closed positions supply fee-inclusive net results, including earlier partial exits. After at least ten completed positions per coin, negative recent net results tighten entry requirements to two signals and probes to $50. Positive net results with at least 60% winning positions permit probes up to $150, within your configured cap. Before enough results, the default is up to $100. Existing positions from older versions remain intact but are excluded from complete-position learning if their prior partial-exit totals are unknown. Advisory exit hypotheses are approximately 1% net profit or 0.8% adverse movement; these are model suggestions, not automatic guaranteed stops.

The dashboard shows active strategy, supporting-signal count, completed-position sample count and observed outcomes below the chart. Controller message evidence contains the full feedback used by the next agents. Set `strategyMode` to `"conservative"` to require all three entry signals, or `learningEnabled` to false to disable new observations and outcome-based adaptation. Models remain free to reject a candidate. This is persistent feedback and bounded strategy adaptation, **not neural-model training or proof of improved returns**. The AI cannot change its own code, credentials, or fixed account limits.

## Tests and connections

```sh
npm test           # risk, five coins, migration, controller, dashboard, HTTP and updater
npm run check:ai   # real Codex SDK check; no mock fallback
npm run demo       # labeled OFFLINE fixtures: approved $500 buy, rejected $501 buy
npm run test:browser # optional real Chromium UI test, using labeled offline trading fixtures
```

The optional browser test uses system Chromium at `/usr/bin/chromium`; set `PAPER_BROWSER_PATH` to your Chrome executable on another platform. It saves an explicitly offline preview screenshot. Normal app startup does not require Chromium or this test.

BTC/ETH/SOL/ZEC data uses **api.exchange.coinbase.com**; PUMP uses Kraken's **api.kraken.com** PUMP/USD public OHLC and bid/ask feed. Market availability varies by provider; unavailable markets pause entries rather than invent prices. No exchange credentials are needed. Wallet, messages, decisions and per-coin claims persist in `data/paper.sqlite`; full history is linked from the dashboard. Authentication values and raw SDK errors are not logged.

To sign in after installation: `./node_modules/.bin/codex login`. SDK integration follows [OpenAI's official SDK README](https://github.com/openai/codex/tree/main/sdk/typescript). See [validation notes](docs/validation.md) for tested behavior and cloud-only limitations.
