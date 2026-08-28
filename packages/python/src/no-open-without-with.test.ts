import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noOpenWithoutWith } from "./no-open-without-with.ts";

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

test("plugin exports no-open-without-with and recommended includes it", () => {
  expect(noOpenWithoutWith).toBeDefined();
  expect(plugin.rules?.["no-open-without-with"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-open-without-with"]).toBe("error");
});

test("open statement and assign exit 1", async () => {
  const result = await runFixture("open-with-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-open-without-with/);
  expect(result.out).toMatch(/open\(\.\.\.\) is not used as a with \/ async with context manager/);
  expect(result.out).toMatch(/Use with open/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("with open, async with, return open, and call-arg exit 0", async () => {
  const result = await runFixture("open-with-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("unmanaged open in test_*.py is skipped", async () => {
  const result = await runFixture("open-with-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
