import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-double-validation and recommended includes it", () => {
  expect(plugin.rules?.["no-double-validation"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-double-validation"]).toBe("error");
});

test("single parse exits 0", async () => {
  const result = await runFixture("double-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("parse plus isRecord on the original value exits 1", async () => {
  const result = await runFixture("double-isrecord");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-double-validation/);
  expect(result.out).toMatch(/hand type-guard/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("second schema parse of the same input exits 1", async () => {
  const result = await runFixture("double-reparse");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-double-validation/);
  expect(result.out).toMatch(/parsed more than once/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});
