#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import {
  biomeEnabled,
  GENERATED_BIOME_PATH,
  readBiomeVersion,
  resolveBiomeBinary,
  writeGeneratedBiomeConfig,
} from "./biome.ts";
import { CONFIG_FILENAMES, isStandalone, loadConfig, readConfigFile } from "./config.ts";
import { type CheckFilters, check, loadPluginsFromConfig } from "./engine.ts";
import { detectInitPlugins } from "./init-config.ts";
import { isRecord } from "./record.ts";
import {
  GENERATED_RUFF_PATH,
  readRuffVersion,
  resolveRuffModule,
  ruffEnabled,
  writeGeneratedRuffConfig,
} from "./ruff.ts";

const USAGE = `qualety — executable code invariants

Usage:
  qualety check [options]
  qualety init [--force]
  qualety doctor

Options:
  -h, --help              Show this help
  --plugin <name>         Keep rules from this plugin (repeatable)
  --exclude-plugin <name> Drop rules from this plugin (repeatable)
  --rule <id>             Keep this rule id (repeatable)
  --diff                  Changed files vs merge-base…HEAD, plus dependency closure
  --diff-worktree         Dirty/untracked files vs HEAD, plus dependency closure

Exit codes: 0 clean, 1 violations found, 2 usage or internal error.`;

/**
 * Returns the process exit code. Kept pure (no `process.exit`) so it is
 * testable without spawning a subprocess.
 */
export async function run(
  argv: string[],
  out = console.log,
  err = console.error,
  cwd = process.cwd(),
): Promise<number> {
  let positionals: string[];
  let values: {
    help?: boolean;
    plugin?: string[];
    "exclude-plugin"?: string[];
    rule?: string[];
    diff?: boolean;
    "diff-worktree"?: boolean;
    force?: boolean;
  };
  try {
    ({ positionals, values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        plugin: { type: "string", multiple: true },
        "exclude-plugin": { type: "string", multiple: true },
        rule: { type: "string", multiple: true },
        diff: { type: "boolean" },
        "diff-worktree": { type: "boolean" },
        force: { type: "boolean" },
      },
      allowPositionals: true,
    }));
  } catch (e) {
    err(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    return 2;
  }

  if (values.help || positionals.length === 0) {
    out(USAGE);
    return values.help ? 0 : 2;
  }
  return dispatch(positionals, values, out, err, cwd);
}

async function dispatch(
  positionals: string[],
  values: {
    plugin?: string[];
    "exclude-plugin"?: string[];
    rule?: string[];
    diff?: boolean;
    "diff-worktree"?: boolean;
    force?: boolean;
  },
  out: (msg: string) => void,
  err: (msg: string) => void,
  cwd: string,
): Promise<number> {
  const [command, ...rest] = positionals;
  if (command === "init" || command === "doctor") {
    return runMeta(command, rest, positionals, out, err, cwd, values.force === true);
  }
  if (command !== "check" || rest.length > 0) {
    err(`Unknown command: ${positionals.join(" ")}\n\n${USAGE}`);
    return 2;
  }
  const filters = filtersFromValues(values);
  if (filters === undefined) {
    err(`--diff and --diff-worktree cannot be used together.\n\n${USAGE}`);
    return 2;
  }
  return check(cwd, out, err, filters);
}

async function runMeta(
  command: string,
  rest: string[],
  positionals: string[],
  out: (msg: string) => void,
  err: (msg: string) => void,
  cwd: string,
  force: boolean,
): Promise<number> {
  if (rest.length > 0) {
    err(`Unknown command: ${positionals.join(" ")}\n\n${USAGE}`);
    return 2;
  }
  try {
    if (command !== "init") {
      return await runDoctor(cwd, out);
    }
    return await runInit(cwd, out, err, force);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

async function runInit(
  cwd: string,
  out: (msg: string) => void,
  err: (msg: string) => void,
  force: boolean,
): Promise<number> {
  const existing = await findCwdConfigPath(cwd);
  if (force && existing !== undefined && basename(existing) !== "qualety.config.json") {
    err("--force only overwrites qualety.config.json.");
    return 2;
  }
  const written: string[] = [];
  let configPath: string;
  let seededEmpty = false;
  if (existing === undefined || force) {
    const detected = await detectInitPlugins(cwd);
    await writeFile(
      join(cwd, "qualety.config.json"),
      `${JSON.stringify({ plugins: detected }, null, 2)}\n`,
    );
    written.push("qualety.config.json");
    configPath = join(cwd, "qualety.config.json");
    seededEmpty = detected.length === 0;
  } else {
    configPath = existing;
  }
  const config = await readConfigFile(configPath);
  const plugins = await loadPluginsFromConfig(config, configPath);
  written.push(await writeGeneratedBiomeConfig(cwd, plugins, config.biome));
  if (ruffEnabled(config)) {
    written.push(await writeGeneratedRuffConfig(cwd, plugins, config.ruff));
  }
  out(written.join("\n"));
  if (seededEmpty) {
    out("No plugins detected — qualety check is a no-op until you add plugins.");
  }
  return 0;
}

async function findCwdConfigPath(cwd: string): Promise<string | undefined> {
  for (const name of CONFIG_FILENAMES) {
    const candidate = join(cwd, name);
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if (!(isRecord(error) && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
  return undefined;
}

async function runDoctor(cwd: string, out: (msg: string) => void): Promise<number> {
  const loaded = await loadConfig(cwd);
  if (loaded === undefined) {
    out("biome: off (no qualety config)");
    out("ruff: off (no qualety config)");
    return 0;
  }
  if (!biomeEnabled(loaded.config)) {
    out("biome: off (biome: false)");
  } else if (isStandalone()) {
    // the embedded wasm build exposes no version accessor, so report the backend only
    out("biome: on\nbackend: embedded wasm");
  } else {
    const bin = resolveBiomeBinary();
    const version = await readBiomeVersion(bin, cwd);
    out(`biome: on\nversion: ${version}\nbinary: ${bin}\nconfig: ${GENERATED_BIOME_PATH}`);
  }
  if (!ruffEnabled(loaded.config)) {
    out("ruff: off (ruff: false)");
  } else if (isStandalone()) {
    out(`ruff: on\nversion: ${await readRuffVersion()}\nbackend: embedded wasm`);
  } else {
    const bin = resolveRuffModule();
    const version = await readRuffVersion(bin);
    out(`ruff: on\nversion: ${version}\nbinary: ${bin}\nconfig: ${GENERATED_RUFF_PATH}`);
  }
  return 0;
}

function filtersFromValues(values: {
  plugin?: string[];
  "exclude-plugin"?: string[];
  rule?: string[];
  diff?: boolean;
  "diff-worktree"?: boolean;
}): CheckFilters | undefined {
  if (values.diff === true && values["diff-worktree"] === true) {
    return undefined;
  }
  let diff: CheckFilters["diff"] = "off";
  if (values["diff-worktree"] === true) {
    diff = "worktree";
  } else if (values.diff === true) {
    diff = "upstream";
  }
  return {
    plugins: values.plugin ?? [],
    excludePlugins: values["exclude-plugin"] ?? [],
    rules: values.rule ?? [],
    diff,
  };
}

// npm links a bin entry as a symlink, so argv[1] is the link path while
// import.meta.filename is its target. Comparing them raw made the CLI a silent
// no-op under `npx qualety` and `./node_modules/.bin/qualety` — exit 0, no output.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(entry) === import.meta.filename;
  } catch {
    return false;
  }
}

if (isStandalone() || invokedDirectly()) {
  process.exitCode = await run(process.argv.slice(2));
}
