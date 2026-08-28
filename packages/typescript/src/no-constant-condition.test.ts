import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noConstantCondition } from "./no-constant-condition.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/no-constant-condition"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-constant-condition and recommended includes it", () => {
  expect(noConstantCondition).toBeDefined();
  expect(plugin.rules?.["no-constant-condition"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-constant-condition"]).toBe("error");
});

test("necessary guard, mixed sites, and first parse exit 0", async () => {
  const result = await runFixture("const-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("single parse exits 0", async () => {
  const result = await runFixture("double-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("param type implies guard exits 1", async () => {
  const result = await runFixture("const-bad-param");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-constant-condition/);
  expect(result.out).toMatch(/always true/);
  expect(result.out).toMatch(/param type/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("all same-file callers already narrowed exits 1", async () => {
  const result = await runFixture("const-bad-callers");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-constant-condition/);
  expect(result.out).toMatch(/call-site/);
  expect(result.out).toMatch(/Tighten the callee parameter type/);
});

test("if (true) exits 1", async () => {
  const result = await runFixture("const-bad-literal");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-constant-condition/);
  expect(result.out).toMatch(/literal constant/);
});

test("mixed sites report unused caller guard", async () => {
  const result = await runFixture("const-bad-mixed-caller");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-constant-condition/);
  expect(result.out).toMatch(/redundant given the subsequent call/);
  expect(result.out).toMatch(/Remove this guard/);
  expect(result.out).not.toMatch(/always true here given call-site narrowing/);
});

test("same-function restated guard exits 1", async () => {
  const result = await runFixture("const-bad-prior");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-constant-condition/);
  expect(result.out).toMatch(/prior guard/);
});

test("parse plus isRecord on the original value exits 1", async () => {
  const result = await runFixture("double-isrecord");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-constant-condition/);
  expect(result.out).toMatch(/prior parse/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("second schema parse of the same input exits 1", async () => {
  const result = await runFixture("double-reparse");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-constant-condition/);
  expect(result.out).toMatch(/prior parse/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});
