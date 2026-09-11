# QuantPilot Phase 0

TradingView-side Pine alert to an asynchronously persisted local signal gateway.
This repository currently implements the receiver half of GATE-TV-01; it does not
place trades or connect to a brokerage.

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
- Public HTTPS: verified once with an ephemeral Cloudflare quick tunnel; choose a
  controlled VPS or named tunnel before the production gate run.
- GATE-TV-01: PAUSED. TradingView session expired while saving the Pine probe,
  so the Watchlist Alert has not yet been created or measured. Resume after the
  account owner manually signs in; do not automate authentication or export the
  browser session.
