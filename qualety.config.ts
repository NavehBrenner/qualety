import { defineConfig } from "qualety";

export default defineConfig({
  plugins: ["@qualety/typescript", "@qualety/dev"],
  rules: {
    "dev/core-provider-boundaries": "error",
    "dev/docs-export-honesty": "error",
    "dev/no-fs-in-rules": "error",
    "dev/concrete-suggestion": "error",
    "ts/zod-boundary": "error",
    "ts/type-narrowing-checks": "error",
    "ts/no-constant-condition": "error",
    "ts/no-unnecessary-abstraction": "error",
  },
  exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
});
