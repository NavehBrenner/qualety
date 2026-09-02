import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { determinismTestRequired } from "./determinism-test-required.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/determinism-test-required";

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

test("plugin exports determinism-test-required and recommended includes it", () => {
  expect(determinismTestRequired).toBeDefined();
  expect(plugin.rules?.["determinism-test-required"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("training entry point without weight-identity test exits 1", async () => {
  const result = await runFixture("det-test-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/determinism-test-required/);
  expect(result.out).toMatch(/identical weights/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("test with two train calls and torch.equal exits 0", async () => {
  const result = await runFixture("det-test-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
