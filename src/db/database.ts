import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function migrate(db: Db): void {
  const migration = readFileSync(resolve("migrations/001_initial.sql"), "utf8");
  db.exec(migration);
}
