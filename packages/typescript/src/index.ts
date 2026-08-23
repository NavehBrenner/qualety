import type { Plugin } from "qualety";
import { noDoubleValidation } from "./no-double-validation.ts";
import { publicExportsTested } from "./public-exports-tested.ts";
import { zodBoundary } from "./zod-boundary.ts";

const plugin: Plugin = {
  name: "ts",
  rules: {
    "no-double-validation": noDoubleValidation,
    "public-exports-tested": publicExportsTested,
    "zod-boundary": zodBoundary,
  },
  configs: {
    recommended: {
      rules: {
        "ts/no-double-validation": "error",
        "ts/public-exports-tested": "error",
        "ts/zod-boundary": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
