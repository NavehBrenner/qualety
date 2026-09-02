import { nodeRange } from "@qualety/python/walk";
import { defineRule } from "qualety";
import { parseEntryPoints } from "./ast.ts";
import {
  collectGateSites,
  collectPayload,
  hasCodeVersion,
  parseWriterName,
  resolveWriter,
  versionHint,
} from "./provenance.ts";

export const recordCodeVersion = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "The metadata writer payload must include a code version so the run record pins code.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        writerName: { type: "string" },
        entryPoints: { type: "array", items: { type: "string" } },
      },
    },
  },
  create(context) {
    const writerName = parseWriterName(context.options);
    const python = context.getArtifact("python");
    const hint = versionHint();
    for (const site of collectGateSites(
      python.sources,
      context.getCwd(),
      parseEntryPoints(context.options),
    )) {
      const writer = resolveWriter(site.unit, writerName, python.sources);
      if (writer === undefined) {
        continue;
      }
      const payload = collectPayload(writer.def, site.scope, writerName);
      if (hasCodeVersion(payload) || !payload.proven) {
        continue;
      }
      context.report({
        severity: "error",
        file: site.unit.file,
        range: nodeRange(site.node),
        message: `Metadata writer "${writerName}" does not record a code version.`,
        suggestion: hint,
      });
    }
  },
});
