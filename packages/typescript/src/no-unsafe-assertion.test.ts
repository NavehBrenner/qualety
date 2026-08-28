import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noUnsafeAssertion } from "./no-unsafe-assertion.ts";

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

test("plugin exports no-unsafe-assertion and recommended includes it", () => {
  expect(noUnsafeAssertion).toBeDefined();
  expect(plugin.rules?.["no-unsafe-assertion"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-unsafe-assertion"]).toBe("error");
  expect(plugin.biome?.rules?.["nursery/noUnsafeTypeAssertion"]).toBe("error");
});

test("as any and as unknown as T exit 1", async () => {
  const result = await runFixture("assert-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-unsafe-assertion/);
  expect(result.out).toMatch(/Unsafe type assertion erases type safety/);
  expect(result.out).toMatch(/Narrow with a type guard/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("as const, as T, as unknown, and test-path as any exit 0", async () => {
  const result = await runFixture("assert-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
