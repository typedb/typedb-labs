import { defineConfig } from "vitest/config";

// The tests need a running TypeDB server (TYPEDB_ADDRESS, default 127.0.0.1:8004). global-setup.ts creates one
// seeded "vehicle-test-<random>" database for the run and deletes it afterwards.
export default defineConfig({
  test: {
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // the tests share one database and one TypeDB server: one file at a time keeps the load (and the logs) readable
    fileParallelism: false,
  },
});
