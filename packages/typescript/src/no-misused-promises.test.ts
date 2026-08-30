import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noMisusedPromises } from "./no-misused-promises.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/no-misused-promises"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-misused-promises and recommended includes it", () => {
  expect(noMisusedPromises).toBeDefined();
  expect(plugin.rules?.["no-misused-promises"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-misused-promises"]).toBe("error");
});

test("async void callback and forEach async exit 1", async () => {
  const result = await runFixture("misuse-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-misused-promises/);
  expect(result.out).toMatch(/sync void callback/);
  expect(result.out).toMatch(/void the work, hoist to an outer async, or \.catch/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("Promise-accepting param, sync forEach, and test-path skip exit 0", async () => {
  const result = await runFixture("misuse-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
