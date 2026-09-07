import { defineRule } from "qualety";
import { boundPayloadRule } from "./bind.ts";

const VERSION_HINT =
  "Fold a schema_version / *_VERSION constant (or a versionKeys name) into the hash input.";
const VERSION_RE = /(schema_)?version|_VERSION$/i;

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
  create: boundPayloadRule({
    extraKey: "versionKeys",
    match: (name, extra) => extra.includes(name) || VERSION_RE.test(name),
    message: (fq) =>
      `Hash function "${fq}" does not fold a version contribution into the hash payload.`,
    suggestion: VERSION_HINT,
  }),
});
