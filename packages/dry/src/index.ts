import type { Plugin } from "qualety";
import { buildDupehoundIndex } from "./dupehound.ts";
import { noDuplicateCode } from "./no-duplicate-code.ts";

const plugin: Plugin = {
  name: "dry",
  provides: {
    dupehound: {
      build: (context) => buildDupehoundIndex(context),
    },
  },
  rules: {
    "no-duplicate-code": noDuplicateCode,
  },
  configs: {
    recommended: {
      rules: {
        "dry/no-duplicate-code": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
