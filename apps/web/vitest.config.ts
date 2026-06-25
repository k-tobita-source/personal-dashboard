import { defineConfig } from "vitest/config";

// 純関数のユニットテストのみを対象とする最小構成（DOM/React は対象外）。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
