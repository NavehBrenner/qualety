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
  expect(result.out).toMatch(/"wrap" is only called once and does not pay for the indirection/);
  expect(result.out).toMatch(/"add"/);
  expect(result.out).toMatch(/"useFoo"/);
  expect(result.out).toMatch(/"Id" is only referenced once/);
  expect(result.out).toMatch(/"smallFlat"/);
  expect(result.out).toMatch(/Inline at its only call site/);
  expect(result.out).toMatch(/Inline the type at its only use/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("one other-file caller, unused helper and type exit 1", async () => {
  const result = await runFixture("abstraction-bad-cross-file");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-unnecessary-abstraction/);
  expect(result.out).toMatch(/"wrap" is only called once and does not pay for the indirection/);
  expect(result.out).toMatch(/"unusedFn" is not called and does not pay for the indirection/);
  expect(result.out).toMatch(/"Id" is only referenced once/);
  expect(result.out).toMatch(/"UnusedType" is not referenced/);
  expect(result.out).toMatch(/Inline at its only call site/);
  expect(result.out).toMatch(/Remove this helper/);
  expect(result.out).toMatch(/Inline the type at its only use/);
  expect(result.out).toMatch(/Remove this type/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("two call sites, nested control flow, branded type exit 0", async () => {
  const result = await runFixture("abstraction-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("two files each call and each reference once exit 0", async () => {
  const result = await runFixture("abstraction-ok-cross-file");
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
