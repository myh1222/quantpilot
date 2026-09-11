import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { claimJob } from "../src/queue/repository.js";
import { ingestSignal } from "../src/signals/ingest.js";
import { payload } from "./helpers.js";

describe("job lease", () => {
  it("does not double-claim an active lease and recovers it after expiry", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = new Date();
    ingestSignal(db, payload(now.getTime()), 1, now);

    const first = claimJob(db, now, 1);
    expect(first).toBeDefined();
    expect(claimJob(db, now, 1)).toBeUndefined();
    expect(claimJob(db, new Date(now.getTime() + 1001), 1)?.id).toBe(first?.id);
    db.close();
  });
});
