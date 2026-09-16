# QuantPilot Phase 0

TradingView-side Pine alert to an asynchronously persisted local signal gateway.

## Local Web UI

The primary user interface is now a local-only analysis dashboard:

```bash
npm install
npm run ui
```

Open <http://127.0.0.1:8787>. The UI can render recent candles, EMA overlays,
frozen support/resistance levels, deterministic scoring and optional AI
judgement. It also manages a persistent watchlist, account positions and optional
account risk parameters. A user-supplied AI key is accepted only for the current
request and is not persisted by the browser or server.

See [the Chinese user guide](docs/USER_GUIDE.zh-CN.md) for the complete workflow.
This repository implements the receiver half of GATE-TV-01 and records the
2026-09-11 TradingView feasibility result. It does not place trades or connect
to a brokerage.

## Requirements

- Node.js 20+
- npm
- SQLite CLI (`sqlite3`), useful for inspecting the local database

## Configuration

Secrets are supplied through the environment, never through `config/monitor.yaml`.

```text
QP_WEBHOOK_SECRET=<at least 24 random characters>
QP_PORT=8787
QP_DB_PATH=data/monitor.db
QP_CONFIG_PATH=config/monitor.yaml
```

The TradingView webhook URL is:

```text
http://127.0.0.1:8787/webhook/tradingview/<QP_WEBHOOK_SECRET>
```

TradingView requires a public HTTPS endpoint. For a production run, deploy behind
Nginx/Caddy on a VPS or use a controlled HTTPS tunnel. Do not expose the local
development port directly.

## Local Alerts

The tested TradingView Basic account cannot run server-side technical alerts or
webhooks. Set `localAlerts.enabled: true` to poll confirmed candles locally,
evaluate EMA20 close-through crossings, and enqueue durable macOS notification
jobs. The first poll only arms the rule; it never replays historical signals.

The default `yahoo` provider is isolated behind `MarketProvider`. Verify its data
terms, exchange coverage, latency, and rate limits before production use. Replace
the provider implementation without changing the rule or SQLite outbox.

Run one poll without starting the HTTP server:

```bash
QP_WEBHOOK_SECRET=<secret> npm run alert:once
```

Local state, including the last evaluated bar and provider failures, is stored in
the same SQLite database. Notification delivery is retried through the existing
job lease and dead-letter flow.

## Chart and Analysis

Add `pine/quantpilot-structure-analysis.pine` to a TradingView chart to draw only
confirmed, frozen pivot support/resistance levels. The dashboard shows EMA trend,
daily context, RSI, volume ratio, S1/S2/R1/R2, and level touch/break statistics.
It does not require a TradingView server-side alert.

### On-demand TradingView enrichment

QuantPilot can query the Pine indicator's Data Window during an analysis without
using a TradingView alert or webhook. Copy the current
`pine/quantpilot-structure-analysis.pine` into TradingView, then create the
dedicated login profile once:

```bash
npm run tradingview:open
```

Keep that dedicated Chrome window open, then set `tradingView.enabled: true` in
`config/monitor.yaml`. The UI will
offer “缝合 TradingView 指标”. TradingView contributes only the current confirmed
Pine snapshot; Yahoo remains responsible for historical candles and local
statistics. Missing login, Pine fields, or a changed TradingView UI causes an
explicit local-data fallback rather than failing the whole analysis.

Keep `tradingView.expectedScriptVersion` aligned with `QP_SCRIPT_VERSION` in the
Pine script. A mismatch fails closed and the analysis falls back to local market data.

See [the pull integration design](docs/TRADINGVIEW_PULL_INTEGRATION.zh-CN.md) for
the data contract, alignment thresholds, privacy boundary and known limitations.

Generate local JSON and Markdown reports with:

```bash
npm run analyze:once
```

Reports are written under `results/`. To append an AI interpretation, set
`ai.enabled: true`, choose `transport`, `baseUrl` and `model`, then
provide `QP_AI_API_KEY` through the environment. The key is never read from YAML
or written to reports. A server/keychain key is bound to those server-owned AI
settings; a custom destination must use a per-request key. Processed technical
facts are submitted, while position facts are submitted only after explicit UI
consent. An account can contain multiple positions and multiple currency cash
balances; account names, local IDs, cash notes and TradingView browser state are
never sent. Structured
output forbids AI-generated final confidence scores and unsupported claims.

See [the portfolio account design](docs/PORTFOLIO_ACCOUNT_DESIGN.zh-CN.md) for
the account/cash/position model, migration rules and multi-currency limitations.

```bash
QP_AI_API_KEY=<user-key> npm run analyze:once
```

If the AI provider is unavailable, the command still writes the deterministic
technical report and records the AI section as `failed`; technical analysis never
depends on a successful model call.

## Verify

```bash
npm install
npm run typecheck
npm test
npm run build
npm run smoke
```

`npm run smoke` starts the real compiled process, sends an unauthorized request,
sends and repeats a valid alert, and verifies the worker drains its durable job.
It fails if the webhook secret appears in process output.

## Current Gate Status

- Receiver: PASS for local process auth, schema/version filtering, atomic SQLite
  persistence, delivery idempotency, durable worker completion, and URL redaction.
- Public HTTPS: COMPONENT PASS. Both an ephemeral Cloudflare quick tunnel and an
  ephemeral localhost.run HTTPS tunnel reached the real receiver; the latter
  accepted and deduplicated a public POST. Choose a controlled VPS or named tunnel
  before production.
- Pine configuration: COMPONENT PASS. `QuantPilot Watchlist Alert Spike` is saved,
  mounted on the chart, and exposed to the alert dialog as
  `Any alert() function call` with dynamic JSON generated inside Pine.
- GATE-TV-01: FAIL for the tested TradingView Basic account on 2026-09-11. The UI
  reports zero technical-alert capacity, gates Watchlist Alerts behind Premium,
  and gates webhook notifications behind an upgraded plan. Consequently no
  TradingView server-side execution or real TradingView webhook could be created.
- Market data: FAIL for realtime HKEX monitoring on the tested account. `HKEX:981`
  is explicitly marked as delayed by 15 minutes.

The exact evidence, decision, and rerun instructions are in
[`docs/adr/0001-gate-tv-01.md`](docs/adr/0001-gate-tv-01.md). Phase 1 must not start
against this account entitlement. After upgrading to a plan that provides at least
one technical alert and webhook notifications, rerun the short server-side portion
of the gate. If Watchlist Alerts remain unavailable, use one aggregated `alert()`
alert per symbol and trigger timeframe.
