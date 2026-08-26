import { defineConfig } from "qualety";

export default defineConfig({
  plugins: ["@qualety/typescript", "@qualety/dry", "@qualety/dev", "@qualety/plugin-kit"],
  rules: {
    "dev/core-provider-boundaries": "error",
    "dev/docs-export-honesty": "error",
    "dev/no-fs-in-rules": "error",
    "dev/concrete-suggestion": "error",
    "ts/public-exports-tested": "error",
    "ts/zod-boundary": "error",
    "ts/type-narrowing-checks": "error",
    "ts/no-constant-condition": "error",
    "ts/no-unnecessary-abstraction": "error",
    "dry/no-duplicate-functions": "error",
    "plugin-kit/no-spawn-in-create": "error",
    "plugin-kit/prefer-define-rule": "error",
  },
  exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
});
