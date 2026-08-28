import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noEmptyCatch } from "./no-empty-catch.ts";

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

test("plugin exports no-empty-catch and recommended includes it", () => {
  expect(noEmptyCatch).toBeDefined();
  expect(plugin.rules?.["no-empty-catch"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-empty-catch"]).toBe("error");
});

test("empty and comment-only catch exit 1", async () => {
  const result = await runFixture("catch-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-empty-catch/);
  expect(result.out).toMatch(/Empty catch swallows errors/);
  expect(result.out).toMatch(/Handle the error, rethrow, or throw/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("handled catch and test-path empty catch exit 0", async () => {
  const result = await runFixture("catch-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
