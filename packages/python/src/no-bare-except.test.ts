import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noBareExcept } from "./no-bare-except.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["python/no-bare-except"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-bare-except and recommended includes it", () => {
  expect(noBareExcept).toBeDefined();
  expect(plugin.rules?.["no-bare-except"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-bare-except"]).toBe("error");
});

test("bare except, BaseException, as e, and tuple with BaseException exit 1", async () => {
  const result = await runFixture("except-bare-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-bare-except/);
  expect(result.out).toMatch(/Bare except: catches BaseException/);
  expect(result.out).toMatch(/except BaseException catches KeyboardInterrupt/);
  expect(result.out).toMatch(/Catch a specific exception type/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("except Exception, ValueError, and tuples without BaseException exit 0", async () => {
  const result = await runFixture("except-bare-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("bare except in test_*.py is skipped", async () => {
  const result = await runFixture("except-bare-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
