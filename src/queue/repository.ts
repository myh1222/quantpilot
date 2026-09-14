import type { Db } from "../db/database.js";

export type Job = {
  id: number;
  signal_id: number;
  job_type: string;
  attempts: number;
};

export function claimJob(db: Db, now: Date, leaseSeconds: number): Job | undefined {
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();

  return db.transaction(() => db.prepare(`
    UPDATE jobs
    SET status = 'running',
        attempts = attempts + 1,
        locked_at = ?,
        locked_until = ?,
        updated_at = ?
    WHERE id = (
      SELECT id FROM jobs
      WHERE status IN ('pending', 'retry', 'running')
        AND next_retry_at <= ?
        AND (locked_until IS NULL OR locked_until < ?)
      ORDER BY next_retry_at, id
      LIMIT 1
    )
    RETURNING id, signal_id, job_type, attempts
  `).get(nowIso, leaseUntil, nowIso, nowIso, nowIso) as Job | undefined)();
}

export function getJobSignal(db: Db, signalId: number): { payload: string } | undefined {
  return db.prepare("SELECT payload FROM signals WHERE id = ?")
    .get(signalId) as { payload: string } | undefined;
}

export function completeJob(db: Db, jobId: number, now = new Date()): void {
  db.prepare(`
    UPDATE jobs SET status = 'completed', locked_at = NULL, locked_until = NULL,
      updated_at = ? WHERE id = ?
  `).run(now.toISOString(), jobId);
}

export function retryJob(
  db: Db,
  job: Job,
  error: unknown,
  maxAttempts: number,
  now = new Date(),
): void {
  const dead = job.attempts >= maxAttempts;
  const backoffMs = Math.min(60_000, 1000 * 2 ** Math.max(0, job.attempts - 1));
  const nextRetry = new Date(now.getTime() + backoffMs).toISOString();
  db.prepare(`
    UPDATE jobs SET status = ?, next_retry_at = ?, locked_at = NULL,
      locked_until = NULL, last_error = ?, updated_at = ? WHERE id = ?
  `).run(
    dead ? "dead_letter" : "retry",
    nextRetry,
    error instanceof Error ? error.message : String(error),
    now.toISOString(),
    job.id,
  );
}
