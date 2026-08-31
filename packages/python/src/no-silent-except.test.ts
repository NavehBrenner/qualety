import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noSilentExcept } from "./no-silent-except.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["python/no-silent-except"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-silent-except and recommended includes it", () => {
  expect(noSilentExcept).toBeDefined();
  expect(plugin.rules?.["no-silent-except"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-silent-except"]).toBe("error");
});

test("except body of pass, ellipsis, continue, or string exit 1", async () => {
  const result = await runFixture("except-silent-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-silent-except/);
  expect(result.out).toMatch(/the exception is swallowed/);
  expect(result.out).toMatch(/Log and re-raise/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("gated fallthrough, log+raise, return, raise, and mixed pass+real stmt exit 0", async () => {
  const result = await runFixture("except-silent-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("silent except in test_*.py is skipped", async () => {
  const result = await runFixture("except-silent-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
