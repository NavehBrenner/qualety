import { createHash } from "node:crypto";
import type { ArtifactBuildContext, Range } from "qualety";
import { type CodeChunk, collectChunks } from "./chunks.ts";
import { embeddingsCacheDir, readCachedVector, writeCachedVector } from "./embed-cache.ts";
import { type EmbedModule, resolveEmbedModule } from "./embed-module.ts";

export type EmbeddedChunk = {
  path: string;
  name: string;
  lang: "ts" | "python";
  range: Range;
  vector: Float32Array;
};

export type CodeEmbeddingsIndex = {
  chunks: readonly EmbeddedChunk[];
};

declare module "qualety" {
  interface ArtifactMap {
    "code-embeddings": CodeEmbeddingsIndex;
  }
}

export type BuildCodeEmbeddingsOptions = ArtifactBuildContext & {
  embedder?: EmbedModule;
  cacheDir?: string;
  env?: NodeJS.ProcessEnv;
};

export async function buildCodeEmbeddingsIndex(
  options: BuildCodeEmbeddingsOptions,
): Promise<CodeEmbeddingsIndex> {
  const chunks = collectChunks(
    options.cwd,
    options.getArtifact("typescript"),
    options.getArtifact("python"),
  );
  if (chunks.length === 0) {
    return { chunks: [] };
  }
  const env = options.env ?? process.env;
  let embedder: EmbedModule;
  try {
    embedder = options.embedder ?? (await resolveEmbedModule(options.cwd, env));
  } catch (e) {
    throw wrapLoad(e, options.requiredBy);
  }
  const cacheDir = options.cacheDir ?? embeddingsCacheDir(env);
  try {
    const embedded = await embedChunks(chunks, embedder, cacheDir);
    return { chunks: embedded };
  } catch (e) {
    throw wrapLoad(e, options.requiredBy);
  }
}

async function embedChunks(
  chunks: readonly CodeChunk[],
  embedder: EmbedModule,
  cacheDir: string,
): Promise<EmbeddedChunk[]> {
  const hashes = chunks.map((chunk) =>
    createHash("sha256").update(chunk.text, "utf8").digest("hex"),
  );
  const embedded: EmbeddedChunk[] = [];
  const misses: { chunk: CodeChunk; hash: string }[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const hash = hashes[i];
    if (chunk === undefined || hash === undefined) {
      continue;
    }
    const cached = readCachedVector(cacheDir, embedder.id, embedder.revision, hash, embedder.dims);
    if (cached !== undefined) {
      embedded.push(toEmbedded(chunk, cached));
      continue;
    }
    misses.push({ chunk, hash });
  }
  if (misses.length === 0) {
    return embedded;
  }
  const vectors = await embedder.embed(misses.map((item) => item.chunk.text));
  for (let i = 0; i < misses.length; i += 1) {
    const miss = misses[i];
    const vector = vectorAt(vectors, i, embedder.dims);
    if (miss === undefined || vector === undefined) {
      continue;
    }
    writeCachedVector(cacheDir, embedder.id, embedder.revision, miss.hash, vector);
    embedded.push(toEmbedded(miss.chunk, vector));
  }
  embedded.sort(
    (left, right) => left.path.localeCompare(right.path) || left.name.localeCompare(right.name),
  );
  return embedded;
}

function toEmbedded(chunk: CodeChunk, vector: Float32Array): EmbeddedChunk {
  return {
    path: chunk.path,
    name: chunk.name,
    lang: chunk.lang,
    range: chunk.range,
    vector,
  };
}

function vectorAt(
  vectors: readonly Float32Array[],
  index: number,
  dims: number,
): Float32Array | undefined {
  const vector = vectors[index];
  if (!(vector instanceof Float32Array) || vector.length !== dims) {
    return undefined;
  }
  for (const value of vector) {
    if (Number.isNaN(value)) {
      return undefined;
    }
  }
  return vector;
}

function wrapLoad(e: unknown, requiredBy: readonly string[]): Error {
  const who = requiredBy.join(", ") || "dry/no-semantic-duplicate";
  const detail = e instanceof Error ? e.message : String(e);
  if (detail.includes("dry/no-semantic-duplicate") || detail.includes("code-embeddings")) {
    return e instanceof Error ? e : new Error(detail);
  }
  return new Error(
    `Cannot run ${who}: failed to load embeddings module (artifact code-embeddings): ${detail}`,
  );
}
