import type { Config } from "drizzle-kit";

import { databasePath } from "./src/paths";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: databasePath },
  casing: "snake_case",
} satisfies Config;
