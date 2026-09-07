import { nameRange } from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  bindHashFunctions,
  hasVersionInPayload,
  parseHashFunctions,
  parseStringList,
  reportUnbound,
} from "./bind.ts";

const VERSION_HINT =
  "Fold a schema_version / *_VERSION constant (or a versionKeys name) into the hash input.";

export const versionedHashPayload = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A bound hash function must fold an explicit version contribution into the hash payload.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        hashFunctions: { type: "array", items: { type: "string" } },
        versionKeys: { type: "array", items: { type: "string" } },
      },
    },
  },
  create(context) {
    const names = parseHashFunctions(context.options);
    if (names.length === 0) {
      reportUnbound(context);
      return;
    }
    const extra = parseStringList(context.options, "versionKeys");
    const python = context.getArtifact("python");
    for (const bound of bindHashFunctions(names, python.sources, context.getCwd())) {
      if (hasVersionInPayload(bound, extra)) {
        continue;
      }
      context.report({
        severity: "error",
        file: bound.unit.file,
        range: nameRange(bound.def),
        message: `Hash function "${bound.fq}" does not fold a version contribution into the hash payload.`,
        suggestion: VERSION_HINT,
      });
    }
  },
});
