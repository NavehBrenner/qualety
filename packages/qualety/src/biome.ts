import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { ConfigError, isStandalone } from "./config.ts";
import type { Plugin, Range, UserConfig, Violation } from "./index.ts";
import { isRecord } from "./record.ts";
import { runTimedCommand } from "./run-command.ts";

const SCAN_TIMEOUT_MS = 60_000;
const GENERATED_DIR = ".qualety";
export const GENERATED_BIOME_PATH = `${GENERATED_DIR}/biome.json`;
const DEFAULT_SUGGESTION = "Apply the Biome finding or override the rule in biome.rules.";
const BIOME_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
]);
const BASELINE_RULES: Record<string, BiomeRuleSetting> = {
  "suspicious/noConfusingVoidType": "off",
};

export type BiomeRuleSetting =
  | "off"
  | "warn"
  | "error"
  | ["off" | "warn" | "error", Record<string, unknown>];

export function biomeEnabled(config: UserConfig): boolean {
  return config.biome !== false;
}

export function resolveBiomeBinary(): string {
  const require = createRequire(import.meta.url);
  try {
    const pkg = require.resolve("@biomejs/biome/package.json");
    return join(dirname(pkg), "bin/biome");
  } catch (e) {
    throw new ConfigError(`Biome is not resolvable: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function assertBiomeRuleId(id: string, owner: string): void {
  const parts = id.split("/");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    throw new ConfigError(
      `Invalid Biome rule id ${JSON.stringify(id)} (${owner}); expected group/name.`,
    );
  }
}

export function mergeBiomeRules(
  plugins: readonly Plugin[],
  userRules: Record<string, BiomeRuleSetting> | undefined,
): Record<string, BiomeRuleSetting> {
  const merged: Record<string, BiomeRuleSetting> = { ...BASELINE_RULES };
  for (const plugin of plugins) {
    const rules = plugin.biome?.rules;
    if (rules === undefined) {
      continue;
    }
    for (const [id, setting] of Object.entries(rules)) {
      assertBiomeRuleId(id, `plugin ${plugin.name}`);
      merged[id] = setting;
    }
  }
  if (userRules !== undefined) {
    for (const [id, setting] of Object.entries(userRules)) {
      assertBiomeRuleId(id, "config.biome.rules");
      merged[id] = setting;
    }
  }
  return merged;
}

export function nestBiomeRules(flat: Record<string, BiomeRuleSetting>): Record<string, unknown> {
  const rules: Record<string, unknown> = { preset: "recommended" };
  for (const [id, setting] of Object.entries(flat)) {
    const slash = id.indexOf("/");
    const group = id.slice(0, slash);
    const name = id.slice(slash + 1);
    const existing = rules[group];
    const groupRules = isRecord(existing) ? existing : {};
    if (!isRecord(existing)) {
      rules[group] = groupRules;
    }
    groupRules[name] =
      typeof setting === "string" ? setting : { level: setting[0], options: setting[1] };
  }
  return rules;
}

export async function writeGeneratedBiomeConfig(
  cwd: string,
  plugins: readonly Plugin[],
  userBiome: UserConfig["biome"],
): Promise<string> {
  const document = biomeConfigDocument(plugins, userBiome);
  await mkdir(join(cwd, GENERATED_DIR), { recursive: true });
  await writeFile(join(cwd, GENERATED_BIOME_PATH), `${JSON.stringify(document, null, 2)}\n`);
  return GENERATED_BIOME_PATH;
}

function biomeConfigDocument(
  plugins: readonly Plugin[],
  userBiome: UserConfig["biome"],
): Record<string, unknown> {
  const userRules = userBiome === false || userBiome === undefined ? undefined : userBiome.rules;
  return {
    vcs: { enabled: false },
    linter: {
      enabled: true,
      rules: nestBiomeRules(mergeBiomeRules(plugins, userRules)),
    },
  };
}

// wasm reports location.path as { file } and leaves sourceCode null. The shared
// mapper wants a string path plus the source text to turn a span into line/column,
// so fill both in here rather than teaching locationOf a second shape.
function normalizeWasmDiagnostic(raw: unknown, file: string, source: string): unknown {
  if (!isRecord(raw)) {
    return raw;
  }
  const location = isRecord(raw.location) ? raw.location : {};
  return { ...raw, location: { ...location, path: file, sourceCode: source } };
}

// The literal specifier is load-bearing: it is what lets bun --compile embed the
// wasm build. Do not collapse it into a computed import.
async function runBiomeWasmPhase(
  cwd: string,
  paths: readonly string[],
  plugins: readonly Plugin[],
  userBiome: UserConfig["biome"],
): Promise<Violation[]> {
  const { loadStandaloneBiome } = await import("./standalone-wasm.ts");
  const Biome = await loadStandaloneBiome();
  const biome = new Biome();
  const { projectKey } = biome.openProject(cwd);
  // Rules are composed from plugin contributions at runtime, so the document cannot
  // match Configuration's static rule map. Biome validates it when the workspace opens.
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: dynamic rule map, validated on open
  biome.applyConfiguration(projectKey, biomeConfigDocument(plugins, userBiome) as never);
  const format = userBiome !== false && userBiome?.format === true;
  const violations: Violation[] = [];
  for (const file of paths) {
    const source = await readFile(join(cwd, file), "utf8");
    for (const raw of biome.lintContent(projectKey, source, { filePath: file }).diagnostics) {
      const mapped = mapDiagnostic(normalizeWasmDiagnostic(raw, file, source));
      if (mapped !== undefined) {
        violations.push(mapped);
      }
    }
    if (format) {
      const formatted = biome.formatContent(projectKey, source, { filePath: file });
      if (formatted.content !== source) {
        violations.push(unformattedViolation(file));
      }
    }
  }
  return violations;
}

function unformattedViolation(file: string): Violation {
  const origin = { line: 1, column: 1 };
  return {
    ruleId: "format",
    severity: "error",
    file,
    range: { start: origin, end: origin },
    message: "File is not formatted.",
    suggestion: "Run `biome format --write` or apply the formatter in your editor.",
  };
}

export async function runBiomePhase(input: {
  cwd: string;
  files: readonly string[];
  plugins: readonly Plugin[];
  biome: UserConfig["biome"];
  bin?: string;
  timeoutMs?: number;
}): Promise<Violation[]> {
  const paths = input.files.filter((file) => BIOME_EXTENSIONS.has(extname(file)));
  if (paths.length === 0) {
    return [];
  }
  if (isStandalone() && input.bin === undefined) {
    return runBiomeWasmPhase(input.cwd, paths, input.plugins, input.biome);
  }
  await writeGeneratedBiomeConfig(input.cwd, input.plugins, input.biome);
  const bin = input.bin ?? resolveBiomeBinary();
  const format = input.biome !== false && input.biome?.format === true;
  const args = [
    format ? "check" : "lint",
    "--config-path",
    GENERATED_BIOME_PATH,
    "--reporter=json",
    "--max-diagnostics=none",
    "--files-ignore-unknown=true",
    ...paths,
  ];
  const timeoutMs = input.timeoutMs ?? SCAN_TIMEOUT_MS;
  const result = await runTimedCommand(bin, args, input.cwd, timeoutMs);
  return mapBiomeStdout(result, timeoutMs);
}

export async function readBiomeVersion(bin: string, cwd: string): Promise<string> {
  const result = await runTimedCommand(bin, ["--version"], cwd, 10_000);
  if (result.timedOut) {
    throw new ConfigError("Biome timed out while reading version.");
  }
  if (result.error !== undefined) {
    throw new ConfigError(`Biome is not runnable: ${result.error}`);
  }
  const text = result.stdout.trim() || result.stderr.trim();
  if (result.code !== 0 || text.length === 0) {
    throw new ConfigError(`Biome is not runnable: ${text || `exit ${result.code}`}`);
  }
  return text.replace(/^Version:\s*/i, "");
}

function mapBiomeStdout(
  result: Awaited<ReturnType<typeof runTimedCommand>>,
  timeoutMs: number,
): Violation[] {
  const { timedOut, error, code, stdout, stderr } = result;
  if (timedOut) {
    throw new ConfigError(`Biome timed out after ${timeoutMs / 1000}s.`);
  }
  if (error !== undefined) {
    throw new ConfigError(`Biome is not runnable: ${error}`);
  }
  if (code !== 0 && code !== 1) {
    const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
    throw new ConfigError(`Biome failed: ${detail}`);
  }
  const text = stdout.trim();
  if (text.length === 0) {
    if (code === 0) {
      return [];
    }
    throw new ConfigError("Biome produced no JSON diagnostics.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(
      `Biome produced invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.diagnostics)
      ? parsed.diagnostics
      : [];
  return items.flatMap((item) => {
    const mapped = mapDiagnostic(item);
    return mapped === undefined ? [] : [mapped];
  });
}

function mapDiagnostic(raw: unknown): Violation | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const category = typeof raw.category === "string" ? raw.category : undefined;
  if (category === undefined) {
    return undefined;
  }
  const loc = locationOf(raw);
  return {
    ruleId: category,
    severity: raw.severity === "warning" || raw.severity === "warn" ? "warn" : "error",
    file: loc.file,
    range: loc.range,
    message: messageOf(raw),
    suggestion: suggestionOf(raw),
  };
}

function messageOf(raw: Record<string, unknown>): string {
  if (typeof raw.description === "string" && raw.description.length > 0) {
    return raw.description;
  }
  if (typeof raw.message === "string" && raw.message.length > 0) {
    return raw.message;
  }
  if (Array.isArray(raw.message)) {
    const text = raw.message
      .map((piece) => (isRecord(piece) && typeof piece.content === "string" ? piece.content : ""))
      .join("");
    if (text.length > 0) {
      return text;
    }
  }
  return "Biome diagnostic";
}

function suggestionOf(raw: Record<string, unknown>): string {
  const advices = raw.advices;
  if (!isRecord(advices) || !Array.isArray(advices.advices)) {
    return DEFAULT_SUGGESTION;
  }
  for (const item of advices.advices) {
    if (!isRecord(item) || !Array.isArray(item.log)) {
      continue;
    }
    const text = item.log.find((piece) => typeof piece === "string" && piece !== "info");
    if (typeof text === "string" && text.length > 0 && !text.includes("\n")) {
      return text;
    }
  }
  return DEFAULT_SUGGESTION;
}

function locationOf(raw: Record<string, unknown>): { file: string; range: Range } {
  const loc = raw.location;
  const origin = { line: 1, column: 1 };
  if (!isRecord(loc)) {
    return { file: ".", range: { start: origin, end: origin } };
  }
  const file = typeof loc.path === "string" && loc.path.length > 0 ? loc.path : ".";
  if (isRecord(loc.start) && typeof loc.start.line === "number") {
    const start = coords(loc.start);
    const end = isRecord(loc.end) ? coords(loc.end) : start;
    return { file, range: { start, end } };
  }
  if (Array.isArray(loc.span) && typeof loc.sourceCode === "string") {
    const startOffset = typeof loc.span[0] === "number" ? loc.span[0] : 0;
    const endOffset = typeof loc.span[1] === "number" ? loc.span[1] : startOffset;
    return {
      file,
      range: {
        start: offsetToCoords(loc.sourceCode, startOffset),
        end: offsetToCoords(loc.sourceCode, endOffset),
      },
    };
  }
  return { file, range: { start: origin, end: origin } };
}

function coords(value: Record<string, unknown>): { line: number; column: number } {
  const line = typeof value.line === "number" ? value.line : 1;
  const column = typeof value.column === "number" ? value.column : 1;
  return { line: line < 1 ? 1 : line, column: column < 1 ? 1 : column };
}

function offsetToCoords(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let i = 0; i < end; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
