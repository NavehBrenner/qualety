import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noUnnecessaryDef } from "./no-unnecessary-def.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["python/no-unnecessary-def"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-unnecessary-def and recommended includes it", () => {
  expect(noUnnecessaryDef).toBeDefined();
  expect(plugin.rules?.["no-unnecessary-def"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-unnecessary-def"]).toBe("error");
});

test("pass-through and small+flat one call exit 1", async () => {
  const result = await runFixture("def-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-unnecessary-def/);
  expect(result.out).toMatch(/"wrap" is only called once and does not pay for the indirection/);
  expect(result.out).toMatch(/"add"/);
  expect(result.out).toMatch(/"small_flat"/);
  expect(result.out).toMatch(/Inline at its only call site/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("one other-file caller and unused def exit 1", async () => {
  const result = await runFixture("def-bad-cross-file");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-unnecessary-def/);
  expect(result.out).toMatch(/"wrap" is only called once and does not pay for the indirection/);
  expect(result.out).toMatch(/"unused_fn" is not called and does not pay for the indirection/);
  expect(result.out).toMatch(/Inline at its only call site/);
  expect(result.out).toMatch(/Remove this helper/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("two call sites and nested control flow exit 0", async () => {
  const result = await runFixture("def-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("two files each call once exit 0", async () => {
  const result = await runFixture("def-ok-cross-file");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("pass-through in __init__.py is quiet", async () => {
  const result = await runFixture("def-ok-init");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("pass-through in test_*.py is quiet", async () => {
  const result = await runFixture("def-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
