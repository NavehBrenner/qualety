import { nodeRange } from "@qualety/python/walk";
import { defineRule } from "qualety";
import { parseEntryPoints } from "./ast.ts";
import {
  bodyWrites,
  collectGateSites,
  parseWriterName,
  reachableNames,
  resolveWriter,
} from "./provenance.ts";

export const metadataWriterRequired = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Every training entry and artifact save path must call a metadata writer that writes the run record.",
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
    const hint = `Define ${writerName} that writes the run record, and call it from the training entry / save path.`;
    for (const site of collectGateSites(
      python.sources,
      context.getCwd(),
      parseEntryPoints(context.options),
    )) {
      const writer = resolveWriter(site.unit, writerName, python.sources);
      if (writer === undefined) {
        context.report({
          severity: "error",
          file: site.unit.file,
          range: nodeRange(site.node),
          message: `No metadata writer "${writerName}" is defined or imported.`,
          suggestion: hint,
        });
        continue;
      }
      if (!bodyWrites(writer.def)) {
        context.report({
          severity: "error",
          file: site.unit.file,
          range: nodeRange(site.node),
          message: `Metadata writer "${writerName}" does not write a run record.`,
          suggestion: hint,
        });
        continue;
      }
      if (!reachableNames(site.scope, site.unit.tree).has(writerName)) {
        context.report({
          severity: "error",
          file: site.unit.file,
          range: nodeRange(site.node),
          message: `Metadata writer "${writerName}" is not called from the training entry / save path.`,
          suggestion: hint,
        });
      }
    }
  },
});
