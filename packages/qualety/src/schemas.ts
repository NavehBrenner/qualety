import { z } from "zod";

export const requiresSchema = z.array(z.string().min(1));

export const ruleMetaSchema = z.object({
  docs: z.object({
    description: z.string().min(1),
    url: z.string().optional(),
  }),
  requires: requiresSchema.optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  fixable: z.enum(["code", "whitespace"]).optional(),
});

export const functionSchema = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === "function",
);

export const ruleSchema = z.object({
  meta: ruleMetaSchema,
  create: functionSchema,
});

export const artifactProviderSchema = z.object({
  build: functionSchema,
});

export const pluginProvidesSchema = z.record(z.string().min(1), artifactProviderSchema);

export const biomeRuleIdSchema = z
  .string()
  .regex(/^[^/]+\/[^/]+$/, "Biome rule id must be group/name");

export const biomeRuleSettingSchema = z.union([
  z.enum(["off", "warn", "error"]),
  z.tuple([z.enum(["off", "warn", "error"]), z.record(z.string(), z.unknown())]),
]);

export const biomeRulesSchema = z.record(biomeRuleIdSchema, biomeRuleSettingSchema);

export const pluginBiomeSchema = z
  .object({
    rules: biomeRulesSchema.optional(),
  })
  .strict();

export const userBiomeSchema = z
  .object({
    rules: biomeRulesSchema.optional(),
    format: z.boolean().optional(),
  })
  .strict();

export const pluginSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  rules: z.record(z.string().min(1), ruleSchema).optional(),
  provides: pluginProvidesSchema.optional(),
  configs: z.object({ recommended: z.unknown().optional() }).optional(),
  biome: pluginBiomeSchema.optional(),
});
