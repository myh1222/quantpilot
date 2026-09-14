import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.SMOKE_PORT ?? 18787);
const secret = `smoke-${randomBytes(24).toString("hex")}`;
const databaseDirectory = mkdtempSync(join(tmpdir(), "quantpilot-smoke-"));
const databasePath = join(databaseDirectory, "monitor.db");

function request(path, body) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (!response.ok) throw new Error(`health returned ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function expectStatus(response, status) {
  if (response.status !== status) {
    throw new Error(`expected HTTP ${status}, received ${response.status}: ${await response.text()}`);
  }
}

const child = spawn(process.execPath, ["dist/main.js"], {
  env: {
    ...process.env,
    QP_WEBHOOK_SECRET: secret,
    QP_PORT: String(port),
    QP_DB_PATH: databasePath,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const exited = new Promise((resolve) => child.once("exit", () => resolve()));

try {
  const health = await waitForHealth();
  if (health.status !== "ok" || health.db !== "ok") throw new Error("health did not report service and database as healthy");

  const now = Date.now();
  const payload = {
    schema_version: 1,
    pine_config_version: 1,
    alert_instance_id: "gate-tv-01-v1",
    run_id: "process-smoke-v1",
    symbol: "NASDAQ:AAPL",
    ticker: "AAPL",
    timeframe: "15m",
    event: "PROBE_BAR_CLOSE",
    price: 200,
    bar_open_time_ms: now,
    probe_ema: 199.5,
  };

  await expectStatus(await request("/webhook/tradingview/wrong-secret", payload), 404);
  const accepted = await request(`/webhook/tradingview/${secret}`, payload);
  await expectStatus(accepted, 200);
  const firstResult = await accepted.json();
  if (firstResult.delivery !== "accepted") throw new Error(`first delivery was not accepted: ${JSON.stringify(firstResult)}`);

  const duplicate = await request(`/webhook/tradingview/${secret}`, payload);
  await expectStatus(duplicate, 200);
  const duplicateResult = await duplicate.json();
  if (duplicateResult.delivery !== "duplicate") {
    throw new Error(`duplicate delivery was not deduplicated: ${JSON.stringify(duplicateResult)}`);
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const healthAfterDeliveries = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    if (healthAfterDeliveries.pendingJobs === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if ((await (await fetch(`http://127.0.0.1:${port}/health`)).json()).pendingJobs !== 0) {
    throw new Error("worker did not drain the durable job");
  }

  const database = readFileSync(databasePath);
  if (!database || database.length === 0) throw new Error("SQLite database was not persisted");
  if (output.includes(secret)) throw new Error("webhook secret leaked into process output");

  console.log("process smoke passed: auth, validation, idempotency, persistence, worker, secret redaction");
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await exited;
  if (child.exitCode !== 0 && child.exitCode !== null) {
    process.exitCode = child.exitCode;
    console.error(output);
  }
}
