import { nodeRange } from "@qualety/python/walk";
import { defineRule } from "qualety";
import { parseEntryPoints } from "./ast.ts";
import {
  collectGateSites,
  collectPayload,
  parseWriterName,
  requiredMetadataNames,
  resolveWriter,
} from "./provenance.ts";

export const runMetadataCompleteness = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Every CLI/config input that affects the run must reach the metadata writer payload.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        writerName: { type: "string" },
        entryPoints: { type: "array", items: { type: "string" } },
        allowExclusions: { type: "array", items: { type: "string" } },
      },
    },
  },
  create(context) {
    const writerName = parseWriterName(context.options);
    const options = context.options;
    const rawAllow =
      typeof options === "object" && options !== null && "allowExclusions" in options
        ? options.allowExclusions
        : undefined;
    const excluded = new Set(
      Array.isArray(rawAllow)
        ? rawAllow.filter((item): item is string => typeof item === "string")
        : [],
    );
    const python = context.getArtifact("python");
    const hint = `Pass the missing dest/field into ${writerName} or add it to allowExclusions if it does not affect results.`;
    for (const site of collectGateSites(
      python.sources,
      context.getCwd(),
      parseEntryPoints(context.options),
    )) {
      const writer = resolveWriter(site.unit, writerName, python.sources);
      if (writer === undefined) {
        continue;
      }
      const required = requiredMetadataNames(site.unit, site.scope);
      const payload = collectPayload(writer.def, site.scope, writerName);
      if (required.size === 0 || !payload.proven) {
        continue;
      }
      const missing = [...required].filter(
        (name) => !excluded.has(name) && !payload.keys.has(name),
      );
      if (missing.length === 0) {
        continue;
      }
      context.report({
        severity: "error",
        file: site.unit.file,
        range: nodeRange(site.node),
        message: `Run metadata is missing ${missing.map((name) => `"${name}"`).join(", ")}.`,
        suggestion: hint,
      });
    }
  },
});
