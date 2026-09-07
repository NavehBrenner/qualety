import { nameRange } from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  bindHashFunctions,
  missingConfigFields,
  parseExcludeFields,
  parseHashFunctions,
  reportUnbound,
} from "./bind.ts";

const COVER_HINT =
  "Read each missing field on the config object inside the hash function (or name it in excludeFields).";

export const hashCoversEveryConfigField = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A bound hash function must read every field of its config type, minus excludeFields.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        hashFunctions: { type: "array", items: { type: "string" } },
        excludeFields: { type: "object", additionalProperties: true },
      },
    },
  },
  create(context) {
    const names = parseHashFunctions(context.options);
    if (names.length === 0) {
      reportUnbound(context);
      return;
    }
    const python = context.getArtifact("python");
    const exclude = parseExcludeFields(context.options);
    for (const bound of bindHashFunctions(names, python.sources, context.getCwd())) {
      const missing = missingConfigFields(bound, python.sources, exclude);
      if (missing === undefined || missing.length === 0) {
        continue;
      }
      context.report({
        severity: "error",
        file: bound.unit.file,
        range: nameRange(bound.def),
        message: `Hash function "${bound.fq}" does not read config fields: ${missing.join(", ")}.`,
        suggestion: COVER_HINT,
      });
    }
  },
});
