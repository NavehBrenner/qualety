import type { Plugin } from "qualety";
import { hashCoversEveryConfigField } from "./hash-covers-every-config-field.ts";
import { hashIncludesCodeVersion } from "./hash-includes-code-version.ts";
import { versionedHashPayload } from "./versioned-hash-payload.ts";

const plugin: Plugin = {
  name: "fingerprint",
  rules: {
    "hash-covers-every-config-field": hashCoversEveryConfigField,
    "versioned-hash-payload": versionedHashPayload,
    "hash-includes-code-version": hashIncludesCodeVersion,
  },
  configs: {
    recommended: {
      rules: {
        "fingerprint/hash-covers-every-config-field": "error",
        "fingerprint/versioned-hash-payload": "error",
        "fingerprint/hash-includes-code-version": "off",
      },
    },
  },
};

export default plugin;
export { plugin };
