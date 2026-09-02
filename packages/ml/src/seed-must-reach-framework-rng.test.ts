import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { seedMustReachFrameworkRng } from "./seed-must-reach-framework-rng.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/seed-must-reach-framework-rng";

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

test("plugin exports seed-must-reach-framework-rng and recommended includes it", () => {
  expect(seedMustReachFrameworkRng).toBeDefined();
  expect(plugin.rules?.["seed-must-reach-framework-rng"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("seed only into train_test_split exits 1", async () => {
  const result = await runFixture("seed-reach-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/seed-must-reach-framework-rng/);
  expect(result.out).toMatch(/never reaches a framework RNG/);
  expect(result.out).toMatch(/torch\.manual_seed/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("seed into torch.manual_seed exits 0", async () => {
  const result = await runFixture("seed-reach-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("seed passed to unknown Call is silent", async () => {
  const result = await runFixture("seed-reach-silence");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
