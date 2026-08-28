import { glob } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { expandCompanions } from "./companion-closure.ts";
import { CONFIG_FILENAMES, ConfigError, loadConfig } from "./config.ts";
import { DEFAULT_PROVIDERS } from "./default-providers.ts";
import { listGitSeed } from "./git-seed.ts";
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
import { compileRuleOptions } from "./rule-options.ts";
import { pluginSchema } from "./schemas.ts";
import { expandTypeScriptClosure } from "./typescript-frontend.ts";

declare const STANDALONE: boolean;

const NOTHING_TO_CHECK = "No rules configured — nothing to check.";
const NO_RULES_MATCHED = "No rules matched filters.";
const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.py"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];
const officialLoaders: Record<string, () => Promise<unknown>> = {
  "@qualety/typescript": () =>
    // @ts-expect-error official plugin; not a qualety dependency
    import("@qualety/typescript"),
  "@qualety/react": () =>
    // @ts-expect-error official plugin; not a qualety dependency
    import("@qualety/react"),
  "@qualety/dry": () =>
    // @ts-expect-error official plugin; not a qualety dependency
    import("@qualety/dry"),
  "@qualety/python": () =>
    // @ts-expect-error official plugin; not a qualety dependency
    import("@qualety/python"),
};

export type CheckFilters = {
  plugins: string[];
  excludePlugins: string[];
  rules: string[];
  diff: "off" | "upstream" | "worktree";
};

const EMPTY_FILTERS: CheckFilters = {
  plugins: [],
  excludePlugins: [],
  rules: [],
  diff: "off",
};

type Enabled = {
  id: string;
  severity: Exclude<Severity, "off">;
  rule: Rule;
  options: unknown;
};

type ProviderEntry = {
  provider: ArtifactProvider;
  owner: string;
};

export async function check(
  cwd: string,
  out: (msg: string) => void,
  err: (msg: string) => void,
  filters: CheckFilters = EMPTY_FILTERS,
): Promise<number> {
  try {
    const loaded = await loadConfig(cwd);
    if (loaded === undefined) {
      if (hasNameFilters(filters)) {
        assertKnownFilters([], [], filters);
      }
      out(NOTHING_TO_CHECK);
      return 0;
    }
    const { path: configPath, config } = loaded;
    if (Object.keys(config.rules).length === 0 && !hasNameFilters(filters)) {
      out(NOTHING_TO_CHECK);
      return 0;
    }

    const plugins: Plugin[] = [];
    for (const spec of config.plugins) {
      plugins.push(await loadPlugin(spec, dirname(configPath)));
    }
    const enabled = resolveEnabledRules(plugins, config.rules);
    assertKnownFilters(plugins, enabled, filters);
    const selected = selectRules(enabled, filters);
    if (selected.length === 0) {
      out(hasNameFilters(filters) ? NO_RULES_MATCHED : NOTHING_TO_CHECK);
      return 0;
    }

    const files = await listCheckFiles(cwd, config, filters.diff);
    if (files.length === 0) {
      out("No files to check.");
      return 0;
    }

    const displayPaths = files.map((abs) => displayPath(cwd, abs));
    const artifacts = await buildRequiredArtifacts(plugins, selected, {
      cwd,
      files: displayPaths,
      exclude: mergedExclude(config),
    });

    const violations = collectViolations(selected, cwd, displayPaths, artifacts);
    printViolations(violations, out);
    return violations.length > 0 ? 1 : 0;
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

function collectViolations(
  selected: readonly Enabled[],
  cwd: string,
  displayPaths: readonly string[],
  artifacts: Map<string, unknown>,
): Violation[] {
  const violations: Violation[] = [];
  for (const item of selected) {
    const allowed = new Set(requiresOf(item));
    function getArtifact<Id extends string>(
      id: Id,
    ): Id extends keyof ArtifactMap ? ArtifactMap[Id] : unknown;
    function getArtifact(id: string): unknown {
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
    item.rule.create({
      id: item.id,
      options: item.options,
      getCwd: () => cwd,
      getFiles: () => displayPaths,
      getArtifact,
      report: (violation) => {
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
  violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.range.start.line - b.range.start.line ||
      a.range.start.column - b.range.start.column ||
      a.ruleId.localeCompare(b.ruleId),
  );
  return violations;
}

function printViolations(violations: readonly Violation[], out: (msg: string) => void) {
  for (const violation of violations) {
    const loc = `${violation.file}:${violation.range.start.line}:${violation.range.start.column}`;
    if (violation.suggestion === NO_SUGGESTION) {
      out(`${loc}  ${violation.severity}  ${violation.ruleId}  ${violation.message}`);
    } else {
      out(
        `${loc}  ${violation.severity}  ${violation.ruleId}  ${violation.message}\n  suggestion: ${violation.suggestion}`,
      );
    }
  }
}

async function loadPlugin(spec: string, fromDir: string): Promise<Plugin> {
  let loaded: unknown;
  try {
    loaded = await loadPluginModule(spec, fromDir);
  } catch (e) {
    if (e instanceof ConfigError) {
      throw e;
    }
    throw new ConfigError(
      `Failed to load plugin "${spec}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const candidate = isRecord(loaded) ? (loaded.default ?? loaded.plugin) : undefined;
  const parsed = pluginSchema.safeParse(candidate);
  requirePlugin(spec, candidate, parsed);
  return candidate;
}

async function loadPluginModule(spec: string, fromDir: string): Promise<unknown> {
  const loadOfficial = officialLoaders[spec];
  if (loadOfficial !== undefined) {
    return loadOfficial();
  }
  if (typeof STANDALONE !== "undefined" && STANDALONE) {
    throw new ConfigError(
      `Standalone binary cannot load plugin "${spec}". Custom plugins need npm: npm i qualety`,
    );
  }
  const target =
    spec.startsWith(".") || spec.startsWith("/")
      ? pathToFileURL(resolve(fromDir, spec)).href
      : spec;
  return import(target);
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

function hasNameFilters(filters: CheckFilters): boolean {
  return (
    filters.plugins.length > 0 || filters.excludePlugins.length > 0 || filters.rules.length > 0
  );
}

function pluginNameOf(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

function assertKnownFilters(
  plugins: Plugin[],
  enabled: readonly Enabled[],
  filters: CheckFilters,
): void {
  const pluginNames = new Set(plugins.map((plugin) => plugin.name));
  const catalog = new Set<string>();
  for (const plugin of plugins) {
    for (const name of Object.keys(plugin.rules ?? {})) {
      catalog.add(`${plugin.name}/${name}`);
    }
  }
  const asked = [...filters.plugins, ...filters.excludePlugins];
  const unknownPlugins = [...new Set(asked.filter((name) => !pluginNames.has(name)))];
  if (unknownPlugins.length > 0) {
    throw new ConfigError(
      unknownPlugins.length === 1
        ? `Unknown plugin name: ${unknownPlugins[0]}.`
        : `Unknown plugin names: ${unknownPlugins.join(", ")}.`,
    );
  }
  const unknownRules = filters.rules.filter((id) => !catalog.has(id));
  if (unknownRules.length > 0) {
    throw new ConfigError(
      unknownRules.length === 1
        ? `Unknown rule id: ${unknownRules[0]}.`
        : `Unknown rule ids: ${unknownRules.join(", ")}.`,
    );
  }
  const enabledIds = new Set(enabled.map((item) => item.id));
  const disabled = filters.rules.filter((id) => !enabledIds.has(id));
  if (disabled.length > 0) {
    throw new ConfigError(
      disabled.length === 1
        ? `Rule "${disabled[0]}" is not enabled.`
        : `Rules not enabled: ${disabled.join(", ")}.`,
    );
  }
}

function selectRules(enabled: Enabled[], filters: CheckFilters): Enabled[] {
  let selected = enabled;
  if (filters.plugins.length > 0) {
    const allow = new Set(filters.plugins);
    selected = selected.filter((item) => allow.has(pluginNameOf(item.id)));
  }
  if (filters.excludePlugins.length > 0) {
    const deny = new Set(filters.excludePlugins);
    selected = selected.filter((item) => !deny.has(pluginNameOf(item.id)));
  }
  if (filters.rules.length > 0) {
    const allow = new Set(filters.rules);
    selected = selected.filter((item) => allow.has(item.id));
  }
  return selected;
}

async function listCheckFiles(
  cwd: string,
  config: UserConfig,
  diff: CheckFilters["diff"],
): Promise<string[]> {
  const workspace = await listWorkspaceFiles(cwd, config);
  if (diff === "off") {
    return workspace;
  }
  const seed = await listGitSeed(cwd, diff);
  const workspaceSet = new Set(workspace);
  const matched = seed.filter((file) => workspaceSet.has(file));
  if (matched.length === 0) {
    return [];
  }
  try {
    const closed = expandTypeScriptClosure(cwd, workspace, matched);
    return expandCompanions(cwd, workspace, closed);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to resolve dependency closure: ${detail}`);
  }
}

function resolveEnabledRules(plugins: Plugin[], rules: UserConfig["rules"]): Enabled[] {
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
  for (const [id, setting] of Object.entries(rules)) {
    const entry = enableRule(id, setting, catalog.get(id));
    if (entry !== undefined) {
      enabled.push(entry);
    }
  }
  return enabled;
}

function enableRule(
  id: string,
  setting: UserConfig["rules"][string],
  rule: Rule | undefined,
): Enabled | undefined {
  if (setting === "off") {
    return undefined;
  }
  if (rule === undefined) {
    throw new ConfigError(`Unknown rule id: ${id}. No loaded plugin defines this rule.`);
  }
  const severity = typeof setting === "string" ? setting : setting[0];
  const rawOptions = typeof setting === "string" ? undefined : setting[1];
  if (rawOptions === undefined) {
    return { id, severity, rule, options: undefined };
  }
  if (rule.meta.schema === undefined) {
    throw new ConfigError(`Rule "${id}" does not accept options.`);
  }
  const parsed = compileRuleOptions(rule.meta.schema, id).safeParse(rawOptions);
  if (parsed.success) {
    return { id, severity, rule, options: parsed.data };
  }
  const issue = parsed.error.issues[0];
  const path = issue === undefined || issue.path.length === 0 ? "options" : issue.path.join(".");
  const detail = issue === undefined ? "invalid" : issue.message;
  throw new ConfigError(`Invalid options for "${id}": ${path}: ${detail}`);
}

function requiresOf(item: Enabled): readonly string[] {
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
  const ids = [...requiredBy.keys()].sort(
    (left, right) => artifactRank(left) - artifactRank(right) || left.localeCompare(right),
  );
  for (const id of ids) {
    const rules = requiredBy.get(id);
    if (rules === undefined) {
      continue;
    }
    artifacts.set(
      id,
      await buildOneArtifact(id, rules, providers, base, (artifactId) => artifacts.get(artifactId)),
    );
  }
  return artifacts;
}

function artifactRank(id: string): number {
  if (id === "python") {
    return 0;
  }
  if (id === "typescript") {
    return 1;
  }
  if (id === "code-embeddings") {
    return 3;
  }
  return 2;
}

async function buildOneArtifact(
  id: string,
  rules: string[],
  providers: Map<string, ProviderEntry>,
  base: { cwd: string; files: readonly string[]; exclude: readonly string[] },
  getArtifact: (id: string) => unknown,
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
      getArtifact,
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
