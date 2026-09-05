import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { optimizerZeroGrad } from "./optimizer-zero-grad.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/optimizer-zero-grad";

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

test("plugin exports optimizer-zero-grad and recommended includes it", () => {
  expect(optimizerZeroGrad).toBeDefined();
  expect(plugin.rules?.["optimizer-zero-grad"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("backward and step without zero_grad exits 1", async () => {
  const result = await runFixture("zero-grad-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/optimizer-zero-grad/);
  expect(result.out).toMatch(/zero_grad/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("zero_grad present exits 0", async () => {
  const result = await runFixture("zero-grad-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
