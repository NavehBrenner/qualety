import { createHash } from "node:crypto";
import type { ArtifactBuildContext, Range } from "qualety";
import { type CodeChunk, collectChunks } from "./chunks.ts";
import { embeddingsCacheDir, readCachedVector, writeCachedVector } from "./embed-cache.ts";
import { type EmbedModule, resolveEmbedModule } from "./embed-module.ts";

// A cold cache used to become one embed() call holding every miss, so the pipeline padded
// the whole repo into a single tensor: this repo is already 647 chunks, and MiniLM's
// per-layer attention at 647 x 512 runs to gigabytes. That does not fail the rule, it takes
// the runner down with it (opencode jobs died on `pnpm qualety` with a runner shutdown,
// exit 143). CI never saw it because actions/cache restores the vectors under a fixed key,
// so misses there are only the touched files. Batch so peak memory tracks the batch size
// rather than the size of the repository.
const EMBED_BATCH = 32;

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
  let embedder: EmbedModule | undefined;
  try {
    embedder = options.embedder ?? (await resolveEmbedModule(options.cwd, env));
    const cacheDir = options.cacheDir ?? embeddingsCacheDir(env);
    const embedded = await embedChunks(chunks, embedder, cacheDir);
    return { chunks: embedded };
  } catch (e) {
    const who = options.requiredBy.join(", ") || "dry/no-semantic-duplicate";
    const detail = e instanceof Error ? e.message : String(e);
    if (detail.includes("dry/no-semantic-duplicate") || detail.includes("code-embeddings")) {
      throw e instanceof Error ? e : new Error(detail);
    }
    throw new Error(
      `Cannot run ${who}: failed to load embeddings module (artifact code-embeddings): ${detail}`,
    );
  } finally {
    await embedder?.dispose?.();
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
  for (let start = 0; start < misses.length; start += EMBED_BATCH) {
    const batch = misses.slice(start, start + EMBED_BATCH);
    const vectors = await embedder.embed(batch.map((item) => item.chunk.text));
    for (let i = 0; i < batch.length; i += 1) {
      const miss = batch[i];
      const vector = vectorAt(vectors, i, embedder.dims);
      if (miss === undefined || vector === undefined) {
        continue;
      }
      writeCachedVector(cacheDir, embedder.id, embedder.revision, miss.hash, vector);
      embedded.push(toEmbedded(miss.chunk, vector));
    }
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
