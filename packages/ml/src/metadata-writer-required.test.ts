import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { metadataWriterRequired } from "./metadata-writer-required.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/metadata-writer-required";

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

test("plugin exports metadata-writer-required and recommended includes it", () => {
  expect(metadataWriterRequired).toBeDefined();
  expect(plugin.rules?.["metadata-writer-required"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("training entry without writer exits 1", async () => {
  const result = await runFixture("writer-missing-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/metadata-writer-required/);
  expect(result.out).toMatch(/save_metadata/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("writer that does not write exits 1", async () => {
  const result = await runFixture("writer-no-write-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/metadata-writer-required/);
  expect(result.out).toMatch(/does not write/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("writer never called from entry exits 1", async () => {
  const result = await runFixture("writer-uncalled-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/metadata-writer-required/);
  expect(result.out).toMatch(/not called/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("save_metadata called from train exits 0", async () => {
  const result = await runFixture("provenance-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("overridden writerName exits 0", async () => {
  const result = await runFixture("writer-name-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("Gate C torch.save without writer exits 1", async () => {
  const result = await runFixture("gate-c-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/metadata-writer-required/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("Gate C torch.save with writer exits 0", async () => {
  const result = await runFixture("gate-c-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("non-entry backward helper is quiet", async () => {
  const result = await runFixture("non-entry-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
