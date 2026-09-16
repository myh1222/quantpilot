import { mkdirSync, readFileSync, readdirSync } from "node:fs";
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
  const directory = resolve("migrations");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE filename = ?").get(file);
    if (applied !== undefined) continue;
    db.transaction(() => {
      db.exec(readFileSync(resolve(directory, file), "utf8"));
      db.prepare("INSERT INTO schema_migrations(filename, applied_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
    })();
  }
}
