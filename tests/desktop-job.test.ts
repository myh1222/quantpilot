import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import type { DesktopNotification, DesktopNotifier } from "../src/notify/desktop.js";
import { startWorker } from "../src/queue/worker.js";
import { ingestSignal } from "../src/signals/ingest.js";
import { payload } from "./helpers.js";

describe("local alert notification jobs", () => {
  it("sends a desktop notification and completes the durable job", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const notifier = new CapturingNotifier();
    const input = {
      ...payload(),
      event: "EMA_CROSS_UP" as const,
      probe_ema: 199.5,
    };
    const result = ingestSignal(db, input, 1, new Date(), {
      jobType: "notify_local_alert",
    });
    const worker = startWorker(db, {
      pollIntervalMs: 1,
      leaseSeconds: 1,
      maxAttempts: 1,
      desktopNotifier: notifier,
    });

    await waitFor(() => {
      const job = db.prepare("SELECT status FROM jobs WHERE signal_id = ?")
        .get(result.signalId) as { status: string } | undefined;
      return job?.status === "completed";
    });
    await worker.stop();

    expect(notifier.notifications).toEqual([{
      title: "NASDAQ:AAPL EMA_CROSS_UP",
      body: "15m close 200.0000 | EMA 199.5000",
    }]);
    db.close();
  });
});

class CapturingNotifier implements DesktopNotifier {
  readonly notifications: DesktopNotification[] = [];

  async send(notification: DesktopNotification): Promise<void> {
    this.notifications.push(notification);
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
