import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { buildApp } from "../src/server/app.js";
import { payload, testConfig } from "./helpers.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("TradingView webhook", () => {
  it("persists before returning 200", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const now = new Date();
    const app = buildApp({ config: testConfig, db, now: () => now });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/webhook/tradingview/${testConfig.webhookSecret}`,
      payload: payload(now.getTime()),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, delivery: "accepted" });
    expect((db.prepare("SELECT COUNT(*) count FROM jobs").get() as { count: number }).count).toBe(1);
    db.close();
  });

  it("hides the endpoint for an invalid secret", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const app = buildApp({ config: testConfig, db });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/webhook/tradingview/wrong", payload: payload() });
    expect(response.statusCode).toBe(404);
    db.close();
  });
});
