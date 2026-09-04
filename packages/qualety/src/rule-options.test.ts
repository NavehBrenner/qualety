import { expect, test } from "vitest";
import { compileRuleOptions } from "./rule-options.ts";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    threshold: { type: "number", exclusiveMinimum: 0, maximum: 1 },
  },
};

test("number 1 is ok; 0 and >1 fail", () => {
  const compiled = compileRuleOptions(schema, "dry/no-semantic-duplicate");
  expect(compiled.safeParse({ threshold: 1 })).toEqual({
    success: true,
    data: { threshold: 1 },
  });
  expect(compiled.safeParse({ threshold: 0 }).success).toBe(false);
  expect(compiled.safeParse({ threshold: 1.1 }).success).toBe(false);
});

test("extra key with additionalProperties false fails", () => {
  const compiled = compileRuleOptions(schema, "dry/no-semantic-duplicate");
  expect(compiled.safeParse({ threshold: 0.9, extra: true }).success).toBe(false);
});

test("unsupported schema keyword fails closed", () => {
  expect(() => compileRuleOptions({ type: "boolean" }, "fixture/tuned")).toThrow(/fixture\/tuned/);
  expect(() => compileRuleOptions({ type: "boolean" }, "fixture/tuned")).toThrow(
    /unsupported meta\.schema/,
  );
});

test("string and string-array properties compile", () => {
  const compiled = compileRuleOptions(
    {
      type: "object",
      additionalProperties: false,
      properties: {
        writerName: { type: "string" },
        entryPoints: { type: "array", items: { type: "string" } },
      },
    },
    "ml/metadata-writer-required",
  );
  expect(compiled.safeParse({ writerName: "log_run" })).toEqual({
    success: true,
    data: { writerName: "log_run" },
  });
  expect(compiled.safeParse({ entryPoints: ["fit"] })).toEqual({
    success: true,
    data: { entryPoints: ["fit"] },
  });
  expect(compiled.safeParse({ writerName: 1 }).success).toBe(false);
  expect(compiled.safeParse({ extra: true }).success).toBe(false);
});
