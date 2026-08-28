import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noSysPathHack } from "./no-sys-path-hack.ts";

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

test("plugin exports no-sys-path-hack and recommended includes it", () => {
  expect(noSysPathHack).toBeDefined();
  expect(plugin.rules?.["no-sys-path-hack"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-sys-path-hack"]).toBe("error");
});

test("sys.path insert/append/extend, +=, subscript, and from-import append exit 1", async () => {
  const result = await runFixture("sys-path-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/no-sys-path-hack/);
  expect(result.out).toMatch(/sys\.path is mutated at runtime to fix imports/);
  expect(result.out).toMatch(/Install the package editable/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("sys.path reads and unrelated path.append exit 0", async () => {
  const result = await runFixture("sys-path-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("sys.path mutation in test_*.py is skipped", async () => {
  const result = await runFixture("sys-path-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
