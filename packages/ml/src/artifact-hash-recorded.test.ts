import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { artifactHashRecorded } from "./artifact-hash-recorded.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/artifact-hash-recorded";

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

test("plugin exports artifact-hash-recorded and recommended includes it", () => {
  expect(artifactHashRecorded).toBeDefined();
  expect(plugin.rules?.["artifact-hash-recorded"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("same-module save hash and writer exits 0", async () => {
  const result = await runFixture("hash-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("cross-module same-package hash helper exits 0", async () => {
  const result = await runFixture("hash-cross-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("overridden writerName exits 0", async () => {
  const result = await runFixture("hash-writer-name-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("missing hash exits 1", async () => {
  const result = await runFixture("hash-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/artifact-hash-recorded/);
  expect(result.out).toMatch(/content hash/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("hash of unrelated path does not pass", async () => {
  const result = await runFixture("hash-unrelated-bad");
  expect(result.err).toBe("");
  expect(result.code).not.toBe(0);
  expect(result.out).toMatch(/ml\/artifact-hash-recorded/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("unrecoverable path is quiet", async () => {
  const result = await runFixture("hash-path-silence");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("non-Gate C training entry is quiet", async () => {
  const result = await runFixture("provenance-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("unresolved writer is quiet", async () => {
  const result = await runFixture("gate-c-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
