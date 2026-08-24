import { glob } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_FILENAMES, ConfigError, loadConfig } from "./config.ts";
import { DEFAULT_PROVIDERS } from "./default-providers.ts";
import {
  type ArtifactMap,
  type ArtifactProvider,
  NO_SUGGESTION,
  type Plugin,
  type Rule,
  type Severity,
  type UserConfig,
  type Violation,
} from "./index.ts";
import { isRecord } from "./record.ts";
import { pluginSchema } from "./schemas.ts";

const NOTHING_TO_CHECK = "No rules configured — nothing to check.";
const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];

type Enabled = {
  id: string;
  severity: Exclude<Severity, "off">;
  rule: Rule;
};

type ProviderEntry = {
  provider: ArtifactProvider;
  owner: string;
};

export async function check(
  cwd: string,
  out: (msg: string) => void,
  err: (msg: string) => void,
): Promise<number> {
  try {
    return await runCheck(cwd, out);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

async function runCheck(cwd: string, out: (msg: string) => void): Promise<number> {
  const loaded = await loadConfig(cwd);
  if (loaded === undefined) {
    out(NOTHING_TO_CHECK);
    return 0;
  }
  const { path: configPath, config } = loaded;
  const ruleEntries = Object.entries(config.rules);
  if (ruleEntries.length === 0) {
    out(NOTHING_TO_CHECK);
    return 0;
  }

  const plugins: Plugin[] = [];
  for (const spec of config.plugins) {
    plugins.push(await loadPlugin(spec, dirname(configPath)));
  }
  const enabled = resolveEnabledRules(plugins, config.rules);
  if (enabled.length === 0) {
    out(NOTHING_TO_CHECK);
    return 0;
  }

  const files = await listWorkspaceFiles(cwd, config);
  if (files.length === 0) {
    out("No files to check.");
    return 0;
  }

  const displayPaths = files.map((abs) => displayPath(cwd, abs));
  const artifacts = await buildRequiredArtifacts(plugins, enabled, {
    cwd,
    files: displayPaths,
    exclude: mergedExclude(config),
  });

  const violations: Violation[] = [];
  for (const item of enabled) {
    const allowed = new Set(requiresOf(item));
    function getArtifact<Id extends string>(
      id: Id,
    ): Id extends keyof ArtifactMap ? ArtifactMap[Id] : unknown;
    function getArtifact(id: string): unknown {
      return readArtifact(id, allowed, artifacts);
    }
    item.rule.create({
      id: item.id,
      options: undefined,
      getCwd: () => cwd,
      getFiles: () => displayPaths,
      getArtifact,
      report(violation) {
        violations.push({
          ...violation,
          ruleId: item.id,
          severity: item.severity,
          file: displayPath(cwd, violation.file),
          suggestion: violation.suggestion ?? NO_SUGGESTION,
        });
      },
    });
  }

  violations.sort(compareViolations);
  for (const violation of violations) {
    const loc = `${violation.file}:${violation.range.start.line}:${violation.range.start.column}`;
    const extra =
      violation.suggestion === NO_SUGGESTION ? "" : `\n  suggestion: ${violation.suggestion}`;
    out(`${loc}  ${violation.severity}  ${violation.ruleId}  ${violation.message}${extra}`);
  }
  return violations.length > 0 ? 1 : 0;
}

async function loadPlugin(spec: string, fromDir: string): Promise<Plugin> {
  const target =
    spec.startsWith(".") || spec.startsWith("/")
      ? pathToFileURL(resolve(fromDir, spec)).href
      : spec;
  let loaded: unknown;
  try {
    loaded = await import(target);
  } catch (e) {
    throw new ConfigError(
      `Failed to load plugin "${spec}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const candidate = isRecord(loaded) ? (loaded.default ?? loaded.plugin) : undefined;
  const parsed = pluginSchema.safeParse(candidate);
  requirePlugin(spec, candidate, parsed);
  return candidate;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: assertion plus Zod path dispatch
function requirePlugin(
  spec: string,
  candidate: unknown,
  parsed: ReturnType<typeof pluginSchema.safeParse>,
): asserts candidate is Plugin {
  if (parsed.success) {
    return;
  }
  const name =
    isRecord(candidate) && typeof candidate.name === "string" && candidate.name.length > 0
      ? candidate.name
      : spec;
  for (const issue of parsed.error.issues) {
    if (issue.path.length === 0 || (issue.path.length === 1 && issue.path[0] === "name")) {
      throw new ConfigError(`Module "${spec}" does not export a Plugin (default or "plugin")`);
    }
    if (issue.path[0] === "provides" && issue.path[1] === "") {
      throw new ConfigError(`Plugin "${name}" provides an empty artifact id.`);
    }
    if (
      issue.path[0] === "rules" &&
      typeof issue.path[1] === "string" &&
      issue.path[2] === "meta" &&
      issue.path[3] === "requires"
    ) {
      throw new ConfigError(
        `Rule "${name}/${issue.path[1]}" has invalid requires; must be an array of non-empty artifact ids.`,
      );
    }
  }
  const first = parsed.error.issues[0];
  const zodPath = first === undefined ? "" : first.path.map(String).join(".");
  const detail = first === undefined ? "invalid" : first.message;
  throw new ConfigError(`Plugin "${name}" is invalid (${zodPath}: ${detail}).`);
}

function resolveEnabledRules(plugins: Plugin[], rules: Record<string, Severity>): Enabled[] {
  const catalog = new Map<string, Rule>();
  for (const plugin of plugins) {
    for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
      catalog.set(`${plugin.name}/${name}`, rule);
    }
  }
  const unknown = Object.keys(rules).filter((id) => !catalog.has(id));
  if (unknown.length > 0) {
    throw new ConfigError(
      `Unknown rule id${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. No loaded plugin defines ${unknown.length > 1 ? "these rules" : "this rule"}.`,
    );
  }
  const enabled: Enabled[] = [];
  for (const [id, severity] of Object.entries(rules)) {
    if (severity === "off") {
      continue;
    }
    const rule = catalog.get(id);
    if (rule === undefined) {
      throw new ConfigError(`Unknown rule id: ${id}. No loaded plugin defines this rule.`);
    }
    enabled.push({ id, severity, rule });
  }
  return enabled;
}

function requiresOf(item: Enabled): string[] {
  return item.rule.meta.requires ?? [];
}

async function buildRequiredArtifacts(
  plugins: Plugin[],
  enabled: Enabled[],
  base: { cwd: string; files: readonly string[]; exclude: readonly string[] },
): Promise<Map<string, unknown>> {
  const requiredBy = new Map<string, string[]>();
  for (const item of enabled) {
    for (const id of requiresOf(item)) {
      const list = requiredBy.get(id) ?? [];
      list.push(item.id);
      requiredBy.set(id, list);
    }
  }
  const providers = collectProviders(plugins);
  const artifacts = new Map<string, unknown>();
  for (const [id, rules] of requiredBy) {
    artifacts.set(id, await buildOneArtifact(id, rules, providers, base));
  }
  return artifacts;
}

async function buildOneArtifact(
  id: string,
  rules: string[],
  providers: Map<string, ProviderEntry>,
  base: { cwd: string; files: readonly string[]; exclude: readonly string[] },
): Promise<unknown> {
  const entry = providers.get(id);
  if (entry === undefined) {
    throw new ConfigError(`No provider for artifact "${id}" (required by ${rules.join(", ")}).`);
  }
  try {
    return await entry.provider.build({
      cwd: base.cwd,
      files: base.files,
      exclude: base.exclude,
      requiredBy: rules,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (rules.some((ruleId) => detail.includes(ruleId))) {
      throw e instanceof ConfigError ? e : new ConfigError(detail);
    }
    throw new ConfigError(
      `Failed to build artifact "${id}" (required by ${rules.join(", ")}): ${detail}`,
    );
  }
}

function collectProviders(plugins: Plugin[]): Map<string, ProviderEntry> {
  const providers = new Map<string, ProviderEntry>();
  for (const plugin of plugins) {
    registerPluginProvides(plugin, providers);
  }
  for (const [id, createProvider] of Object.entries(DEFAULT_PROVIDERS)) {
    if (providers.has(id)) {
      continue;
    }
    providers.set(id, { provider: createProvider(), owner: "default" });
  }
  return providers;
}

function registerPluginProvides(plugin: Plugin, providers: Map<string, ProviderEntry>): void {
  const provides = plugin.provides;
  if (provides === undefined) {
    return;
  }
  for (const [id, provider] of Object.entries(provides)) {
    const existing = providers.get(id);
    if (existing !== undefined) {
      throw new ConfigError(
        `Artifact "${id}" is provided by more than one owner (${existing.owner}, ${plugin.name}).`,
      );
    }
    providers.set(id, { provider, owner: plugin.name });
  }
}

function readArtifact(
  id: string,
  allowed: ReadonlySet<string>,
  artifacts: ReadonlyMap<string, unknown>,
): unknown {
  if (!allowed.has(id)) {
    throw new ConfigError(
      `getArtifact(${JSON.stringify(id)}) requires meta.requires to include ${JSON.stringify(id)}`,
    );
  }
  if (!artifacts.has(id)) {
    throw new ConfigError(`Artifact ${JSON.stringify(id)} is not available.`);
  }
  return artifacts.get(id);
}

function mergedExclude(config: UserConfig): string[] {
  return [...new Set([...(config.exclude ?? DEFAULT_EXCLUDE), ...DEFAULT_EXCLUDE])];
}

async function listWorkspaceFiles(cwd: string, config: UserConfig): Promise<string[]> {
  const include = config.include ?? DEFAULT_INCLUDE;
  const exclude = mergedExclude(config);
  const found = new Set<string>();
  for (const pattern of include) {
    for await (const entry of glob(pattern, { cwd, exclude })) {
      const abs = resolve(cwd, entry);
      if (CONFIG_FILENAMES.some((filename) => filename === basename(abs))) {
        continue;
      }
      found.add(abs);
    }
  }
  return [...found].sort();
}

function displayPath(cwd: string, file: string): string {
  const abs = resolve(cwd, file);
  const rel = relative(cwd, abs);
  return (rel === "" ? file : rel).split(sep).join("/");
}

function compareViolations(a: Violation, b: Violation): number {
  return (
    a.file.localeCompare(b.file) ||
    a.range.start.line - b.range.start.line ||
    a.range.start.column - b.range.start.column ||
    a.ruleId.localeCompare(b.ruleId)
  );
}
