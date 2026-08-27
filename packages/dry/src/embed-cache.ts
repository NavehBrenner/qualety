import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CACHE_ENV = "QUALETY_EMBEDDINGS_CACHE";

export function embeddingsCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[CACHE_ENV]?.trim();
  if (override !== undefined) {
    if (override.length > 0) {
      return override;
    }
  }
  const xdg = env.XDG_CACHE_HOME?.trim();
  if (xdg !== undefined) {
    if (xdg.length > 0) {
      return join(xdg, "qualety", "code-embeddings");
    }
  }
  return join(env.HOME ?? homedir(), ".cache", "qualety", "code-embeddings");
}

export function readCachedVector(
  cacheDir: string,
  modelId: string,
  revision: string,
  contentHash: string,
  dims: number,
): Float32Array | undefined {
  try {
    const buf = readFileSync(join(cacheDir, modelId, revision, contentHash));
    if (buf.byteLength !== dims * 4) {
      return undefined;
    }
    const copy = new Float32Array(dims);
    copy.set(new Float32Array(buf.buffer, buf.byteOffset, dims));
    return copy;
  } catch {
    return undefined;
  }
}

export function writeCachedVector(
  cacheDir: string,
  modelId: string,
  revision: string,
  contentHash: string,
  vector: Float32Array,
): void {
  if (contentHash.length > 0) {
    if (vector.length > 0) {
      const dir = join(cacheDir, modelId, revision);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, contentHash),
        Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
      );
    }
  }
}
