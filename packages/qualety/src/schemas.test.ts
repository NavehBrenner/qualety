import { expect, test } from "vitest";
import { DEFAULT_PROVIDERS } from "./default-providers.ts";
import { defineRule } from "./define-rule.ts";
import { isRecord } from "./record.ts";
import {
  artifactProviderSchema,
  functionSchema,
  pluginProvidesSchema,
  pluginSchema,
  requiresSchema,
  ruleMetaSchema,
  ruleSchema,
  userBiomeSchema,
} from "./schemas.ts";
import { createTypeScriptProvider } from "./typescript-frontend.ts";

test("core helpers and schemas are exported", () => {
  expect(isRecord({})).toBe(true);
  expect(DEFAULT_PROVIDERS.typescript).toBeDefined();
  expect(functionSchema).toBeDefined();
  expect(pluginProvidesSchema).toBeDefined();
  expect(requiresSchema).toBeDefined();
  expect(ruleMetaSchema).toBeDefined();
  expect(ruleSchema).toBeDefined();
  expect(userBiomeSchema.safeParse({ format: true }).success).toBe(true);
  expect(userBiomeSchema.safeParse({ files: [] }).success).toBe(false);
});

test("pluginSchema accepts a ruleless provider module", () => {
  const parsed = pluginSchema.safeParse({
    name: "shared",
    provides: {
      graph: {
        build() {
          return 1;
        },
      },
    },
  });
  expect(parsed.success).toBe(true);
});

test("pluginSchema rejects an empty name", () => {
  expect(pluginSchema.safeParse({ name: "" }).success).toBe(false);
});

test("pluginSchema rejects an empty require id", () => {
  const parsed = pluginSchema.safeParse({
    name: "fixture",
    rules: {
      ping: defineRule({
        meta: { requires: [""], docs: { description: "bad requires" } },
        create() {},
      }),
    },
  });
  expect(parsed.success).toBe(false);
});

test("pluginSchema rejects a provider without build", () => {
  const parsed = pluginSchema.safeParse({
    name: "fixture",
    provides: { fake: {} },
  });
  expect(parsed.success).toBe(false);
});

test("default typescript provider satisfies artifactProviderSchema", () => {
  expect(artifactProviderSchema.safeParse(createTypeScriptProvider()).success).toBe(true);
});
