import { defineConfig } from "eslint/config";

import { baseConfig } from "@pdash/eslint-config/base";
import { reactConfig } from "@pdash/eslint-config/react";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
  reactConfig,
);
