import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noPublicAny } from "./no-public-any.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["python/no-public-any"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-public-any and recommended includes it", () => {
  expect(noPublicAny).toBeDefined();
  expect(plugin.rules?.["no-public-any"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-public-any"]).toBe("error");
});

test("public Any param, return, typing.Any, and same-file alias exit 1", async () => {
  const result = await runFixture("public-any-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-public-any/);
  expect(result.out).toMatch(
    /"with_any" is public and annotates a parameter or return type as Any/,
  );
  expect(result.out).toMatch(/Replace Any with a real type/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("int, list[Any], Any | None, *args/**kwargs Any, private, and nested def exit 0", async () => {
  const result = await runFixture("public-any-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("public Any in test_*.py is skipped", async () => {
  const result = await runFixture("public-any-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
