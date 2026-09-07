import { nameRange } from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  bindHashFunctions,
  hasCodeVersion,
  parseHashFunctions,
  parseStringList,
  reportUnbound,
} from "./bind.ts";

const CODE_HINT =
  "Fold CODE_VERSION, GIT_SHA, or git_sha (or a codeVersionNames symbol) into the hash payload. Config-only fingerprints mean same knobs, not same data.";

export const hashIncludesCodeVersion = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A bound hash function must fold an allowlisted code-version symbol into the hash payload.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        hashFunctions: { type: "array", items: { type: "string" } },
        codeVersionNames: { type: "array", items: { type: "string" } },
      },
    },
  },
  create(context) {
    const names = parseHashFunctions(context.options);
    if (names.length === 0) {
      reportUnbound(context);
      return;
    }
    const extra = parseStringList(context.options, "codeVersionNames");
    const python = context.getArtifact("python");
    for (const bound of bindHashFunctions(names, python.sources, context.getCwd())) {
      if (hasCodeVersion(bound, extra)) {
        continue;
      }
      context.report({
        severity: "error",
        file: bound.unit.file,
        range: nameRange(bound.def),
        message: `Hash function "${bound.fq}" does not fold a code version into the hash payload.`,
        suggestion: CODE_HINT,
      });
    }
  },
});
