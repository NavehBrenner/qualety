import { expect, test } from "vitest";
import { artifactProviderSchema, pluginSchema } from "./schemas.ts";
import { createTypeScriptProvider } from "./typescript-frontend.ts";

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
      ping: {
        meta: { requires: [""], docs: { description: "bad requires" } },
        create() {},
      },
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
