import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { exhaustiveSwitch } from "./exhaustive-switch.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/exhaustive-switch"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports exhaustive-switch and recommended includes it", () => {
  expect(exhaustiveSwitch).toBeDefined();
  expect(plugin.rules?.["exhaustive-switch"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/exhaustive-switch"]).toBe("error");
});

test("missing union and enum cases exit 1", async () => {
  const result = await runFixture("switch-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/exhaustive-switch/);
  expect(result.out).toMatch(/Switch is missing case/);
  expect(result.out).toMatch(/_exhaustive: never/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("all cases, never-default, wide string, and test-path skip exit 0", async () => {
  const result = await runFixture("switch-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
