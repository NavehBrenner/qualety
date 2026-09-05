import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noCudaHardcoded } from "./no-cuda-hardcoded.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/no-cuda-hardcoded";

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

test("plugin exports no-cuda-hardcoded and recommended includes it", () => {
  expect(noCudaHardcoded).toBeDefined();
  expect(plugin.rules?.["no-cuda-hardcoded"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("hardcoded .cuda() exits 1", async () => {
  const result = await runFixture("cuda-hardcoded-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/no-cuda-hardcoded/);
  expect(result.out).toMatch(/CUDA/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("device from arg or cpu literal exits 0", async () => {
  const result = await runFixture("cuda-hardcoded-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
