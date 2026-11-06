// Tests run against a real TypeDB server (TYPEDB_ADDRESS, default 127.0.0.1:8003) on throwaway
// apex-test-* databases only; one seeded database is shared by the tests that only read.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
