import { loadConfig } from "./config.js";
import { migrate, openDatabase } from "./db/database.js";
import { startWorker } from "./queue/worker.js";
import { buildApp } from "./server/app.js";

const config = loadConfig();
const db = openDatabase(config.dbPath);
migrate(db);

const app = buildApp({ config, db });
const worker = startWorker(db, config.worker);

const shutdown = async () => {
  await app.close();
  await worker.stop();
  db.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ host: "0.0.0.0", port: config.port });
