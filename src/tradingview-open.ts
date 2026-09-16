import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";

const config = loadConfig(process.env, { requireWebhookSecret: false });
const profileDir = resolve(config.tradingView.profileDir);
mkdirSync(profileDir, { recursive: true });

const child = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  `--user-data-dir=${profileDir}`,
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9223",
  "--no-first-run",
  "--no-default-browser-check",
  config.tradingView.chartUrl,
], { stdio: "ignore", detached: true });

child.unref();
process.stdout.write(
  `已用系统 Chrome 打开专用 Profile：${profileDir}\n` +
  "请在普通浏览器窗口完成 TradingView / Google 登录，并确认图表挂载 QuantPilot Structure & Analysis 指标。\n" +
  "完成后关闭这个 Chrome 窗口，然后运行 npm run ui 使用分析功能。\n",
);
