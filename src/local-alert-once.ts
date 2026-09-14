import { loadConfig } from "./config.js";
import { migrate, openDatabase } from "./db/database.js";
import { pollLocalAlertsOnce } from "./local-alerts/poller.js";
import { YahooChartProvider } from "./local-alerts/yahoo.js";

const config = loadConfig(process.env, { requireWebhookSecret: false });
if (!config.localAlerts) throw new Error("localAlerts config is missing");

const db = openDatabase(config.dbPath);
try {
  migrate(db);
  const outcomes = await pollLocalAlertsOnce(
    db,
    config.localAlerts,
    new YahooChartProvider(),
  );
  console.log(JSON.stringify({ outcomes }, null, 2));
} finally {
  db.close();
}
