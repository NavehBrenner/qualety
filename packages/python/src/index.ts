import type { Plugin } from "qualety";
import { noUnnecessaryDef } from "./no-unnecessary-def.ts";
import { buildPythonProject } from "./python.ts";

const plugin: Plugin = {
  name: "python",
  provides: {
    python: {
      build: (context) => buildPythonProject(context),
    },
  },
  rules: {
    "no-unnecessary-def": noUnnecessaryDef,
  },
  configs: {
    recommended: {
      rules: {
        "python/no-unnecessary-def": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
