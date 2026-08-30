import type { Plugin } from "qualety";
import { exhaustiveSwitch } from "./exhaustive-switch.ts";
import { explicitPublicReturnTypes } from "./explicit-public-return-types.ts";
import { noConstantCondition } from "./no-constant-condition.ts";
import { noEmptyCatch } from "./no-empty-catch.ts";
import { noExportStar } from "./no-export-star.ts";
import { noFloatingPromises } from "./no-floating-promises.ts";
import { noMisusedPromises } from "./no-misused-promises.ts";
import { noNonNullAssertion } from "./no-non-null-assertion.ts";
import { noPublicAny } from "./no-public-any.ts";
import { noUnnecessaryAbstraction } from "./no-unnecessary-abstraction.ts";
import { noUnsafeAssertion } from "./no-unsafe-assertion.ts";
import { publicExportsTested } from "./public-exports-tested.ts";
import { typeNarrowingChecks } from "./type-narrowing-checks.ts";
import { zodBoundary } from "./zod-boundary.ts";

const plugin: Plugin = {
  name: "ts",
  rules: {
    "exhaustive-switch": exhaustiveSwitch,
    "explicit-public-return-types": explicitPublicReturnTypes,
    "no-constant-condition": noConstantCondition,
    "no-empty-catch": noEmptyCatch,
    "no-export-star": noExportStar,
    "no-floating-promises": noFloatingPromises,
    "no-misused-promises": noMisusedPromises,
    "no-non-null-assertion": noNonNullAssertion,
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
        "ts/exhaustive-switch": "error",
        "ts/explicit-public-return-types": "error",
        "ts/no-constant-condition": "error",
        "ts/no-empty-catch": "error",
        "ts/no-export-star": "error",
        "ts/no-floating-promises": "error",
        "ts/no-misused-promises": "error",
        "ts/no-non-null-assertion": "error",
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
