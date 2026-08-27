import type { Plugin } from "qualety";
import { buildCodeEmbeddingsIndex } from "./code-embeddings.ts";
import { buildDupehoundIndex } from "./dupehound.ts";
import { noDuplicateCode } from "./no-duplicate-code.ts";
import { noDuplicatePython } from "./no-duplicate-python.ts";
import { noSemanticDuplicate } from "./no-semantic-duplicate.ts";

const plugin: Plugin = {
  name: "dry",
  provides: {
    dupehound: {
      build: (context) => buildDupehoundIndex(context),
    },
    "code-embeddings": {
      build: (context) => buildCodeEmbeddingsIndex(context),
    },
  },
  rules: {
    "no-duplicate-code": noDuplicateCode,
    "no-duplicate-python": noDuplicatePython,
    "no-semantic-duplicate": noSemanticDuplicate,
  },
  configs: {
    recommended: {
      rules: {
        "dry/no-duplicate-code": "error",
        "dry/no-duplicate-python": "error",
        "dry/no-semantic-duplicate": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
