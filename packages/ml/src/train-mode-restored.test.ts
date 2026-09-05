import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { trainModeRestored } from "./train-mode-restored.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/train-mode-restored";

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

test("plugin exports train-mode-restored and recommended includes it", () => {
  expect(trainModeRestored).toBeDefined();
  expect(plugin.rules?.["train-mode-restored"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("eval without train restore before backward exits 1", async () => {
  const result = await runFixture("train-mode-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/train-mode-restored/);
  expect(result.out).toMatch(/train\(\)/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("train restored or no backward exits 0", async () => {
  const result = await runFixture("train-mode-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
