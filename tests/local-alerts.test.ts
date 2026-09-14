import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import type { BarRequest, MarketProvider } from "../src/local-alerts/provider.js";
import { pollLocalAlertsOnce } from "../src/local-alerts/poller.js";
import type { MarketBar } from "../src/local-alerts/rule.js";

const now = new Date("2026-09-11T02:00:00.000Z");
const minuteMs = 60_000;
const nextBarOpenMs = now.getTime() - 10 * minuteMs;
const later = new Date(nextBarOpenMs + 25 * minuteMs);

describe("local alert polling", () => {
  it("arms once, emits one durable signal, and deduplicates repeated bars", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const provider = new QueueProvider(
      bars(20, 100),
      bars(20, 100).concat([{ openTimeMs: nextBarOpenMs, close: 101 }]),
      bars(20, 100).concat([{ openTimeMs: nextBarOpenMs, close: 101 }]),
    );
    const config = localConfig();

    await expect(pollLocalAlertsOnce(db, config, provider, now)).resolves.toEqual([
      { symbol: "HKEX:981", status: "armed", signalCount: 0 },
    ]);
    await expect(pollLocalAlertsOnce(db, config, provider, later)).resolves.toEqual([
      { symbol: "HKEX:981", status: "evaluated", signalCount: 1 },
    ]);
    await expect(pollLocalAlertsOnce(db, config, provider, later)).resolves.toEqual([
      { symbol: "HKEX:981", status: "evaluated", signalCount: 0 },
    ]);

    expect(count(db, "signals")).toBe(1);
    expect(count(db, "jobs")).toBe(1);
    expect((row(db, "SELECT job_type FROM jobs") as { job_type: string }).job_type)
      .toBe("notify_local_alert");
    db.close();
  });

  it("records provider failures without advancing the evaluation cursor", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const provider = new QueueProvider(bars(20, 100));
    const config = localConfig();

    await pollLocalAlertsOnce(db, config, provider, now);
    provider.failNext = true;
    await pollLocalAlertsOnce(db, config, provider, now);
    provider.failNext = true;
    await pollLocalAlertsOnce(db, config, provider, now);

    const state = row(db, `
      SELECT last_evaluated_bar_ms, consecutive_failures, last_error
      FROM local_alert_state
    `) as {
      last_evaluated_bar_ms: number;
      consecutive_failures: number;
      last_error: string;
    };
    expect(state.last_evaluated_bar_ms).toBe(lastOpenMs());
    expect(state.consecutive_failures).toBe(2);
    expect(state.last_error).toBe("quota exceeded");
    db.close();
  });
});

class QueueProvider implements MarketProvider {
  readonly name = "test";
  failNext = false;
  private readonly responses: MarketBar[][];
  private index = 0;

  constructor(...responses: MarketBar[][]) {
    this.responses = responses;
  }

  async fetchBars(request: BarRequest): Promise<MarketBar[]> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("quota exceeded");
    }
    void request;
    return this.responses[this.index++] ?? this.responses.at(-1) ?? [];
  }
}

function localConfig() {
  return {
    enabled: true,
    provider: "yahoo",
    pollIntervalMs: 60_000,
    timeframeMinutes: 15,
    confirmationLagSeconds: 600,
    emaLength: 20,
    pineConfigVersion: 1,
    alertInstanceId: "local-ema-cross-v1",
    runId: "local-alerts",
    desktopNotifications: true,
    symbols: [{ symbol: "HKEX:981", providerSymbol: "0981.HK" }],
  };
}

function bars(count: number, close: number): MarketBar[] {
  return Array.from({ length: count }, (_, index) => ({
    openTimeMs: lastOpenMs() - (count - 1 - index) * 15 * minuteMs,
    close,
  }));
}

function lastOpenMs(): number {
  // The bar closes after 15m and must additionally clear the 10m lag.
  return now.getTime() - 25 * minuteMs;
}

function count(db: ReturnType<typeof openDatabase>, table: string): number {
  return (row(db, `SELECT COUNT(*) AS count FROM ${table}`) as { count: number }).count;
}

function row(db: ReturnType<typeof openDatabase>, sql: string): unknown {
  return db.prepare(sql).get();
}
