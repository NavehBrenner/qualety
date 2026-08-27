import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MINILM_ID = "minilm-l6-local";
const MINILM_REVISION = "onnx-quantized-1";
export const MINILM_DIMS = 384;
export const MODULE_ENV = "QUALETY_EMBEDDINGS_MODULE";
const MODEL_ENV = "QUALETY_EMBEDDINGS_MODEL";

export type EmbedModule = {
  id: string;
  revision: string;
  dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
};

export async function resolveEmbedModule(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EmbedModule> {
  const stub = env[MODULE_ENV]?.trim();
  if (stub !== undefined) {
    if (stub.length > 0) {
      return loadStubModule(isAbsolute(stub) ? stub : resolve(cwd, stub));
    }
  }
  return loadMiniLmModule(modelDir(cwd, env));
}

export function modelDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MODEL_ENV]?.trim();
  if (override !== undefined) {
    if (override.length > 0) {
      return isAbsolute(override) ? override : resolve(cwd, override);
    }
  }
  return join(cwd, ".tools", "minilm-l6");
}

async function loadStubModule(path: string): Promise<EmbedModule> {
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path).href);
  } catch (e) {
    throw new Error(`cannot import ${MODULE_ENV} module at ${path}: ${detail(e)}`);
  }
  const module = embedModuleFrom(loaded);
  if (module === undefined) {
    throw new Error(`${MODULE_ENV} module at ${path} does not implement EmbedModule`);
  }
  return module;
}

async function loadMiniLmModule(dir: string): Promise<EmbedModule> {
  const weights = join(dir, "onnx", "model_quantized.onnx");
  if (!existsSync(weights)) {
    throw new Error(
      `local MiniLM weights not found at ${dir}. Run scripts/install-minilm.sh or set ${MODEL_ENV}.`,
    );
  }
  const transformers = await importTransformers();
  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true;
  let extractor: (texts: string[], options: Record<string, unknown>) => Promise<unknown>;
  try {
    extractor = await transformers.pipeline("feature-extraction", dir, { dtype: "q8" });
  } catch (e) {
    throw new Error(`failed to load local MiniLM at ${dir}: ${detail(e)}`);
  }
  return {
    id: MINILM_ID,
    revision: MINILM_REVISION,
    dims: MINILM_DIMS,
    embed: async (texts) => {
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      return vectorsFromTensor(output, texts.length, MINILM_DIMS);
    },
  };
}

async function importTransformers(): Promise<{
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<(texts: string[], options: Record<string, unknown>) => Promise<unknown>>;
  env: Record<string, unknown>;
}> {
  try {
    const loaded: unknown = await import("@huggingface/transformers");
    if (!isRecord(loaded) || typeof loaded.pipeline !== "function" || !isRecord(loaded.env)) {
      throw new Error("unexpected module shape");
    }
    const pipeline = loaded.pipeline;
    const env = loaded.env;
    return {
      pipeline: async (task, model, options) => {
        const extractor: unknown = await pipeline(task, model, options);
        if (typeof extractor !== "function") {
          throw new Error("pipeline did not return a function");
        }
        return (texts, extractOptions) => Promise.resolve(extractor(texts, extractOptions));
      },
      env,
    };
  } catch (e) {
    throw new Error(`failed to import @huggingface/transformers: ${detail(e)}`);
  }
}

function embedModuleFrom(value: unknown): EmbedModule | undefined {
  const candidate = isRecord(value) && "default" in value ? value.default : value;
  if (
    !isRecord(candidate) ||
    typeof candidate.id !== "string" ||
    typeof candidate.revision !== "string" ||
    typeof candidate.dims !== "number" ||
    typeof candidate.embed !== "function"
  ) {
    return undefined;
  }
  const id = candidate.id;
  const revision = candidate.revision;
  const dims = candidate.dims;
  const embed = candidate.embed;
  return {
    id,
    revision,
    dims,
    embed: async (texts) => {
      const result: unknown = await embed(texts);
      return Array.isArray(result) ? result : [];
    },
  };
}

function vectorsFromTensor(output: unknown, count: number, dims: number): Float32Array[] {
  if (isRecord(output) && output.data instanceof Float32Array) {
    const data = output.data;
    if (data.length < count * dims) {
      return [];
    }
    const out: Float32Array[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push(data.slice(i * dims, (i + 1) * dims));
    }
    return out;
  }
  if (Array.isArray(output)) {
    return output.filter((item) => item instanceof Float32Array);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detail(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
