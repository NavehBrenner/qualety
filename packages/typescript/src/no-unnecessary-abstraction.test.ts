import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noUnnecessaryAbstraction } from "./no-unnecessary-abstraction.ts";

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

test("plugin exports no-unnecessary-abstraction and recommended includes it", () => {
  expect(noUnnecessaryAbstraction).toBeDefined();
  expect(plugin.rules?.["no-unnecessary-abstraction"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-unnecessary-abstraction"]).toBe("error");
});

test("pass-through, small+flat, single-use type, impl export, useFoo without React exit 1", async () => {
  const result = await runFixture("abstraction-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-unnecessary-abstraction/);
  expect(result.out).toMatch(/"wrap"/);
  expect(result.out).toMatch(/"add"/);
  expect(result.out).toMatch(/"useFoo"/);
  expect(result.out).toMatch(/"Id"/);
  expect(result.out).toMatch(/"smallFlat"/);
  expect(result.out).toMatch(/Inline at its only call site/);
  expect(result.out).toMatch(/Inline the type at its only use/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("two call sites, zero callers, nested control flow, branded type exit 0", async () => {
  const result = await runFixture("abstraction-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("pass-through in src/index.ts is quiet", async () => {
  const result = await runFixture("abstraction-ok-barrel");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("package.json exports target is quiet", async () => {
  const result = await runFixture("abstraction-ok-exports");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("React hooks and JSX components are quiet", async () => {
  const result = await runFixture("abstraction-ok-react");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("pass-through in *.test.ts is quiet", async () => {
  const result = await runFixture("abstraction-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
