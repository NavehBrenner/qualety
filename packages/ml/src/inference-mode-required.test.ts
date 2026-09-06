import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { inferenceModeRequired } from "./inference-mode-required.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/inference-mode-required";

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

test("plugin exports inference-mode-required and recommended includes it", () => {
  expect(inferenceModeRequired).toBeDefined();
  expect(plugin.rules?.["inference-mode-required"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("bare model forward in predict exits 1", async () => {
  const result = await runFixture("mode-predict-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/inference-mode-required/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("inference_mode and eval before forward exits 0", async () => {
  const result = await runFixture("mode-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("training loop with backward exits 0", async () => {
  const result = await runFixture("mode-train-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
