import { defineRule } from "qualety";
import { boundPayloadRule } from "./bind.ts";

const CODE_HINT =
  "Fold CODE_VERSION, GIT_SHA, or git_sha (or a codeVersionNames symbol) into the hash payload. Config-only fingerprints mean same knobs, not same data.";
const CODE_DEFAULTS = ["CODE_VERSION", "GIT_SHA", "git_sha"];

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
  create: boundPayloadRule({
    extraKey: "codeVersionNames",
    match: (name, extra) => CODE_DEFAULTS.includes(name) || extra.includes(name),
    message: (fq) => `Hash function "${fq}" does not fold a code version into the hash payload.`,
    suggestion: CODE_HINT,
  }),
});
