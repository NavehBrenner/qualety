import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { tensorToDeviceResultIgnored } from "./tensor-to-device-result-ignored.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/tensor-to-device-result-ignored";

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

test("plugin exports tensor-to-device-result-ignored and recommended includes it", () => {
  expect(tensorToDeviceResultIgnored).toBeDefined();
  expect(plugin.rules?.["tensor-to-device-result-ignored"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("bare tensor.to/cuda expression exits 1", async () => {
  const result = await runFixture("tensor-to-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/tensor-to-device-result-ignored/);
  expect(result.out).toMatch(/to\(device\)/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("assigned result or model.to exits 0", async () => {
  const result = await runFixture("tensor-to-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
