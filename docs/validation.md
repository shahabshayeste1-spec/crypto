# Validation

## Version 1.1: five coins and animated dashboard

- Node.js 24.19.0; Codex SDK 0.160.1; frozen package lock. Real Analyst/Critic integration remains separate, schema-constrained SDK threads with cancellation, read-only sandbox, disabled shell and web search.
- All 32 automated tests passed. Automated tests cover aggregate exposure, fresh marks for every held asset, daily drawdown across assets, no shorting, bounded revisions, failed agents/feeds, execution quote failure, pause/stop, duplicates by symbol and candle, restart recovery after a committed fill, fees and partial-sale basis.
- A legacy BTC database migrates without changing cash, BTC quantity, cost basis, fees, realized P/L, daily-loss state or old candle claims. A consistent pre-migration SQLite backup is retained. Removing a coin from enabled analyses does not hide existing holdings.
- The Mac updater preserves the original wallet and user settings, creates local backups, handles paths with spaces, and refuses to modify a running installation.
- Real Chromium verification serves the actual dashboard from the actual HTTP server. Cold boot renders the $10,000 wallet, five tabs and four agents. With explicitly offline trading dependencies, it tests Start, working-Critic animation, 60 SVG candles, PUMP tab selection, hover OHLC, agent filtering, Pause, Stop and mobile layout. No browser JavaScript or Content Security Policy errors were observed. The screenshot is clearly labeled OFFLINE FIXTURE PREVIEW.
- Provider tests validate Coinbase ZEC routing, Kraken PUMP/USD parsing, completion-time filtering, bid/ask selection, server-date freshness, and unavailable-pair failure. They use HTTP fixtures, not a claim of successful live PUMP access.

## Live-operation limits of this cloud build

The official SDK README and CLI schema were read from OpenAI's official repository because developers.openai.com returned 403. Real SDK requests in this managed cloud failed at runtime initialization: the injected Codex profile is read-only, despite an existing ChatGPT login. Supported SQLite/log-directory overrides did not resolve it. No missing authentication was inferred and no mocked fallback was used.

The cloud also denied live Coinbase and Kraken requests through its network proxy. Required public domains are api.exchange.coinbase.com and api.kraken.com. Saving their draft network configuration does not apply it; cloud review/save and publication remain separate. A normal writable Mac Codex profile and public-provider connectivity are needed for live operation. The user subsequently supplied a screenshot showing fresh BTC data and both real agents completing HOLD on their Mac; that is user-side evidence, not a five-coin live test in this cloud.

The local HTTP tests protect controls against cross-origin requests, reject multiple servers for one wallet, and preserve restart state. Application history retains final structured messages and evidence, not private reasoning. Model sessions may also be retained in the user's normal Codex profile. No live-order route or exchange credential is implemented.

## Version 1.2: active exploration and feedback

All 39 automated tests pass, along with the real-browser smoke test. Active-mode tests cover mild-signal candidates, conservative mode, tightening after losing completed positions, capped probes after positive completed-position results, separation by coin, exclusion of partial sales from training samples, persistence across restart, three truly subsequent candles without lookahead, unique counterfactual observations, and identical feedback supplied to both agents. Closed-position results include earlier partial realized P/L without double counting. Historical positions without tracked earlier partial exits cannot supply a complete learning sample. Risk limits and independent critique remain unchanged. Browser checks also exercise the updated feedback display using explicitly offline trading fixtures. No real model profitability or guaranteed activity is claimed.
