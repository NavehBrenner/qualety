import type { Plugin } from "qualety";
import { concreteSuggestion } from "./concrete-suggestion.ts";
import { coreProviderBoundaries } from "./core-provider-boundaries.ts";
import { docsExportHonesty } from "./docs-export-honesty.ts";
import { noFsInRules } from "./no-fs-in-rules.ts";
import { buildWorkspaceDocs } from "./workspace-docs.ts";

const plugin: Plugin = {
  name: "dev",
  provides: {
    "workspace-docs": {
      build: (context) => buildWorkspaceDocs(context),
    },
  },
  rules: {
    "concrete-suggestion": concreteSuggestion,
    "core-provider-boundaries": coreProviderBoundaries,
    "docs-export-honesty": docsExportHonesty,
    "no-fs-in-rules": noFsInRules,
  },
};

export default plugin;
export { plugin };
