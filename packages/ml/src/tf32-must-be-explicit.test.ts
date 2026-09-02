import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { tf32MustBeExplicit } from "./tf32-must-be-explicit.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/tf32-must-be-explicit";

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

test("plugin exports tf32-must-be-explicit and recommended includes it", () => {
  expect(tf32MustBeExplicit).toBeDefined();
  expect(plugin.rules?.["tf32-must-be-explicit"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("CUDA move without both allow_tf32 flags exits 1", async () => {
  const result = await runFixture("tf32-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/tf32-must-be-explicit/);
  expect(result.out).toMatch(/allow_tf32/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("both allow_tf32 assigns present exits 0", async () => {
  const result = await runFixture("tf32-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
