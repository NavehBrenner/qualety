import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noUnnecessaryClass } from "./no-unnecessary-class.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["python/no-unnecessary-class"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-unnecessary-class and recommended includes it", () => {
  expect(noUnnecessaryClass).toBeDefined();
  expect(plugin.rules?.["no-unnecessary-class"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-unnecessary-class"]).toBe("error");
});

test("thin 0-use, thin 1-use, and pass-through 1-use exit 1", async () => {
  const result = await runFixture("class-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-unnecessary-class/);
  expect(result.out).toMatch(
    /"UnusedBag" is not instantiated or subclassed and does not pay for the indirection/,
  );
  expect(result.out).toMatch(/"OnceBag" is only used once and does not pay for the indirection/);
  expect(result.out).toMatch(/"Pipe" is only used once and does not pay for the indirection/);
  expect(result.out).toMatch(/Remove this class/);
  expect(result.out).toMatch(/Inline at its only instantiation or subclass/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("thin class in __init__.py still fires", async () => {
  const result = await runFixture("class-bad-init");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-unnecessary-class/);
  expect(result.out).toMatch(/"InitBag"/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("one other-file instantiate on a colliding line is only used once", async () => {
  const result = await runFixture("class-bad-cross-file");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-unnecessary-class/);
  expect(result.out).toMatch(/"OnceBag" is only used once and does not pay for the indirection/);
  expect(result.out).not.toMatch(/not instantiated or subclassed/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("two files each instantiate once on a colliding line exit 0", async () => {
  const result = await runFixture("class-ok-cross-file");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("import-only is not a use", async () => {
  const result = await runFixture("class-bad-import-only");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-unnecessary-class/);
  expect(result.out).toMatch(/"ImportedBag"/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("two uses, subclass, non-object base, and dunder-heavy exit 0", async () => {
  const result = await runFixture("class-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("thin class in test_*.py is skipped", async () => {
  const result = await runFixture("class-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("registry dict of classes is quiet", async () => {
  const result = await runFixture("class-ok-registry");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/MyHandler/);
});

test("static spec_from_file_location alias instantiate is quiet", async () => {
  const result = await runFixture("class-ok-path-load");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/LoadedBag/);
});
