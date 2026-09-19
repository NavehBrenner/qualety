import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { singleSourceThreshold } from "./single-source-threshold.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const stub = join(here, "../test/name-embed-stub.mjs");
const MODULE_ENV = "QUALETY_EMBEDDINGS_MODULE";
const CACHE_ENV = "QUALETY_EMBEDDINGS_CACHE";

async function runFixture(name: string, env: NodeJS.ProcessEnv = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), "ci-thresh-cache-"));
  const prevModule = process.env[MODULE_ENV];
  const prevCache = process.env[CACHE_ENV];
  const lines: string[] = [];
  const errors: string[] = [];
  try {
    if (env[MODULE_ENV] !== undefined) {
      process.env[MODULE_ENV] = env[MODULE_ENV];
    }
    process.env[CACHE_ENV] = env[CACHE_ENV] ?? cacheDir;
    const code = await check(
      join(fixtures, name),
      (m) => lines.push(String(m)),
      (m) => errors.push(String(m)),
      { plugins: [], excludePlugins: [], rules: ["python/single-source-threshold"], diff: "off" },
    );
    return { code, out: lines.join("\n"), err: errors.join("\n") };
  } finally {
    if (prevModule === undefined) {
      delete process.env[MODULE_ENV];
    } else {
      process.env[MODULE_ENV] = prevModule;
    }
    if (prevCache === undefined) {
      delete process.env[CACHE_ENV];
    } else {
      process.env[CACHE_ENV] = prevCache;
    }
  }
}

test("plugin exports the rule and recommended omits it", () => {
  expect(singleSourceThreshold).toBeDefined();
  expect(plugin.rules?.["single-source-threshold"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/single-source-threshold"]).toBeUndefined();
});

test("exact same name in two modules reports the extra site", async () => {
  const result = await runFixture("threshold-a-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/single-source-threshold/);
  expect(result.out).toMatch(/FORCE_CAP/);
  expect(result.out).toMatch(/second definition/);
  expect(result.out).toMatch(/src\/a\.py/);
  expect(result.out).toMatch(/suggestion:/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
  expect(result.out.match(/python\/single-source-threshold/g)?.length).toBe(1);
});

test("importer that also defines is silent", async () => {
  const result = await runFixture("threshold-a-ok-import");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("test paths are skipped", async () => {
  const result = await runFixture("threshold-a-ok-test");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("normalized FORCE_CAP_N vs DEFAULT_FORCE_CAP reports once with disagree note", async () => {
  const result = await runFixture("threshold-b-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/single-source-threshold/);
  expect(result.out).toMatch(/DEFAULT_FORCE_CAP|FORCE_CAP_N/);
  expect(result.out).toMatch(/values disagree — confirm split-brain/i);
  expect(result.out).toMatch(/suggestion:/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
  expect(result.out.match(/python\/single-source-threshold/g)?.length).toBe(1);
});

test("ungated MAX_RETRIES vs MAX_WORKERS is silent", async () => {
  const result = await runFixture("threshold-b-ok-unrelated");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("name-embed paraphrase pair reports", async () => {
  const result = await runFixture("threshold-c-bad", { [MODULE_ENV]: stub });
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/single-source-threshold/);
  expect(result.out).toMatch(/STRENGTH_CAP|FORCE_CEILING/);
  expect(result.out).toMatch(/suggestion:/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("short junk names without lexicon are silent", async () => {
  const result = await runFixture("threshold-c-ok-junk", { [MODULE_ENV]: stub });
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("model load failure with C on exits 2", async () => {
  const result = await runFixture("threshold-c-bad", {
    [MODULE_ENV]: "/nonexistent/embed-module.mjs",
  });
  expect(result.code).toBe(2);
  expect(result.err).toMatch(/python\/single-source-threshold/);
  expect(result.err).toMatch(/code-embeddings/);
});

test("C off does not load the model", async () => {
  const result = await runFixture("threshold-c-off", {
    [MODULE_ENV]: "/nonexistent/embed-module.mjs",
  });
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("mixed A+B+C emits one A-flavoured violation", async () => {
  const result = await runFixture("threshold-mixed", { [MODULE_ENV]: stub });
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/single-source-threshold/);
  expect(result.out).toMatch(/second definition/);
  expect(result.out).toMatch(/values disagree — confirm split-brain/i);
  expect(result.out.match(/python\/single-source-threshold/g)?.length).toBe(1);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("non-numeric class local and unpack are silent", async () => {
  const result = await runFixture("threshold-ok-shape");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("cross-package twins are silent", async () => {
  const result = await runFixture("threshold-ok-cross-pkg");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
