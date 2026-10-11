import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_PATH ?? "data/movo.db";

/**
 * Next dev reloads modules on every edit; without this the process would open
 * a new SQLite handle per reload and exhaust them.
 */
const globalForDb = globalThis as unknown as { __movoDb?: Database.Database };

function open() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

export const sqlite = globalForDb.__movoDb ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__movoDb = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema };
