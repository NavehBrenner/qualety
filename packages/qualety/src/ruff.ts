import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "smol-toml";
import { ConfigError, isStandalone } from "./config.ts";
import type { Plugin, Range, UserConfig, Violation } from "./index.ts";
import { isRecord } from "./record.ts";

const GENERATED_DIR = ".qualety";
export const GENERATED_RUFF_PATH = `${GENERATED_DIR}/ruff.toml`;
const DEFAULT_SUGGESTION = "Apply the Ruff finding or override the rule in ruff.rules.";
const RUFF_RULE_ID = /^[A-Z]+[0-9]*$/;
const PIN = "@astral-sh/ruff-wasm-nodejs";

export type RuffRuleSetting =
  | "off"
  | "warn"
  | "error"
  | ["off" | "warn" | "error", Record<string, unknown>];

export function ruffEnabled(config: UserConfig): boolean {
  return config.ruff !== false;
}

export function resolveRuffModule(): string {
  const require = createRequire(import.meta.url);
  try {
    return createRequire(require.resolve("@qualety/python/package.json")).resolve(PIN);
  } catch (first) {
    try {
      return require.resolve(PIN);
    } catch (second) {
      const detail = first instanceof Error ? first.message : String(first);
      void second;
      throw new ConfigError(`Ruff is not resolvable: ${detail}`);
    }
  }
}

function assertRuffSetting(id: string, setting: RuffRuleSetting, owner: string): void {
  if (!RUFF_RULE_ID.test(id) || id === "ALL") {
    throw new ConfigError(
      `Invalid Ruff rule id ${JSON.stringify(id)} (${owner}); expected a Ruff code or prefix.`,
    );
  }
  if (typeof setting !== "string" && Object.keys(setting[1]).length > 0) {
    throw new ConfigError(
      `Ruff rule ${JSON.stringify(id)} (${owner}) does not accept options this release.`,
    );
  }
}

export function mergeRuffRules(
  plugins: readonly Plugin[],
  userRules: Record<string, RuffRuleSetting> | undefined,
): Record<string, RuffRuleSetting> {
  const layers: { owner: string; rules: Record<string, RuffRuleSetting> | undefined }[] = [];
  for (const plugin of plugins) {
    layers.push({ owner: `plugin ${plugin.name}`, rules: plugin.ruff?.rules });
  }
  layers.push({ owner: "config.ruff.rules", rules: userRules });
  const merged: Record<string, RuffRuleSetting> = {};
  for (const layer of layers) {
    if (layer.rules === undefined) {
      continue;
    }
    for (const [id, setting] of Object.entries(layer.rules)) {
      assertRuffSetting(id, setting, layer.owner);
      merged[id] = setting;
    }
  }
  return merged;
}

function ruffLintDeltas(merged: Record<string, RuffRuleSetting>): {
  extendSelect: string[];
  ignore: string[];
} {
  const extendSelect: string[] = [];
  const ignore: string[] = [];
  for (const id of Object.keys(merged).sort()) {
    const setting = merged[id];
    if (setting === undefined) {
      continue;
    }
    const severity = typeof setting === "string" ? setting : setting[0];
    if (severity === "off") {
      ignore.push(id);
    } else {
      extendSelect.push(id);
    }
  }
  return { extendSelect, ignore };
}

type ProjectRuffSlice = {
  select?: string[];
  extendSelect?: string[];
  ignore?: string[];
  extendIgnore?: string[];
  isort?: Record<string, unknown>;
};

export function serializeRuffToml(
  merged: Record<string, RuffRuleSetting>,
  project?: ProjectRuffSlice,
): string {
  const lint = ruffLintSettings(merged, project);
  return Object.keys(lint).length === 0 ? "" : stringify({ lint });
}

export async function writeGeneratedRuffConfig(
  cwd: string,
  plugins: readonly Plugin[],
  userRuff: UserConfig["ruff"],
): Promise<string> {
  const userRules = userRuff === false || userRuff === undefined ? undefined : userRuff.rules;
  return writeRuffToml(cwd, mergeRuffRules(plugins, userRules), await loadProjectRuffSlice(cwd));
}

export async function runRuffPhase(input: {
  cwd: string;
  files: readonly string[];
  plugins: readonly Plugin[];
  ruff: UserConfig["ruff"];
  modulePath?: string;
}): Promise<Violation[]> {
  const paths = input.files.filter((file) => extname(file) === ".py");
  if (paths.length === 0) {
    return [];
  }
  const userRules = input.ruff === false || input.ruff === undefined ? undefined : input.ruff.rules;
  const merged = mergeRuffRules(input.plugins, userRules);
  const format = input.ruff !== false && input.ruff?.format === true;
  const project = await loadProjectRuffSlice(input.cwd);
  const wasm = await loadRuffWasm(input.modulePath);
  let workspace: ReturnType<(typeof wasm)["open"]>;
  let usedProject = project;
  try {
    workspace = wasm.open(workspaceSettings(merged, project));
  } catch (error) {
    if (project === undefined || !hasInheritedFields(project)) {
      throw error;
    }
    usedProject = undefined;
    workspace = wasm.open(workspaceSettings(merged));
  }
  await writeRuffToml(input.cwd, merged, usedProject);
  try {
    const violations: Violation[] = [];
    for (const file of paths) {
      violations.push(...(await lintPythonFile(workspace, input.cwd, file, format, merged)));
    }
    return violations;
  } finally {
    workspace.free();
  }
}

export async function readRuffVersion(modulePath?: string): Promise<string> {
  try {
    const wasm = await loadRuffWasm(modulePath);
    const version = wasm.version();
    if (typeof version !== "string" || version.length === 0) {
      throw new ConfigError("Ruff is not runnable: empty version");
    }
    return version;
  } catch (e) {
    if (e instanceof ConfigError) {
      throw e;
    }
    throw new ConfigError(`Ruff is not runnable: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function loadRuffWasm(modulePath?: string) {
  let loaded: unknown;
  try {
    // The literal specifier is load-bearing: it is what lets bun --compile embed
    // the wasm build. The resolve path stays for node, where ruff-wasm belongs to
    // @qualety/python and must not become a hard dependency of the core package.
    loaded =
      isStandalone() && modulePath === undefined
        ? await (await import("./standalone-wasm.ts")).loadStandaloneRuff()
        : await import(pathToFileURL(modulePath ?? resolveRuffModule()).href);
  } catch (e) {
    throw new ConfigError(`Ruff is not runnable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const namespace =
    isRecord(loaded) && isRecord(loaded.default) && typeof loaded.default.Workspace === "function"
      ? loaded.default
      : loaded;
  const Workspace = isRecord(namespace) ? namespace.Workspace : undefined;
  const versionFn = typeof Workspace === "function" ? Reflect.get(Workspace, "version") : undefined;
  if (typeof Workspace !== "function" || typeof versionFn !== "function") {
    throw new ConfigError("Ruff is not runnable: Workspace export missing.");
  }
  return {
    version: versionFn.bind(Workspace),
    open(settings: unknown) {
      const instance: unknown = Reflect.construct(Workspace, [settings, 0]);
      if (
        !isRecord(instance) ||
        typeof instance.check !== "function" ||
        typeof instance.format !== "function" ||
        typeof instance.free !== "function"
      ) {
        throw new ConfigError("Ruff is not runnable: Workspace instance missing methods.");
      }
      const check = instance.check;
      const format = instance.format;
      const free = instance.free;
      return {
        check: (contents: string) => Reflect.apply(check, instance, [contents]),
        format: (contents: string) => String(Reflect.apply(format, instance, [contents])),
        free: () => {
          Reflect.apply(free, instance, []);
        },
      };
    },
  };
}

function workspaceSettings(
  merged: Record<string, RuffRuleSetting>,
  project?: ProjectRuffSlice,
): Record<string, unknown> {
  const lint = ruffLintSettings(merged, project);
  return Object.keys(lint).length === 0 ? {} : { lint };
}

function ruffLintSettings(
  merged: Record<string, RuffRuleSetting>,
  project: ProjectRuffSlice | undefined,
): Record<string, unknown> {
  const { extendSelect, ignore } = ruffLintDeltas(merged);
  const lint: Record<string, unknown> = {};
  if (project?.select !== undefined) {
    lint.select = project.select;
  }
  const combinedExtendSelect = [...(project?.extendSelect ?? []), ...extendSelect];
  if (combinedExtendSelect.length > 0) {
    lint["extend-select"] = combinedExtendSelect;
  }
  const combinedIgnore = [...(project?.ignore ?? []), ...ignore];
  if (combinedIgnore.length > 0) {
    lint.ignore = combinedIgnore;
  }
  if (project?.extendIgnore !== undefined && project.extendIgnore.length > 0) {
    lint["extend-ignore"] = project.extendIgnore;
  }
  if (project?.isort !== undefined) {
    lint.isort = project.isort;
  }
  return lint;
}

async function writeRuffToml(
  cwd: string,
  merged: Record<string, RuffRuleSetting>,
  project: ProjectRuffSlice | undefined,
): Promise<string> {
  await mkdir(join(cwd, GENERATED_DIR), { recursive: true });
  await writeFile(join(cwd, GENERATED_RUFF_PATH), serializeRuffToml(merged, project));
  return GENERATED_RUFF_PATH;
}

async function loadProjectRuffSlice(cwd: string): Promise<ProjectRuffSlice | undefined> {
  for (const name of ["ruff.toml", ".ruff.toml"] as const) {
    const document = await readTomlDocument(join(cwd, name));
    if (document === "missing") {
      continue;
    }
    if (document === "invalid") {
      return undefined;
    }
    return sliceProjectRuff(document);
  }
  const document = await readTomlDocument(join(cwd, "pyproject.toml"));
  if (document === "missing" || document === "invalid") {
    return undefined;
  }
  const tool = document.tool;
  if (!isRecord(tool) || !isRecord(tool.ruff)) {
    return undefined;
  }
  return sliceProjectRuff(tool.ruff);
}

async function readTomlDocument(
  path: string,
): Promise<Record<string, unknown> | "missing" | "invalid"> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return isNotFound(error) ? "missing" : "invalid";
  }
  try {
    const value = parse(text);
    return isRecord(value) ? value : "invalid";
  } catch {
    return "invalid";
  }
}

function sliceProjectRuff(root: Record<string, unknown>): ProjectRuffSlice {
  const lint = isRecord(root.lint) ? root.lint : undefined;
  const slice: ProjectRuffSlice = {};
  const select = pickStringArray(lint, root, "select");
  if (select !== undefined) {
    slice.select = select;
  }
  const extendSelect = pickStringArray(lint, root, "extend-select");
  if (extendSelect !== undefined) {
    slice.extendSelect = extendSelect;
  }
  const ignore = pickStringArray(lint, root, "ignore");
  if (ignore !== undefined) {
    slice.ignore = ignore;
  }
  const extendIgnore = pickStringArray(lint, root, "extend-ignore");
  if (extendIgnore !== undefined) {
    slice.extendIgnore = extendIgnore;
  }
  const isort = pickIsortTable(lint, root);
  if (isort !== undefined) {
    slice.isort = isort;
  }
  return slice;
}

function pickStringArray(
  lint: Record<string, unknown> | undefined,
  root: Record<string, unknown>,
  key: string,
): string[] | undefined {
  if (lint !== undefined && Object.hasOwn(lint, key)) {
    return stringArray(lint[key]);
  }
  return stringArray(root[key]);
}

function pickIsortTable(
  lint: Record<string, unknown> | undefined,
  root: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (lint !== undefined && Object.hasOwn(lint, "isort")) {
    return isRecord(lint.isort) ? lint.isort : undefined;
  }
  return isRecord(root.isort) ? root.isort : undefined;
}

function hasInheritedFields(project: ProjectRuffSlice): boolean {
  return (
    project.select !== undefined ||
    (project.extendSelect !== undefined && project.extendSelect.length > 0) ||
    (project.ignore !== undefined && project.ignore.length > 0) ||
    (project.extendIgnore !== undefined && project.extendIgnore.length > 0) ||
    project.isort !== undefined
  );
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value;
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function lintPythonFile(
  workspace: {
    check(contents: string): unknown;
    format(contents: string): string;
    free(): void;
  },
  cwd: string,
  file: string,
  format: boolean,
  merged: Record<string, RuffRuleSetting>,
): Promise<Violation[]> {
  let contents: string;
  try {
    contents = await readFile(join(cwd, file), "utf8");
  } catch (e) {
    throw new ConfigError(
      `Ruff could not read ${JSON.stringify(file)}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const violations = mapRuffCheck(workspace.check(contents), file, merged);
  if (!format) {
    return violations;
  }
  let formatted: string | undefined;
  try {
    formatted = workspace.format(contents);
  } catch {
    formatted = undefined;
  }
  if (formatted !== undefined && formatted !== contents) {
    const origin = { line: 1, column: 1 };
    violations.push({
      ruleId: "format",
      severity: "error",
      file,
      range: { start: origin, end: origin },
      message: "File would be reformatted by Ruff.",
      suggestion: "Apply Ruff format or set ruff.format to false.",
    });
  }
  return violations;
}

function mapRuffCheck(
  raw: unknown,
  file: string,
  merged: Record<string, RuffRuleSetting>,
): Violation[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const violations: Violation[] = [];
  for (const item of raw) {
    const mapped = mapRuffDiagnostic(item, file, merged);
    if (mapped !== undefined) {
      violations.push(mapped);
    }
  }
  return violations;
}

function mapRuffDiagnostic(
  raw: unknown,
  file: string,
  merged: Record<string, RuffRuleSetting>,
): Violation | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const code = typeof raw.code === "string" && raw.code.length > 0 ? raw.code : undefined;
  if (code === undefined) {
    return undefined;
  }
  const setting = settingFor(code, merged);
  const severityName =
    setting === undefined ? "error" : typeof setting === "string" ? setting : setting[0];
  if (severityName === "off") {
    return undefined;
  }
  const fix = raw.fix;
  return {
    ruleId: code,
    severity: severityName === "warn" ? "warn" : "error",
    file,
    range: ruffRange(raw),
    message:
      typeof raw.message === "string" && raw.message.length > 0 ? raw.message : "Ruff diagnostic",
    suggestion:
      isRecord(fix) && typeof fix.message === "string" && fix.message.length > 0
        ? fix.message
        : DEFAULT_SUGGESTION,
  };
}

function settingFor(
  code: string,
  merged: Record<string, RuffRuleSetting>,
): RuffRuleSetting | undefined {
  const exact = merged[code];
  if (exact !== undefined) {
    return exact;
  }
  let best: string | undefined;
  for (const id of Object.keys(merged)) {
    if (!code.startsWith(id) || (best !== undefined && id.length <= best.length)) {
      continue;
    }
    if (/^[0-9]*$/.test(code.slice(id.length))) {
      best = id;
    }
  }
  return best === undefined ? undefined : merged[best];
}

function ruffRange(raw: Record<string, unknown>): Range {
  const startRaw = raw.start_location;
  const start = isRecord(startRaw)
    ? {
        line: typeof startRaw.row === "number" && startRaw.row >= 1 ? startRaw.row : 1,
        column: typeof startRaw.column === "number" && startRaw.column >= 1 ? startRaw.column : 1,
      }
    : { line: 1, column: 1 };
  const endRaw = raw.end_location;
  if (!isRecord(endRaw)) {
    return { start, end: start };
  }
  return {
    start,
    end: {
      line: typeof endRaw.row === "number" && endRaw.row >= 1 ? endRaw.row : 1,
      column: typeof endRaw.column === "number" && endRaw.column >= 1 ? endRaw.column : 1,
    },
  };
}
