import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";

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

test("concrete suggestion is valid", async () => {
  const result = await runFixture("suggestion-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("NO_SUGGESTION identifier exits 1", async () => {
  const result = await runFixture("suggestion-sentinel");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dev\/concrete-suggestion/);
  expect(result.out).toMatch(/NO_SUGGESTION/);
  expect(result.out).toMatch(/concrete suggestion/);
  expect(result.out).not.toMatch(new RegExp(`suggestion: ${NO_SUGGESTION}`));
});

test("exact sentinel string exits 1", async () => {
  const result = await runFixture("suggestion-sentinel-string");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dev\/concrete-suggestion/);
  expect(result.out).not.toMatch(new RegExp(`suggestion: ${NO_SUGGESTION}`));
});
