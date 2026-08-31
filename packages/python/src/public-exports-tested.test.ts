import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { publicExportsTested } from "./public-exports-tested.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["python/public-exports-tested"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports public-exports-tested and recommended includes it", () => {
  expect(publicExportsTested).toBeDefined();
  expect(plugin.rules?.["public-exports-tested"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/public-exports-tested"]).toBe("error");
});

test("untested __all__ name exit 1", async () => {
  const result = await runFixture("exports-bad-all");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/public-exports-tested/);
  expect(result.out).toMatch(/Public export "foo" is not referenced from a test/);
  expect(result.out).toMatch(/Add a test import of "foo"/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("untested __init__ re-export exit 1", async () => {
  const result = await runFixture("exports-bad-reexport");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/public-exports-tested/);
  expect(result.out).toMatch(/Public export "foo" is not referenced from a test/);
  expect(result.out).toMatch(/Add a test import of "foo"/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("tested __all__ exit 0", async () => {
  const result = await runFixture("exports-ok-tested-all");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("tested re-export exit 0", async () => {
  const result = await runFixture("exports-ok-tested-reexport");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("tested re-export via defining submodule exit 0", async () => {
  const result = await runFixture("exports-ok-tested-submodule");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("tested __all__ re-export via defining submodule exit 0", async () => {
  const result = await runFixture("exports-ok-tested-all-submodule");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("no public surface and private re-export exit 0", async () => {
  const result = await runFixture("exports-ok-quiet");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("unparsable __all__ silences the package", async () => {
  const result = await runFixture("exports-ok-unparsable");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
