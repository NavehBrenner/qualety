import type { Plugin } from "qualety";
import { noBareExcept } from "./no-bare-except.ts";
import { noMutableDefault } from "./no-mutable-default.ts";
import { noOpenWithoutWith } from "./no-open-without-with.ts";
import { noPublicAny } from "./no-public-any.ts";
import { noSilentExcept } from "./no-silent-except.ts";
import { noSysPathHack } from "./no-sys-path-hack.ts";
import { noUnnecessaryClass } from "./no-unnecessary-class.ts";
import { noUnnecessaryDef } from "./no-unnecessary-def.ts";
import { publicExportsTested } from "./public-exports-tested.ts";
import { buildPythonProject } from "./python.ts";
import { requireTypedPublic } from "./require-typed-public.ts";

const plugin: Plugin = {
  name: "python",
  provides: {
    python: {
      build: (context) => buildPythonProject(context),
    },
  },
  rules: {
    "no-unnecessary-def": noUnnecessaryDef,
    "no-unnecessary-class": noUnnecessaryClass,
    "public-exports-tested": publicExportsTested,
    "no-mutable-default": noMutableDefault,
    "require-typed-public": requireTypedPublic,
    "no-bare-except": noBareExcept,
    "no-silent-except": noSilentExcept,
    "no-open-without-with": noOpenWithoutWith,
    "no-sys-path-hack": noSysPathHack,
    "no-public-any": noPublicAny,
  },
  configs: {
    recommended: {
      rules: {
        "python/no-unnecessary-def": "error",
        "python/no-unnecessary-class": "error",
        "python/public-exports-tested": "error",
        "python/no-mutable-default": "error",
        "python/require-typed-public": "error",
        "python/no-bare-except": "error",
        "python/no-silent-except": "error",
        "python/no-open-without-with": "error",
        "python/no-sys-path-hack": "error",
        "python/no-public-any": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
