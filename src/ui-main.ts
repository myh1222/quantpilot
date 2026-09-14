import { loadConfig } from "./config.js";
import { buildUiApp } from "./server/ui.js";

const config = loadConfig(process.env, { requireWebhookSecret: false });
const app = buildUiApp({ config });

app.listen({ host: "127.0.0.1", port: config.port }).then((address) => {
  process.stdout.write(`QuantPilot 已启动：${address}\n`);
  process.stdout.write("按 Ctrl+C 停止。\n");
}).catch((error) => {
  console.error("QuantPilot 前端启动失败：", error);
  process.exitCode = 1;
});

const shutdown = async () => {
  await app.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
