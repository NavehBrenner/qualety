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

test("matching api.md and catalogs exit 0", async () => {
  const result = await runFixture("honesty-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("undocumented export and rule exit 1", async () => {
  const result = await runFixture("honesty-undocumented");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dev\/docs-export-honesty/);
  expect(result.out).toMatch(/extraExport/);
  expect(result.out).toMatch(/dev\/undocumented-rule/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("ghost export and catalog row exit 1", async () => {
  const result = await runFixture("honesty-ghost");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/notReal/);
  expect(result.out).toMatch(/dev\/not-a-rule/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});
