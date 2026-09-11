import Fastify from "fastify";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/database.js";
import { ingestSignal } from "../signals/ingest.js";
import { signalPayloadSchema } from "../signals/payload.js";

type Dependencies = {
  config: AppConfig;
  db: Db;
  now?: () => Date;
};

export function buildApp({ config, db, now = () => new Date() }: Dependencies) {
  const app = Fastify({
    logger: false,
    bodyLimit: 32 * 1024,
  });

  app.get("/health", async () => {
    const pending = db.prepare(`
      SELECT COUNT(*) AS count FROM jobs WHERE status IN ('pending', 'retry', 'running')
    `).get() as { count: number };
    return { status: "ok", db: "ok", pendingJobs: pending.count };
  });

  app.post<{ Params: { secret: string } }>("/webhook/tradingview/:secret", async (request, reply) => {
    if (request.params.secret !== config.webhookSecret) {
      return reply.code(404).send({ error: "not_found" });
    }

    const parsed = signalPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload" });
    }

    const receivedAt = now();
    if (Math.abs(receivedAt.getTime() - parsed.data.bar_open_time_ms) > config.maxBarAgeMs) {
      return reply.code(400).send({ error: "bar_time_out_of_range" });
    }

    const result = ingestSignal(db, parsed.data, config.currentPineConfigVersion, receivedAt);
    return reply.code(200).send({ ok: true, delivery: result.delivery });
  });

  return app;
}
