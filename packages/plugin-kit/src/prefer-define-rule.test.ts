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

test("bare rule object on a plugin rules map exits 1", async () => {
  const result = await runFixture("bare-rule-object");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/plugin-kit\/prefer-define-rule/);
  expect(result.out).toMatch(/Prefer defineRule over a bare Rule object/);
  expect(result.out).toMatch(/Wrap this rule with defineRule/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("imported defineRule binding exits 0", async () => {
  const result = await runFixture("define-rule-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/plugin-kit\/prefer-define-rule/);
});

test("recommended severity map is not flagged", async () => {
  const result = await runFixture("recommended-rules-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/plugin-kit\/prefer-define-rule/);
});
