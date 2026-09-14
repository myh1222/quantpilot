import type { AppConfig } from "../config.js";
import type { Db } from "../db/database.js";
import { evaluateEmaCross, type MarketBar } from "./rule.js";
import type { MarketProvider } from "./provider.js";
import {
  getLocalAlertState,
  persistEvaluationSuccess,
  persistProviderFailure,
} from "./state.js";

export type LocalAlertsConfig = NonNullable<AppConfig["localAlerts"]>;
export type SymbolOutcome = {
  symbol: string;
  status: string;
  signalCount: number;
};

const minimumHistoryBars = 200;

export async function pollLocalAlertsOnce(
  db: Db,
  config: LocalAlertsConfig,
  provider: MarketProvider,
  now = new Date(),
): Promise<SymbolOutcome[]> {
  const outcomes: SymbolOutcome[] = [];
  const timeframe = `${config.timeframeMinutes}m`;

  for (const symbolConfig of config.symbols) {
    try {
      const key = {
        symbol: symbolConfig.symbol,
        timeframe,
        provider: provider.name,
      };
      const state = getLocalAlertState(db, key);
      const lookbackBars = Math.max(minimumHistoryBars, config.emaLength * 3);
      const startMs = now.getTime() - lookbackBars * config.timeframeMinutes * 60_000;
      const bars = await provider.fetchBars({
        providerSymbol: symbolConfig.providerSymbol,
        timeframeMinutes: config.timeframeMinutes,
        startMs,
        endMs: now.getTime(),
      });
      const confirmedBars = confirmedOnly(bars, config.timeframeMinutes, config.confirmationLagSeconds, now);
      const result = evaluateEmaCross(confirmedBars, state, {
        symbol: symbolConfig.symbol,
        timeframe,
        emaLength: config.emaLength,
        pineConfigVersion: config.pineConfigVersion,
        alertInstanceId: config.alertInstanceId,
      });

      persistEvaluationSuccess(db, {
        key,
        providerSymbol: symbolConfig.providerSymbol,
        pineConfigVersion: config.pineConfigVersion,
        alertInstanceId: config.alertInstanceId,
        runId: config.runId,
        result,
        now,
      });
      outcomes.push({
        symbol: symbolConfig.symbol,
        status: result.status,
        signalCount: result.signals.length,
      });
    } catch (error) {
      persistProviderFailure(
        db,
        { symbol: symbolConfig.symbol, timeframe, provider: provider.name },
        symbolConfig.providerSymbol,
        error,
        now,
      );
      outcomes.push({
        symbol: symbolConfig.symbol,
        status: "provider_error",
        signalCount: 0,
      });
    }
  }

  return outcomes;
}

export function startLocalAlertPoller(
  db: Db,
  config: LocalAlertsConfig,
  provider: MarketProvider,
  onError: (error: unknown) => void,
) {
  let stopped = false;

  const run = async () => {
    while (!stopped) {
      try {
        await pollLocalAlertsOnce(db, config, provider);
      } catch (error) {
        // A SQLite failure is process-level and must not terminate the poller.
        onError(error);
      }
      await sleep(config.pollIntervalMs, () => stopped);
    }
  };

  const done = run();
  return {
    async stop() {
      stopped = true;
      await done;
    },
  };
}

function confirmedOnly(
  bars: MarketBar[],
  timeframeMinutes: number,
  confirmationLagSeconds: number,
  now: Date,
): MarketBar[] {
  const cutoff = now.getTime() - confirmationLagSeconds * 1000;
  return bars.filter(
    (bar) => bar.openTimeMs + timeframeMinutes * 60_000 <= cutoff,
  );
}

function sleep(ms: number, isStopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (isStopped()) {
      clearTimeout(timer);
      resolve();
    }
  });
}
