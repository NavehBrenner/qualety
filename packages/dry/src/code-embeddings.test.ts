import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { expect, test } from "vitest";
import {
  collectChunks,
  displayFile,
  normalizeChunkText,
  skipPythonPath,
  skipTypeScriptPath,
} from "./chunks.ts";
import { buildCodeEmbeddingsIndex } from "./code-embeddings.ts";
import { embeddingsCacheDir, readCachedVector, writeCachedVector } from "./embed-cache.ts";
import { MINILM_DIMS, MINILM_ID, modelDir, resolveEmbedModule } from "./embed-module.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "../../..");
const minilmDir = join(repoRoot, ".tools/minilm-l6");
const hasMiniLm = existsSync(join(minilmDir, "onnx", "model_quantized.onnx"));

const sampleFn = `export function computeOrderTotal(
  lines: ReadonlyArray<{ quantity: number; unitPrice: number; taxRate: number }>,
): number {
  let goods = 0;
  let taxes = 0;
  for (const line of lines) {
    const extended = line.quantity * line.unitPrice;
    goods += extended;
    taxes += extended * line.taxRate;
  }
  const freight = goods > 250 ? 0 : 15;
  return goods + taxes + freight;
}
`;

async function typescriptArtifact(dir: string) {
  const abs = join(dir, "src/a.ts");
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });
  const source = project.addSourceFileAtPath(abs);
  return { project, sources: new Map([[abs, source]]) };
}

test("cache hit skips embed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ci-embed-build-"));
  const cacheDir = await mkdtemp(join(tmpdir(), "ci-embed-cache-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/a.ts"), sampleFn);
  const ts = await typescriptArtifact(dir);
  let calls = 0;
  const embedder = {
    id: "stub",
    revision: "1",
    dims: 4,
    async embed(texts: string[]) {
      calls += texts.length;
      return texts.map(() => new Float32Array([1, 0, 0, 0]));
    },
  };
  const options = {
    cwd: dir,
    files: ["src/a.ts"],
    exclude: [],
    requiredBy: ["dry/no-semantic-duplicate"],
    getArtifact: (id: string) => (id === "typescript" ? ts : undefined),
    embedder,
    cacheDir,
  };
  const first = await buildCodeEmbeddingsIndex(options);
  expect(first.chunks.length).toBeGreaterThan(0);
  expect(calls).toBeGreaterThan(0);
  const firstCalls = calls;
  const second = await buildCodeEmbeddingsIndex(options);
  expect(second.chunks.length).toBe(first.chunks.length);
  expect(calls).toBe(firstCalls);
});

test("corrupt cache entry is re-embedded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ci-embed-build-"));
  const cacheDir = await mkdtemp(join(tmpdir(), "ci-embed-cache-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/a.ts"), sampleFn);
  const ts = await typescriptArtifact(dir);
  let calls = 0;
  const embedder = {
    id: "stub",
    revision: "1",
    dims: 4,
    async embed(texts: string[]) {
      calls += texts.length;
      return texts.map(() => new Float32Array([1, 0, 0, 0]));
    },
  };
  const options = {
    cwd: dir,
    files: ["src/a.ts"],
    exclude: [],
    requiredBy: ["dry/no-semantic-duplicate"],
    getArtifact: (id: string) => (id === "typescript" ? ts : undefined),
    embedder,
    cacheDir,
  };
  await buildCodeEmbeddingsIndex(options);
  expect(calls).toBeGreaterThan(0);
  const firstCalls = calls;
  const revisionDir = join(cacheDir, "stub", "1");
  const files = await readdir(revisionDir);
  const firstFile = files[0];
  expect(firstFile).toBeDefined();
  if (firstFile !== undefined) {
    await writeFile(join(revisionDir, firstFile), "not-a-vector");
  }
  await buildCodeEmbeddingsIndex(options);
  expect(calls).toBeGreaterThan(firstCalls);
});

test("readCachedVector rejects wrong length", () => {
  const dir = join(tmpdir(), `ci-embed-bad-${Date.now()}`);
  writeCachedVector(dir, "stub", "1", "abc", new Float32Array([1, 0]));
  expect(readCachedVector(dir, "stub", "1", "abc", 4)).toBeUndefined();
  expect(readCachedVector(dir, "stub", "1", "missing", 2)).toBeUndefined();
});

test("embeddingsCacheDir honors QUALETY_EMBEDDINGS_CACHE and XDG", () => {
  expect(embeddingsCacheDir({ QUALETY_EMBEDDINGS_CACHE: "/tmp/custom-cache" })).toBe(
    "/tmp/custom-cache",
  );
  expect(embeddingsCacheDir({ XDG_CACHE_HOME: "/xdg" })).toBe("/xdg/qualety/code-embeddings");
});

test("normalizeChunkText collapses blank runs", () => {
  expect(normalizeChunkText("  a\n\n\n\nb  ")).toBe("a\n\nb");
});

test("tiny getters are not collected", () => {
  expect(normalizeChunkText("return this.x;").split("\n").length).toBeLessThan(5);
});

test("skip paths match the dry family", () => {
  expect(displayFile("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
  expect(collectChunks("/repo", undefined, undefined)).toEqual([]);
  expect(skipTypeScriptPath("src/a.test.ts", "/repo")).toBe(true);
  expect(skipTypeScriptPath("src/__tests__/a.ts", "/repo")).toBe(true);
  expect(skipTypeScriptPath("src/a.ts", "/repo")).toBe(false);
  expect(skipPythonPath("src/test_invoice.py", "/repo")).toBe(true);
  expect(skipPythonPath("src/tests/billing.py", "/repo")).toBe(true);
  expect(skipPythonPath("src/invoice.py", "/repo")).toBe(false);
});

test.skipIf(!hasMiniLm)(
  "live MiniLM embeds a string",
  async () => {
    const embedder = await resolveEmbedModule(repoRoot, {
      QUALETY_EMBEDDINGS_MODEL: minilmDir,
    });
    expect(embedder.id).toBe(MINILM_ID);
    expect(embedder.dims).toBe(MINILM_DIMS);
    const vectors = await embedder.embed(["hello world from qualety embeddings"]);
    expect(vectors[0]?.length).toBe(MINILM_DIMS);
  },
  120_000,
);

test("modelDir defaults to .tools/minilm-l6", () => {
  expect(modelDir("/repo", {})).toBe("/repo/.tools/minilm-l6");
});
