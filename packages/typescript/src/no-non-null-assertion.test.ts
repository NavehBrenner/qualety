import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noNonNullAssertion } from "./no-non-null-assertion.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/no-non-null-assertion"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-non-null-assertion and recommended includes it", () => {
  expect(noNonNullAssertion).toBeDefined();
  expect(plugin.rules?.["no-non-null-assertion"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-non-null-assertion"]).toBe("error");
});

test("expr! exit 1", async () => {
  const result = await runFixture("nonnull-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-non-null-assertion/);
  expect(result.out).toMatch(/Non-null assertion hides an undefined or null possibility/);
  expect(result.out).toMatch(/Narrow with a type guard, provide a default, or throw/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("no bang, definite-assignment field, and test-path skip exit 0", async () => {
  const result = await runFixture("nonnull-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
