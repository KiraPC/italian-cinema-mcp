import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "src");
const testRoot = resolve(here, "test");

export default defineConfig({
  resolve: {
    extensions: [".mts", ".ts", ".mjs", ".js", ".json", ".tsx"],
    alias: [
      {
        find: /^(\.\.\/)+src\/(.+?)(?:\.ts)?$/,
        replacement: `${srcRoot}/$2.ts`,
      },
      {
        find: /^(\.\.\/)([\w-]+)(?:\.ts)?$/,
        replacement: `${testRoot}/$2.ts`,
      },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
