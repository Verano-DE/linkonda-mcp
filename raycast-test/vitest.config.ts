import { defineConfig } from "vitest/config";

// The tests import the extension's sources from ../raycast/src. "@raycast/api" and "@raycast/utils" are mocked by name
// in the tests that load the command (@raycast/api ships types only, no runtime entry to load).
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
