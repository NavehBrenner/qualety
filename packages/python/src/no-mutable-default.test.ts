import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noMutableDefault } from "./no-mutable-default.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["python/no-mutable-default"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-mutable-default and recommended includes it", () => {
  expect(noMutableDefault).toBeDefined();
  expect(plugin.rules?.["no-mutable-default"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-mutable-default"]).toBe("error");
});

test("mutable literals, ctors, async def, and same-module factory exit 1", async () => {
  const result = await runFixture("mutable-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-mutable-default/);
  expect(result.out).toMatch(/Mutable default argument is shared across calls/);
  expect(result.out).toMatch(/Use None as the default/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("None, tuple, frozenset, and unknown call exit 0", async () => {
  const result = await runFixture("mutable-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("mutable default in test_*.py is skipped", async () => {
  const result = await runFixture("mutable-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
