import type { Plugin } from "qualety";
import { noSpawnInCreate } from "./no-spawn-in-create.ts";
import { preferDefineRule } from "./prefer-define-rule.ts";

const plugin: Plugin = {
  name: "plugin-kit",
  rules: {
    "no-spawn-in-create": noSpawnInCreate,
    "prefer-define-rule": preferDefineRule,
  },
  configs: {
    recommended: {
      rules: {
        "plugin-kit/no-spawn-in-create": "error",
        "plugin-kit/prefer-define-rule": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
