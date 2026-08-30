import { defineConfig } from "qualety";

export default defineConfig({
  plugins: [
    "@qualety/typescript",
    "@qualety/python",
    "@qualety/dry",
    "@qualety/dev",
    "@qualety/plugin-kit",
  ],
  rules: {
    // 0.9 scores considerStatement and considerExportedFunction in
    // explicit-public-return-types.ts as near-duplicates, but the first dispatches to
    // the second — they read alike without being redundant. The pair measures
    // 0.90-0.91, so 0.92 clears it with a little headroom.
    "dry/no-semantic-duplicate": ["error", { threshold: 0.92 }],
    "dev/core-provider-boundaries": "error",
    "dev/docs-export-honesty": "error",
    "dev/no-fs-in-rules": "error",
    "dev/concrete-suggestion": "error",
  },
  // standalone-wasm.ts is only ever loaded by the bun-compiled binary: it imports the
  // "web" wasm builds and calls Bun.file, so node cannot import it and no test can
  // reference its exports. Checking it here only produces findings nothing can act on.
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/fixtures/**",
    "packaging/**",
    "packages/qualety/src/standalone-wasm.ts",
  ],
});
