# Validation in the build environment

- Node.js 24.19.0; Codex SDK 0.160.1, pinned with a package lock.
- Official documentation reviewed: OpenAI `openai/codex` TypeScript SDK README and official CLI configuration schema. The developers.openai.com page returned HTTP 403 here; the official GitHub source was accessible.
- All 21 automated tests passed. The one-command launcher was exercised with an isolated test wallet; dashboard assets, the initial $10,000 balance and the Start control worked. Live polling then failed closed under the market network policy, without a trade.
- Automated tests exercise the actual controller, risk engine, SQLite store and HTTP server. Agent and market dependencies in those tests are explicitly offline fixtures, not real AI.
- The offline demonstration executes a $500 buy, including fees/slippage, then rejects a $501 buy despite Critic acceptance. It does not modify the real wallet.
- A real SDK model request was attempted, including a supported SQLite/log-directory override during diagnosis. Both failed at CLI app-server initialization because this managed environment's Codex runtime is read-only. Existing `codex login status` reported ChatGPT authentication; no missing credentials were inferred.
- Live Coinbase requests returned HTTP 403 / CONNECT policy denial. The cloud configuration draft adds `api.exchange.coinbase.com`; saving a draft does not apply its network changes. The user must review/save environment settings and publish to activate the reusable cloud setup.
- No live-market, real-AI trading cycle has been validated here. `npm run check:ai` gives a clear failure instead of substituting mocked output. A normal writable Mac Codex profile and public market connectivity are the prerequisites for live paper operation.

The HTTP integration test fetches dashboard assets and state, checks initial $10,000 cash, protects controls against cross-origin requests, rejects a second server using the wallet, and verifies restart behavior. Internal tests cover Critic rejection, a single bounded revision, schema failure, late/stale data, cancellation, duplicate candle/trade protection, durable restart recovery, manual exits when agents fail, fixed exposure/buy/cash limits, daily drawdown, fees, slippage and partial-sale cost basis.

Model sessions may also be retained by Codex in its normal local profile. Application message history contains the final structured proposals, critiques, evidence and controller/risk decisions, not private model reasoning. Read-only agent sandboxes and disabled shell/web tools keep execution in application code. This application accepts no exchange credentials and implements no live-order route.
