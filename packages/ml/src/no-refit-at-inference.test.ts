import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noRefitAtInference } from "./no-refit-at-inference.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/no-refit-at-inference";

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

test("plugin exports no-refit-at-inference and recommended includes it", () => {
  expect(noRefitAtInference).toBeDefined();
  expect(plugin.rules?.["no-refit-at-inference"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("scaler fit on infer path with torch.load exits 1", async () => {
  const result = await runFixture("refit-infer-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/no-refit-at-inference/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("train-only fit with backward exits 0", async () => {
  const result = await runFixture("refit-train-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("transform only with torch.load exits 0", async () => {
  const result = await runFixture("refit-transform-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("batch mean/std normalize with load exits 1", async () => {
  const result = await runFixture("refit-stats-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/no-refit-at-inference/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});
