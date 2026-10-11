import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Config } from "drizzle-kit";

const url = process.env.DATABASE_PATH ?? "data/movo.db";
// A fresh clone has no data/ folder, and SQLite won't create one.
mkdirSync(dirname(url), { recursive: true });

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url },
} satisfies Config;
