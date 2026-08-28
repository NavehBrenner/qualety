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
  },
  exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**", "packaging/**"],
});
