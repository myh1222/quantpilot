import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import type {
  TradingViewSnapshot,
  TradingViewSnapshotProvider,
  TradingViewSnapshotRequest,
} from "./types.js";

type BrowserProviderOptions = {
  chartUrl: string;
  profileDir: string;
  headless: boolean;
  timeoutMs: number;
  indicatorTitle: string;
  expectedScriptVersion: number;
};

const fieldNames = [
  "QP_BAR_TIME_S", "QP_CLOSE", "QP_EMA20", "QP_EMA50", "QP_EMA200",
  "QP_RSI14", "QP_ATR14", "QP_VOLUME_RATIO", "QP_DAILY_TREND", "QP_SCORE",
  "QP_SUPPORT1", "QP_SUPPORT2", "QP_RESISTANCE1", "QP_RESISTANCE2",
  "QP_SUPPORT1_CONFIRMED_S", "QP_RESISTANCE1_CONFIRMED_S", "QP_CONFIRMED_SUPPORTS",
  "QP_CONFIRMED_RESISTANCES", "QP_SUPPORT_TOUCHES", "QP_RESISTANCE_TOUCHES",
  "QP_SUPPORT_BREAKS", "QP_RESISTANCE_BREAKS", "QP_SCRIPT_VERSION",
] as const;

export class TradingViewBrowserSnapshotProvider implements TradingViewSnapshotProvider {
  private browser?: Browser;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: BrowserProviderOptions) {}

  fetchSnapshot(request: TradingViewSnapshotRequest): Promise<TradingViewSnapshot> {
    const task = this.queue.then(() => this.fetchSerial(request));
    this.queue = task.catch(() => undefined);
    return task;
  }

  async close(): Promise<void> {
    // The profile is owned by the user's normal Chrome window; detach only.
    await this.browser?.close();
    this.browser = undefined;
  }

  private async fetchSerial(request: TradingViewSnapshotRequest): Promise<TradingViewSnapshot> {
    const page = await this.getPage();
    const url = new URL(this.options.chartUrl);
    url.searchParams.set("symbol", request.symbol);
    url.searchParams.set("interval", String(request.timeframeMinutes));
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: this.options.timeoutMs });
    await this.assertLoggedIn(page);
    await this.openDataWindow(page);
    await page.getByText(this.options.indicatorTitle, { exact: false }).last()
      .waitFor({ state: "visible", timeout: this.options.timeoutMs });

    const values: Partial<Record<(typeof fieldNames)[number], number | null>> = {};
    for (const name of fieldNames) values[name] = await readDataWindowNumber(page, name);
    const required = (name: (typeof fieldNames)[number]): number => {
      const value = values[name];
      if (value === null || value === undefined || !Number.isFinite(value)) {
        throw new Error(`TradingView Data Window field ${name} is unavailable`);
      }
      return value;
    };
    const optional = (name: (typeof fieldNames)[number]): number | null => values[name] ?? null;
    const integer = (name: (typeof fieldNames)[number]): number => Math.round(required(name));
    const dailyTrend = integer("QP_DAILY_TREND");
    if (dailyTrend !== -1 && dailyTrend !== 0 && dailyTrend !== 1) {
      throw new Error("TradingView daily trend encoding is invalid");
    }

    const scriptVersion = integer("QP_SCRIPT_VERSION");
    if (scriptVersion !== this.options.expectedScriptVersion) {
      throw new Error(
        `TradingView Pine version mismatch: expected ${this.options.expectedScriptVersion}, got ${scriptVersion}`,
      );
    }

    return {
      source: "tradingview-data-window",
      symbol: request.symbol,
      timeframeMinutes: request.timeframeMinutes,
      fetchedAt: new Date().toISOString(),
      barTimeMs: integer("QP_BAR_TIME_S") * 1000,
      close: required("QP_CLOSE"),
      ema20: required("QP_EMA20"),
      ema50: required("QP_EMA50"),
      ema200: required("QP_EMA200"),
      rsi14: required("QP_RSI14"),
      atr14: required("QP_ATR14"),
      volumeRatio20: optional("QP_VOLUME_RATIO"),
      dailyTrend,
      technicalScore: integer("QP_SCORE"),
      support1: optional("QP_SUPPORT1"),
      support2: optional("QP_SUPPORT2"),
      resistance1: optional("QP_RESISTANCE1"),
      resistance2: optional("QP_RESISTANCE2"),
      support1ConfirmedAtMs: secondsToOptionalMs(optional("QP_SUPPORT1_CONFIRMED_S")),
      resistance1ConfirmedAtMs: secondsToOptionalMs(optional("QP_RESISTANCE1_CONFIRMED_S")),
      confirmedSupports: integer("QP_CONFIRMED_SUPPORTS"),
      confirmedResistances: integer("QP_CONFIRMED_RESISTANCES"),
      supportTouches: integer("QP_SUPPORT_TOUCHES"),
      resistanceTouches: integer("QP_RESISTANCE_TOUCHES"),
      supportBreaks: integer("QP_SUPPORT_BREAKS"),
      resistanceBreaks: integer("QP_RESISTANCE_BREAKS"),
      scriptVersion,
    };
  }

  private async getPage(): Promise<Page> {
    if (this.browser === undefined) {
      mkdirSync(this.options.profileDir, { recursive: true });
      try {
        this.browser = await chromium.connectOverCDP("http://127.0.0.1:9223", {
          timeout: this.options.timeoutMs,
        });
      } catch {
        throw new Error("TradingView Chrome is not running; run npm run tradingview:open and log in");
      }
    }
    return this.browser.contexts()[0]?.pages()[0] ?? await this.browser.contexts()[0]!.newPage();
  }

  private async assertLoggedIn(page: Page): Promise<void> {
    const hasSignIn = await page.getByText(/sign in|登录/i).count() > 0;
    const hasChartError = await page.getByText(/Can't open this chart|无法打开/i).count() > 0;
    if (page.url().includes("signin") || (hasSignIn && hasChartError)) {
      throw new Error("TradingView profile is not logged in; run npm run tradingview:open and log in");
    }
  }

  private async openDataWindow(page: Page): Promise<void> {
    if (await page.getByText("QP_BAR_TIME_S", { exact: true }).count() > 0) return;
    const panel = page.locator('[data-name="object_tree"], [role="tab"][aria-label*="Data Window"], [data-name="data-window"]')
      .first();
    await panel.waitFor({ state: "visible", timeout: this.options.timeoutMs });
    const toggle = page.locator('[data-name="object_tree"], [data-name="data-window"]').first();
    const dataWindowTab = page.getByRole("tab", { name: /Data Window|数据窗口/i }).first();
    for (let attempt = 0; attempt < 3 && await dataWindowTab.count() === 0; attempt += 1) {
      await toggle.click();
      try {
        await dataWindowTab.waitFor({ state: "visible", timeout: 2_000 });
      } catch {
        // TradingView sometimes ignores the first toggle while restoring a layout.
      }
    }
    await dataWindowTab.waitFor({ state: "visible", timeout: this.options.timeoutMs });
    await dataWindowTab.click();
    const chart = page.locator("canvas").last();
    const bounds = await chart.boundingBox();
    if (bounds !== null) {
      await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5);
      await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5);
    }
    await page.getByText("QP_BAR_TIME_S", { exact: true })
      .waitFor({ state: "visible", timeout: this.options.timeoutMs });
  }
}

export async function readDataWindowNumber(page: Page, label: string): Promise<number | null> {
  const locator = page.getByText(label, { exact: true }).last();
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  const valueText = await findRowValue(locator, label);
  return parseTradingViewNumber(valueText);
}

async function findRowValue(locator: Locator, label: string): Promise<string> {
  return locator.evaluate((element, expectedLabel) => {
    let row: Element | null = element;
    for (let depth = 0; depth < 6 && row !== null; depth += 1, row = row.parentElement) {
      const text = row.textContent?.trim() ?? "";
      if (!text.includes(expectedLabel)) continue;
      const pieces = Array.from(row.querySelectorAll("span,div"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter((piece) => piece.length > 0 && piece !== expectedLabel && !piece.includes(expectedLabel));
      const numeric = [...pieces].reverse().find((piece: string) => /(?:[-+−]?\d|n\/a|—|na)/i.test(piece));
      if (numeric !== undefined) return numeric;
      const remainder = text.replace(expectedLabel, "").trim();
      if (remainder.length > 0) return remainder;
    }
    throw new Error(`No value found beside ${expectedLabel}`);
  }, label);
}

export function parseTradingViewNumber(text: string): number | null {
  const normalized = text.trim().replace(/−/g, "-").replace(/,/g, "");
  if (/^(?:n\/?a|na|—|-|∅)$/i.test(normalized)) return null;
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i);
  if (match === null) throw new Error(`Invalid TradingView numeric value: ${text}`);
  const value = Number(match[0]);
  if (!Number.isFinite(value)) throw new Error(`Invalid TradingView numeric value: ${text}`);
  return value;
}

function secondsToOptionalMs(value: number | null): number | null {
  return value === null ? null : Math.round(value) * 1000;
}
