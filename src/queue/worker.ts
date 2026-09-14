import type { Db } from "../db/database.js";
import type { DesktopNotifier } from "../notify/desktop.js";
import type { SignalPayload } from "../signals/payload.js";
import { claimJob, completeJob, getJobSignal, retryJob } from "./repository.js";

type WorkerOptions = {
  pollIntervalMs: number;
  leaseSeconds: number;
  maxAttempts: number;
  desktopNotifier?: DesktopNotifier;
};

export function startWorker(db: Db, options: WorkerOptions) {
  let stopped = false;
  let lastPollAt = new Date();

  const run = async () => {
    while (!stopped) {
      lastPollAt = new Date();
      const job = claimJob(db, lastPollAt, options.leaseSeconds);
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
        continue;
      }

      try {
        if (job.job_type === "record_spike") {
          completeJob(db, job.id);
        } else if (job.job_type === "notify_local_alert") {
          const signal = getJobSignal(db, job.signal_id);
          if (signal === undefined) throw new Error(`signal not found: ${job.signal_id}`);
          if (options.desktopNotifier !== undefined) await sendDesktopNotification(signal.payload, options.desktopNotifier);
          completeJob(db, job.id);
        } else {
          throw new Error(`unknown job type: ${job.job_type}`);
        }
      } catch (error) {
        retryJob(db, job, error, options.maxAttempts);
      }
    }
  };

  const done = run();
  return {
    get lastPollAt() { return lastPollAt; },
    async stop() {
      stopped = true;
      await done;
    },
  };
}

async function sendDesktopNotification(rawPayload: string, notifier: DesktopNotifier): Promise<void> {
  let payload: SignalPayload;
  try {
    payload = JSON.parse(rawPayload) as SignalPayload;
  } catch {
    throw new Error("local alert signal payload is not valid JSON");
  }

  await notifier.send({
    title: `${payload.symbol} ${payload.event}`,
    body: `${payload.timeframe} close ${payload.price.toFixed(4)}`
      + ` | EMA ${payload.probe_ema?.toFixed(4) ?? "n/a"}`,
  });
}
