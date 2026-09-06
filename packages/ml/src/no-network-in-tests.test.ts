import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noNetworkInTests } from "./no-network-in-tests.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/no-network-in-tests";

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

test("plugin exports no-network-in-tests and recommended includes it", () => {
  expect(noNetworkInTests).toBeDefined();
  expect(plugin.rules?.["no-network-in-tests"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("pretrained=True in a test module exits 1", async () => {
  const result = await runFixture("network-in-tests-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/no-network-in-tests/);
  expect(result.out).toMatch(/pretrained/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("pretrained=False in tests and non-test download exits 0", async () => {
  const result = await runFixture("network-in-tests-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
