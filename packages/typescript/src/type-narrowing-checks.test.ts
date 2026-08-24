import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
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
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports type-narrowing-checks and recommended includes it", () => {
  expect(plugin.rules?.["type-narrowing-checks"]).toBeDefined();
  expect(plugin.rules?.["no-constant-condition"]).toBeDefined();
  expect(plugin.rules?.["no-double-validation"]).toBeUndefined();
  expect(plugin.configs?.recommended?.rules?.["ts/type-narrowing-checks"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ts/no-constant-condition"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ts/zod-boundary"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ts/no-double-validation"]).toBeUndefined();
});

test("narrowing checks that refine exit 0", async () => {
  const result = await runFixture("narrow-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("checks that do not narrow exit 1", async () => {
  const result = await runFixture("narrow-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/type-narrowing-checks/);
  expect(result.out).toMatch(/does not narrow/);
  expect(result.out).toMatch(/isFoo|arr|x/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("numeric, string equality, and length > 5 are not A", async () => {
  const result = await runFixture("narrow-silence");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
