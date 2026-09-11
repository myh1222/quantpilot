import type { Db } from "../db/database.js";
import { claimJob, completeJob, retryJob } from "./repository.js";

type WorkerOptions = {
  pollIntervalMs: number;
  leaseSeconds: number;
  maxAttempts: number;
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
        if (job.job_type !== "record_spike") throw new Error(`unknown job type: ${job.job_type}`);
        completeJob(db, job.id);
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
