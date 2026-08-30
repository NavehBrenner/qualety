import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import {
  calleeLooksAsync,
  checkerSaysPromise,
  declIsAsync,
  declReturnsPromise,
  noFloatingPromises,
  typeIsPromise,
} from "./no-floating-promises.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/no-floating-promises"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-floating-promises and recommended includes it", () => {
  expect(noFloatingPromises).toBeDefined();
  expect(checkerSaysPromise).toEqual(expect.any(Function));
  expect(calleeLooksAsync).toEqual(expect.any(Function));
  expect(declIsAsync).toEqual(expect.any(Function));
  expect(declReturnsPromise).toEqual(expect.any(Function));
  expect(typeIsPromise).toEqual(expect.any(Function));
  expect(plugin.rules?.["no-floating-promises"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-floating-promises"]).toBe("error");
});

test("floating async call and bare then exit 1", async () => {
  const result = await runFixture("float-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-floating-promises/);
  expect(result.out).toMatch(/Promise is not awaited/);
  expect(result.out).toMatch(/await, return, void, or \.catch/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("await, return, void, catch, then arity 2, and test-path skip exit 0", async () => {
  const result = await runFixture("float-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
