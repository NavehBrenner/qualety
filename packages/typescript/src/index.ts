import type { Plugin } from "qualety";
import { noConstantCondition } from "./no-constant-condition.ts";
import { noEmptyCatch } from "./no-empty-catch.ts";
import { noFloatingPromises } from "./no-floating-promises.ts";
import { noPublicAny } from "./no-public-any.ts";
import { noUnnecessaryAbstraction } from "./no-unnecessary-abstraction.ts";
import { noUnsafeAssertion } from "./no-unsafe-assertion.ts";
import { publicExportsTested } from "./public-exports-tested.ts";
import { typeNarrowingChecks } from "./type-narrowing-checks.ts";
import { zodBoundary } from "./zod-boundary.ts";

const plugin: Plugin = {
  name: "ts",
  rules: {
    "no-constant-condition": noConstantCondition,
    "no-empty-catch": noEmptyCatch,
    "no-floating-promises": noFloatingPromises,
    "no-public-any": noPublicAny,
    "no-unnecessary-abstraction": noUnnecessaryAbstraction,
    "no-unsafe-assertion": noUnsafeAssertion,
    "public-exports-tested": publicExportsTested,
    "type-narrowing-checks": typeNarrowingChecks,
    "zod-boundary": zodBoundary,
  },
  configs: {
    recommended: {
      rules: {
        "ts/no-constant-condition": "error",
        "ts/no-empty-catch": "error",
        "ts/no-floating-promises": "error",
        "ts/no-public-any": "error",
        "ts/no-unnecessary-abstraction": "error",
        "ts/no-unsafe-assertion": "error",
        "ts/public-exports-tested": "error",
        "ts/type-narrowing-checks": "error",
        "ts/zod-boundary": "error",
      },
    },
  },
  biome: {
    rules: {
      "nursery/noUnsafeTypeAssertion": "error",
      "complexity/noExcessiveCognitiveComplexity": ["error", { maxAllowedComplexity: 15 }],
    },
  },
};

export default plugin;
export { plugin };
