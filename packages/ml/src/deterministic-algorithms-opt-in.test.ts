import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { deterministicAlgorithmsOptIn } from "./deterministic-algorithms-opt-in.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/deterministic-algorithms-opt-in";

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: [RULE], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports deterministic-algorithms-opt-in and recommended is off", () => {
  expect(deterministicAlgorithmsOptIn).toBeDefined();
  expect(plugin.rules?.["deterministic-algorithms-opt-in"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("off");
});

test("training without deterministic API when enabled exits 1", async () => {
  const result = await runFixture("det-algo-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/deterministic-algorithms-opt-in/);
  expect(result.out).toMatch(/use_deterministic_algorithms/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("use_deterministic_algorithms present exits 0", async () => {
  const result = await runFixture("det-algo-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
