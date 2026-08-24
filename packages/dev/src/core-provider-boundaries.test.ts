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

test("ts-morph in the default provider module is allowed", async () => {
  const result = await runFixture("core-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("ts-morph, dupehound, and QUALETY_DUPEHOUND in core engine exit 1", async () => {
  const result = await runFixture("core-invalid");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dev\/core-provider-boundaries/);
  expect(result.out).toMatch(/ts-morph/);
  expect(result.out).toMatch(/dupehound/);
  expect(result.out).toMatch(/@qualety\/dry/);
  expect(result.out).toMatch(/createTypeScriptProvider/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});
