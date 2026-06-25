import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@pdash/eslint-config/base";
import { nextjsConfig } from "@pdash/eslint-config/nextjs";
import { reactConfig } from "@pdash/eslint-config/react";

export default defineConfig(
  {
    ignores: [".next/**"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);
