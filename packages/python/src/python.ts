import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { type ArtifactBuildContext, runTimedCommand } from "qualety";

const SCAN_TIMEOUT_MS = 60_000;

export type PythonNode = {
  readonly _type: string;
  readonly [key: string]: unknown;
};

export type PythonSource = {
  file: string;
  text: string;
  tree: PythonNode;
  packageDir: string;
};

export type ParsedPythonProject = {
  sources: ReadonlyMap<string, PythonSource>;
};

declare module "qualety" {
  interface ArtifactMap {
    python: ParsedPythonProject;
  }
}

export type BuildPythonOptions = ArtifactBuildContext & {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

const DUMP_SCRIPT = `
import ast, json, sys

def convert(node):
    if isinstance(node, ast.AST):
        d = {"_type": type(node).__name__}
        lineno = getattr(node, "lineno", None)
        if lineno is not None:
            d["lineno"] = lineno
            d["col_offset"] = getattr(node, "col_offset", 0)
            d["end_lineno"] = getattr(node, "end_lineno", None)
            d["end_col_offset"] = getattr(node, "end_col_offset", None)
        for field, value in ast.iter_fields(node):
            d[field] = convert(value)
        return d
    if isinstance(node, list):
        return [convert(x) for x in node]
    if isinstance(node, (str, int, float, bool)) or node is None:
        return node
    return repr(node)

paths = json.load(sys.stdin)
out = []
for path in paths:
    try:
        text = open(path, encoding="utf-8").read()
        tree = ast.parse(text, filename=path)
    except (SyntaxError, UnicodeDecodeError, OSError):
        continue
    out.append({"file": path, "text": text, "tree": convert(tree)})
json.dump(out, sys.stdout)
`.trim();

export async function buildPythonProject(
  options: BuildPythonOptions,
): Promise<ParsedPythonProject> {
  const paths = pythonFiles(options.cwd, options.files);
  if (paths.length === 0) {
    return { sources: new Map() };
  }
  const requiredBy = options.requiredBy;
  const timeoutMs = options.timeoutMs ?? SCAN_TIMEOUT_MS;
  let stdout: string;
  try {
    stdout = await dumpAst(paths, options.cwd, options.env ?? process.env, timeoutMs);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const who = byLabel(requiredBy);
    if (detail.startsWith("timeout:")) {
      throw new Error(`python3 timed out after ${timeoutMs / 1000}s (required by ${who}).`);
    }
    if (detail.startsWith("failed:")) {
      throw new Error(`python3 failed (required by ${who}): ${detail.slice("failed:".length)}`);
    }
    throw new Error(`python3 is not runnable (required by ${who}): ${detail}`);
  }
  let dumped: unknown;
  try {
    dumped = JSON.parse(stdout);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `python3 produced invalid JSON (required by ${byLabel(requiredBy)}): ${detail}`,
    );
  }
  return { sources: sourcesFromDump(dumped, options.cwd, requiredBy) };
}

async function dumpAst(
  paths: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string> {
  const result = await runTimedCommand("python3", ["-c", DUMP_SCRIPT], cwd, timeoutMs, {
    env,
    stdin: JSON.stringify(paths),
  });
  if (result.timedOut) {
    throw new Error("timeout:");
  }
  if (result.error !== undefined) {
    throw new Error(result.error);
  }
  if (result.code !== 0) {
    throw new Error(`failed:${result.stderr.trim() || `exit ${result.code}`}`);
  }
  return result.stdout;
}

function pythonFiles(cwd: string, files: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const abs = resolve(cwd, file);
    if (extname(abs) !== ".py" || abs.split(/[/\\]/).includes("__pycache__")) {
      continue;
    }
    out.push(abs);
  }
  return out;
}

function sourcesFromDump(
  dumped: unknown,
  cwd: string,
  requiredBy: readonly string[],
): Map<string, PythonSource> {
  if (!Array.isArray(dumped)) {
    throw new Error(
      `python3 produced invalid JSON (required by ${byLabel(requiredBy)}): root must be an array`,
    );
  }
  const sources = new Map<string, PythonSource>();
  for (const item of dumped) {
    if (!isRecord(item) || typeof item.file !== "string" || typeof item.text !== "string") {
      continue;
    }
    const tree = item.tree;
    if (!isRecord(tree) || typeof tree._type !== "string") {
      continue;
    }
    const file = resolve(cwd, item.file);
    sources.set(file, {
      file,
      text: item.text,
      tree: { ...tree, _type: tree._type },
      packageDir: findPackageDir(file, cwd),
    });
  }
  return sources;
}

function findPackageDir(absFile: string, cwd: string): string {
  const root = resolve(cwd);
  let dir = dirname(absFile);
  while (true) {
    if (existsSync(join(dir, "pyproject.toml"))) {
      return dir;
    }
    if (dir === root) {
      return root;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return root;
    }
    dir = parent;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byLabel(ids: readonly string[]): string {
  const label = ids.join(", ");
  return label === "" ? "a python-backed rule" : label;
}
