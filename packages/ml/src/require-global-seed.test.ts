import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { requireGlobalSeed } from "./require-global-seed.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/require-global-seed";

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

test("plugin exports require-global-seed and recommended includes it", () => {
  expect(requireGlobalSeed).toBeDefined();
  expect(plugin.rules?.["require-global-seed"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("training DataLoader without torch.manual_seed exits 1", async () => {
  const result = await runFixture("seed-global-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/require-global-seed/);
  expect(result.out).toMatch(/torch\.manual_seed/);
  expect(result.out).toMatch(/Call torch\.manual_seed/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("torch.manual_seed before DataLoader exits 0", async () => {
  const result = await runFixture("seed-global-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("seed after DataLoader exits 1", async () => {
  const result = await runFixture("seed-order-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/require-global-seed/);
  expect(result.out).toMatch(/after the first DataLoader/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("non-training module is quiet", async () => {
  const result = await runFixture("non-training-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
