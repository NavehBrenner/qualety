import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { recordCodeVersion } from "./record-code-version.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/record-code-version";

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: [RULE], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports record-code-version and recommended includes it", () => {
  expect(recordCodeVersion).toBeDefined();
  expect(plugin.rules?.["record-code-version"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("writer payload without code version exits 1", async () => {
  const result = await runFixture("code-version-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/record-code-version/);
  expect(result.out).toMatch(/code version/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("git_commit in payload exits 0", async () => {
  const result = await runFixture("provenance-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("missing writer is quiet", async () => {
  const result = await runFixture("writer-missing-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("non-entry backward helper is quiet", async () => {
  const result = await runFixture("non-entry-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
