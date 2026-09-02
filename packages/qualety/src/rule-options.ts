import { z } from "zod";
import { ConfigError } from "./config.ts";
import type { JSONSchema } from "./index.ts";
import { isRecord } from "./record.ts";

const OBJECT_KEYS = new Set(["type", "properties", "required", "additionalProperties"]);
const NUMBER_KEYS = new Set(["type", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]);
const STRING_KEYS = new Set(["type"]);
const ARRAY_KEYS = new Set(["type", "items"]);

export function compileRuleOptions(schema: unknown, ruleId: string): z.ZodType {
  const record = requireRecord(schema, ruleId);
  if (record.type === "object") {
    return compileObject(record, ruleId);
  }
  if (record.type === "number") {
    return compileNumber(record, ruleId);
  }
  if (record.type === "string") {
    return compileString(record, ruleId);
  }
  if (record.type === "array") {
    return compileStringArray(record, ruleId);
  }
  throw unsupportedSchema(ruleId, typeof record.type === "string" ? record.type : "type");
}

function compileObject(schema: JSONSchema, ruleId: string): z.ZodType {
  rejectUnknownKeys(schema, OBJECT_KEYS, ruleId);
  const requiredRaw = schema.required;
  const required = new Set<string>();
  if (requiredRaw !== undefined) {
    if (!Array.isArray(requiredRaw) || requiredRaw.some((item) => typeof item !== "string")) {
      throw unsupportedSchema(ruleId, "required");
    }
    for (const key of requiredRaw) {
      required.add(key);
    }
  }
  const propertiesRaw = schema.properties;
  const properties = propertiesRaw === undefined ? {} : requireRecord(propertiesRaw, ruleId);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(properties)) {
    const compiled = compileRuleOptions(prop, ruleId);
    shape[key] = required.has(key) ? compiled : compiled.optional();
  }
  const extra = schema.additionalProperties;
  if (extra === false) {
    return z.object(shape).strict();
  }
  if (extra === true || extra === undefined) {
    return z.object(shape).passthrough();
  }
  throw unsupportedSchema(ruleId, "additionalProperties");
}

function compileString(schema: JSONSchema, ruleId: string): z.ZodType {
  rejectUnknownKeys(schema, STRING_KEYS, ruleId);
  return z.string();
}

function compileStringArray(schema: JSONSchema, ruleId: string): z.ZodType {
  rejectUnknownKeys(schema, ARRAY_KEYS, ruleId);
  const items = schema.items;
  if (!isRecord(items) || items.type !== "string") {
    throw unsupportedSchema(ruleId, "items");
  }
  rejectUnknownKeys(items, STRING_KEYS, ruleId);
  return z.array(z.string());
}

function compileNumber(schema: JSONSchema, ruleId: string): z.ZodType {
  rejectUnknownKeys(schema, NUMBER_KEYS, ruleId);
  let number = z.number();
  number = applyBound(number, schema.minimum, "minimum", (n, v) => n.min(v), ruleId);
  number = applyBound(number, schema.maximum, "maximum", (n, v) => n.max(v), ruleId);
  number = applyBound(
    number,
    schema.exclusiveMinimum,
    "exclusiveMinimum",
    (n, v) => n.gt(v),
    ruleId,
  );
  number = applyBound(
    number,
    schema.exclusiveMaximum,
    "exclusiveMaximum",
    (n, v) => n.lt(v),
    ruleId,
  );
  return number;
}

function applyBound(
  number: z.ZodNumber,
  bound: unknown,
  keyword: string,
  apply: (number: z.ZodNumber, value: number) => z.ZodNumber,
  ruleId: string,
): z.ZodNumber {
  if (typeof bound === "number") {
    return apply(number, bound);
  }
  if (typeof bound !== "undefined") {
    throw unsupportedSchema(ruleId, keyword);
  }
  return number;
}

function requireRecord(value: unknown, ruleId: string): JSONSchema {
  if (!isRecord(value)) {
    throw unsupportedSchema(ruleId, "schema");
  }
  return value;
}

function rejectUnknownKeys(schema: JSONSchema, allowed: Set<string>, ruleId: string): void {
  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) {
      throw unsupportedSchema(ruleId, key);
    }
  }
}

function unsupportedSchema(ruleId: string, keyword: string): ConfigError {
  return new ConfigError(`Rule "${ruleId}" has unsupported meta.schema (${keyword}).`);
}
