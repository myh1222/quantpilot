import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { ingestSignal } from "../src/signals/ingest.js";
import { payload } from "./helpers.js";

describe("signal ingestion", () => {
  it("deduplicates repeated deliveries and creates one durable job", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const input = payload();

    expect(ingestSignal(db, input, 1).delivery).toBe("accepted");
    expect(ingestSignal(db, input, 1).delivery).toBe("duplicate");
    expect((db.prepare("SELECT COUNT(*) count FROM webhook_deliveries").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) count FROM signals").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) count FROM jobs").get() as { count: number }).count).toBe(1);
    db.close();
  });

  it("audits stale config without creating a signal", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const input = { ...payload(), pine_config_version: 0 };

    expect(ingestSignal(db, input, 1).delivery).toBe("stale_config");
    expect((db.prepare("SELECT COUNT(*) count FROM signals").get() as { count: number }).count).toBe(0);
    db.close();
  });
});
