import type { Plugin } from "qualety";
import { buildDupehoundIndex } from "./dupehound.ts";
import { noDuplicateCode } from "./no-duplicate-code.ts";
import { noDuplicatePython } from "./no-duplicate-python.ts";

const plugin: Plugin = {
  name: "dry",
  provides: {
    dupehound: {
      build: (context) => buildDupehoundIndex(context),
    },
  },
  rules: {
    "no-duplicate-code": noDuplicateCode,
    "no-duplicate-python": noDuplicatePython,
  },
  configs: {
    recommended: {
      rules: {
        "dry/no-duplicate-code": "error",
        "dry/no-duplicate-python": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
