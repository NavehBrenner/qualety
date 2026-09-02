import type { Dirent } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "./record.ts";

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "venv",
  ".venv",
  "dist",
  "build",
  "__pycache__",
  ".qualety",
]);
const REQUIREMENTS_TXT = /^requirements(?:-.*)?\.txt$/;
const TSCONFIG_JSON = /^tsconfig(?:\..+)?\.json$/;
const MAX_WALK_DEPTH = 8;
const MAX_FILES_VISITED = 2000;
const DEP_BAGS = ["dependencies", "devDependencies", "peerDependencies"] as const;

type InitFlags = {
  python: boolean;
  typescript: boolean;
  react: boolean;
};

type WalkState = {
  filesVisited: number;
  flags: InitFlags;
};

export async function detectInitPlugins(cwd: string): Promise<string[]> {
  const flags: InitFlags = { python: false, typescript: false, react: false };
  await walkDir(cwd, 0, { filesVisited: 0, flags });
  const plugins: string[] = [];
  if (flags.typescript) {
    plugins.push("@qualety/typescript");
  }
  if (flags.react) {
    plugins.push("@qualety/react");
  }
  if (flags.python) {
    plugins.push("@qualety/python");
  }
  return plugins;
}

export async function writeInitConfig(cwd: string, plugins: readonly string[]): Promise<string> {
  const relativePath = "qualety.config.json";
  await writeFile(join(cwd, relativePath), `${JSON.stringify({ plugins }, null, 2)}\n`);
  return relativePath;
}

async function walkDir(dir: string, depth: number, state: WalkState): Promise<void> {
  if (depth > MAX_WALK_DEPTH || state.filesVisited >= MAX_FILES_VISITED) {
    return;
  }
  if (depth > 0 && languagesFound(state.flags)) {
    return;
  }
  for (const entry of await listDirents(dir)) {
    if (state.filesVisited >= MAX_FILES_VISITED) {
      return;
    }
    state.filesVisited++;
    await visitEntry(dir, depth, entry, state);
  }
}

async function listDirents(dir: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return entries;
  } catch {
    return [];
  }
}

async function visitEntry(
  dir: string,
  depth: number,
  entry: Dirent,
  state: WalkState,
): Promise<void> {
  if (entry.isDirectory()) {
    if (shouldSkipDir(entry, state.flags)) {
      return;
    }
    await walkDir(join(dir, entry.name), depth + 1, state);
    return;
  }
  if (depth === 0) {
    applyRootMarker(entry.name, state.flags);
    if (entry.name === "package.json") {
      await applyPackageJson(join(dir, entry.name), state.flags);
    }
  }
  applySourceName(entry.name, state.flags);
}

function shouldSkipDir(entry: Dirent, flags: InitFlags): boolean {
  return SKIP_DIR_NAMES.has(entry.name) || entry.isSymbolicLink() || languagesFound(flags);
}

function languagesFound(flags: InitFlags): boolean {
  return flags.python && flags.typescript;
}

function applyRootMarker(name: string, flags: InitFlags): void {
  if (name === "pyproject.toml" || name === "setup.cfg" || REQUIREMENTS_TXT.test(name)) {
    flags.python = true;
  }
  if (TSCONFIG_JSON.test(name)) {
    flags.typescript = true;
  }
}

function applySourceName(name: string, flags: InitFlags): void {
  if (name.endsWith(".py")) {
    flags.python = true;
  } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
    flags.typescript = true;
  }
}

async function applyPackageJson(path: string, flags: InitFlags): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return;
  }
  if (!isRecord(raw)) {
    return;
  }
  if (depBagHas(raw, "typescript")) {
    flags.typescript = true;
  }
  if (depBagHas(raw, "react")) {
    flags.react = true;
  }
}

function depBagHas(pkg: Record<string, unknown>, name: string): boolean {
  for (const key of DEP_BAGS) {
    const bag = pkg[key];
    if (isRecord(bag) && name in bag) {
      return true;
    }
  }
  return false;
}
