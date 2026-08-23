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

test("provider file with node:fs is valid", async () => {
  const result = await runFixture("fs-in-provider");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("rule file with node:fs exits 1", async () => {
  const result = await runFixture("fs-in-rule");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dev\/no-fs-in-rules/);
  expect(result.out).toMatch(/node:fs/);
  expect(result.out).toMatch(/provides\.\*\.build/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});
