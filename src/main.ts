import { loadConfig } from "./config.js";
import { migrate, openDatabase } from "./db/database.js";
import { startLocalAlertPoller } from "./local-alerts/poller.js";
import { YahooChartProvider } from "./local-alerts/yahoo.js";
import { MacOsNotifier } from "./notify/desktop.js";
import { startWorker } from "./queue/worker.js";
import { buildApp } from "./server/app.js";

const config = loadConfig();
const db = openDatabase(config.dbPath);
migrate(db);

const app = buildApp({ config, db });
const notifier = new MacOsNotifier();
const worker = startWorker(db, {
  ...config.worker,
  desktopNotifier: config.localAlerts?.desktopNotifications ? notifier : undefined,
});
const poller = config.localAlerts?.enabled
  ? startLocalAlertPoller(
    db,
    config.localAlerts,
    new YahooChartProvider(),
    (error) => console.error("local alert poller error:", error),
  )
  : undefined;

let shutdownPromise: Promise<void> | undefined;

const shutdown = () => {
  shutdownPromise ??= (async () => {
    await poller?.stop();
    await worker.stop();
    await app.close();
    db.close();
  })().catch((error) => {
    console.error("shutdown failed:", error);
    process.exitCode = 1;
  });
  return shutdownPromise;
};

app.listen({ host: "0.0.0.0", port: config.port }).catch((error) => {
  console.error("server failed to start:", error);
  process.exitCode = 1;
  void shutdown();
});

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
