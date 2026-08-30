import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import {
  aliasesOf,
  BOUNDARY_NAMES,
  BOUNDARY_PREFIX,
  firstArgIdentifier,
  functionLikeName,
  isFunctionLike,
  isHandGuardCall,
  isPropertyParseCall,
  isPropertyUse,
  isSchemaParseCall,
  isTypeofObjectGuard,
  typeofTarget,
  unknownParamNames,
} from "./parse-flow.ts";
import { zodBoundary } from "./zod-boundary.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/zod-boundary"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports zod-boundary and recommended includes it", () => {
  expect(zodBoundary).toBeDefined();
  expect(BOUNDARY_NAMES.size).toBeGreaterThan(0);
  expect(BOUNDARY_PREFIX.test("loadFoo")).toBe(true);
  expect(aliasesOf).toEqual(expect.any(Function));
  expect(firstArgIdentifier).toEqual(expect.any(Function));
  expect(functionLikeName).toEqual(expect.any(Function));
  expect(isFunctionLike).toEqual(expect.any(Function));
  expect(isHandGuardCall).toEqual(expect.any(Function));
  expect(isPropertyParseCall).toEqual(expect.any(Function));
  expect(isPropertyUse).toEqual(expect.any(Function));
  expect(isSchemaParseCall).toEqual(expect.any(Function));
  expect(isTypeofObjectGuard).toEqual(expect.any(Function));
  expect(typeofTarget).toEqual(expect.any(Function));
  expect(unknownParamNames).toEqual(expect.any(Function));
  expect(plugin.rules?.["zod-boundary"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/zod-boundary"]).toBe("error");
});

test("Z1 parse-before-use exits 0", async () => {
  const result = await runFixture("z1-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("Z1 use-before-parse exits 1", async () => {
  const result = await runFixture("z1-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/zod-boundary/);
  expect(result.out).toMatch(/loadConfig/);
  expect(result.out).toMatch(/safeParse/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("Z2 JSON.parse into safeParse exits 0", async () => {
  const result = await runFixture("z2-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("Z2 JSON.parse property access exits 1", async () => {
  const result = await runFixture("z2-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/zod-boundary/);
  expect(result.out).toMatch(/JSON\.parse/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("Z2 JSON.parse binding property access exits 1", async () => {
  const result = await runFixture("z2-bad-binding");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/zod-boundary/);
  expect(result.out).toMatch(/JSON\.parse/);
});
