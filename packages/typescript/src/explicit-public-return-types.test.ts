import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { explicitPublicReturnTypes } from "./explicit-public-return-types.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/explicit-public-return-types"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports explicit-public-return-types and recommended includes it", () => {
  expect(explicitPublicReturnTypes).toBeDefined();
  expect(plugin.rules?.["explicit-public-return-types"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/explicit-public-return-types"]).toBe("error");
});

test("exported fn, method, and default missing return type exit 1", async () => {
  const result = await runFixture("return-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/explicit-public-return-types/);
  expect(result.out).toMatch(/missing an explicit return type/);
  expect(result.out).toMatch(/Add an explicit return type/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("annotated, type-only, re-export, and test-path skip exit 0", async () => {
  const result = await runFixture("return-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
