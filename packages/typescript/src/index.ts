import type { Plugin } from "qualety";
import { noConstantCondition } from "./no-constant-condition.ts";
import { publicExportsTested } from "./public-exports-tested.ts";
import { typeNarrowingChecks } from "./type-narrowing-checks.ts";
import { zodBoundary } from "./zod-boundary.ts";

const plugin: Plugin = {
  name: "ts",
  rules: {
    "no-constant-condition": noConstantCondition,
    "public-exports-tested": publicExportsTested,
    "type-narrowing-checks": typeNarrowingChecks,
    "zod-boundary": zodBoundary,
  },
  configs: {
    recommended: {
      rules: {
        "ts/no-constant-condition": "error",
        "ts/public-exports-tested": "error",
        "ts/type-narrowing-checks": "error",
        "ts/zod-boundary": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
