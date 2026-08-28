import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import type { EmbeddedChunk } from "./code-embeddings.ts";
import { CACHE_ENV } from "./embed-cache.ts";
import { MODULE_ENV } from "./embed-module.ts";
import {
  COSINE_THRESHOLD,
  cosineSimilarity,
  reportsFromEmbeddings,
} from "./no-semantic-duplicate.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const stub = join(here, "../test/embed-stub.mjs");

async function runFixture(name: string, env: NodeJS.ProcessEnv = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), "ci-embed-cache-"));
  const prevModule = process.env[MODULE_ENV];
  const prevCache = process.env[CACHE_ENV];
  const lines: string[] = [];
  const errors: string[] = [];
  try {
    process.env[MODULE_ENV] = env[MODULE_ENV] ?? stub;
    process.env[CACHE_ENV] = env[CACHE_ENV] ?? cacheDir;
    const code = await check(
      join(fixtures, name),
      (m) => lines.push(String(m)),
      (m) => errors.push(String(m)),
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

function member(path: string, name: string, vector: Float32Array, line = 1): EmbeddedChunk {
  return {
    path,
    name,
    lang: "ts",
    range: {
      start: { line, column: 1 },
      end: { line, column: name.length + 1 },
    },
    vector,
  };
}

test("reportsFromEmbeddings maps a cluster to a concrete suggestion", () => {
  const similar = new Float32Array([1, 0, 0, 0]);
  const reports = reportsFromEmbeddings({
    chunks: [
      member("src/billing.ts", "calculateBillingTotal", similar, 3),
      member("src/invoice.ts", "computeOrderTotal", similar, 1),
    ],
  });
  expect(reports).toHaveLength(1);
  expect(reports[0]?.file).toBe("src/billing.ts");
  expect(reports[0]?.message).toMatch(
    /"calculateBillingTotal" is a semantic near-duplicate of "computeOrderTotal" at src\/invoice\.ts:1/,
  );
  expect(reports[0]?.message).not.toMatch(/in this file/i);
  expect(reports[0]?.suggestion).toMatch(/reuse "computeOrderTotal" at src\/invoice\.ts:1/i);
  expect(reports[0]?.suggestion).not.toBe(NO_SUGGESTION);
});

test("reportsFromEmbeddings emits one violation for a cluster of 3", () => {
  const similar = new Float32Array([1, 0, 0, 0]);
  const reports = reportsFromEmbeddings({
    chunks: [
      member("src/gamma.ts", "gammaTotal", similar),
      member("src/alpha.ts", "alphaTotal", similar),
      member("src/beta.ts", "betaTotal", similar),
    ],
  });
  expect(reports).toHaveLength(1);
  expect(reports[0]?.file).toBe("src/alpha.ts");
  expect(reports[0]?.message).toMatch(/"alphaTotal" is a semantic near-duplicate of/);
  expect(reports[0]?.message).toMatch(/"betaTotal" at src\/beta\.ts:1/);
  expect(reports[0]?.message).toMatch(/"gammaTotal" at src\/gamma\.ts:1/);
  expect(reports[0]?.suggestion).not.toBe(NO_SUGGESTION);
});

test("unrelated vectors are silent", () => {
  const reports = reportsFromEmbeddings({
    chunks: [
      member("src/a.ts", "alpha", new Float32Array([1, 0, 0, 0])),
      member("src/b.ts", "beta", new Float32Array([0, 1, 0, 0])),
    ],
  });
  expect(reports).toHaveLength(0);
});

test("cosine 0.85 is silent at default 0.90 and reports at 0.80", () => {
  const left = new Float32Array([1, 0]);
  const right = new Float32Array([0.85, Math.sqrt(1 - 0.85 * 0.85)]);
  expect(cosineSimilarity(left, right)).toBeCloseTo(0.85);
  const chunks = [member("src/a.ts", "alpha", left), member("src/b.ts", "beta", right)];
  expect(reportsFromEmbeddings({ chunks })).toHaveLength(0);
  expect(reportsFromEmbeddings({ chunks }, COSINE_THRESHOLD)).toHaveLength(0);
  expect(reportsFromEmbeddings({ chunks }, 0.8)).toHaveLength(1);
});

test("cosineSimilarity is 1 for identical unit vectors", () => {
  const vector = new Float32Array([0, 1, 0]);
  expect(cosineSimilarity(vector, vector)).toBe(1);
  expect(COSINE_THRESHOLD).toBe(0.9);
});

test("TS near-dupe pair exits 1 with concrete suggestion", async () => {
  const result = await runFixture("semantic-pair");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-semantic-duplicate/);
  expect(result.out).toMatch(/semantic near-duplicate/);
  expect(result.out).toMatch(/suggestion:/);
  expect(result.out).not.toMatch(/in this file/i);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("Python near-dupe pair exits 1 with concrete suggestion", async () => {
  const result = await runFixture("semantic-python-pair");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-semantic-duplicate/);
  expect(result.out).toMatch(/semantic near-duplicate/);
  expect(result.out).not.toMatch(/in this file/i);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("unrelated pair is silent", async () => {
  const result = await runFixture("semantic-quiet");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-semantic-duplicate/);
});

test("tiny chunks are silent", async () => {
  const result = await runFixture("semantic-tiny");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("TS test paths are skipped", async () => {
  const result = await runFixture("semantic-tests-excluded");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("Python test paths are skipped", async () => {
  const result = await runFixture("semantic-python-tests-excluded");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("cluster of 3 reports one violation with siblings", async () => {
  const result = await runFixture("semantic-cluster-3");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-semantic-duplicate/);
  expect(result.out).toMatch(/alphaTotal/);
  expect(result.out).toMatch(/betaTotal/);
  expect(result.out).toMatch(/gammaTotal/);
  expect(result.out.match(/dry\/no-semantic-duplicate/g)?.length).toBe(1);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("class pairs fire for TS and Python", async () => {
  const result = await runFixture("semantic-classes");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-semantic-duplicate/);
  expect(result.out).toMatch(/InvoiceTotals|BillingTotals|compute/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("model load failure with chunks exits 2 naming the rule", async () => {
  const result = await runFixture("semantic-pair", {
    [MODULE_ENV]: "/nonexistent/embed-module.mjs",
  });
  expect(result.code).toBe(2);
  expect(result.err).toMatch(/dry\/no-semantic-duplicate/);
  expect(result.err).toMatch(/code-embeddings/);
});

test("zero embeddable chunks with a broken module succeed", async () => {
  const result = await runFixture("semantic-empty", {
    [MODULE_ENV]: "/nonexistent/embed-module.mjs",
  });
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
