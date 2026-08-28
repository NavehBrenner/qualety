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
    "dev/core-provider-boundaries": "error",
    "dev/docs-export-honesty": "error",
    "dev/no-fs-in-rules": "error",
    "dev/concrete-suggestion": "error",
    "ts/public-exports-tested": "error",
    "ts/zod-boundary": "error",
    "ts/type-narrowing-checks": "error",
    "ts/no-constant-condition": "error",
    "ts/no-unnecessary-abstraction": "error",
    "python/no-unnecessary-def": "error",
    "python/no-unnecessary-class": "error",
    "python/public-exports-tested": "error",
    "python/no-mutable-default": "error",
    "python/require-typed-public": "error",
    "dry/no-duplicate-code": "error",
    "dry/no-duplicate-python": "error",
    "plugin-kit/no-spawn-in-create": "error",
    "plugin-kit/prefer-define-rule": "error",
  },
  exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**", "packaging/**"],
});
