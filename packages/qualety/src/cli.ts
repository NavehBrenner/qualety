#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  biomeEnabled,
  GENERATED_BIOME_PATH,
  readBiomeVersion,
  resolveBiomeBinary,
  writeGeneratedBiomeConfig,
} from "./biome.ts";
import { loadConfig } from "./config.ts";
import { type CheckFilters, check, loadPluginsFromConfig } from "./engine.ts";
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
  qualety init
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
  },
  out: (msg: string) => void,
  err: (msg: string) => void,
  cwd: string,
): Promise<number> {
  const [command, ...rest] = positionals;
  if (command === "init" || command === "doctor") {
    return runMeta(command, rest, positionals, out, err, cwd);
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
): Promise<number> {
  if (rest.length > 0) {
    err(`Unknown command: ${positionals.join(" ")}\n\n${USAGE}`);
    return 2;
  }
  try {
    if (command !== "init") {
      return await runDoctor(cwd, out);
    }
    const loaded = await loadConfig(cwd);
    if (loaded === undefined) {
      throw new Error("No qualety config found.");
    }
    const plugins = await loadPluginsFromConfig(loaded.config, loaded.path);
    const paths = [await writeGeneratedBiomeConfig(cwd, plugins, loaded.config.biome)];
    if (ruffEnabled(loaded.config)) {
      paths.push(await writeGeneratedRuffConfig(cwd, plugins, loaded.config.ruff));
    }
    out(paths.join("\n"));
    return 0;
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
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
  } else {
    const bin = resolveBiomeBinary();
    const version = await readBiomeVersion(bin, cwd);
    out(`biome: on\nversion: ${version}\nbinary: ${bin}\nconfig: ${GENERATED_BIOME_PATH}`);
  }
  if (!ruffEnabled(loaded.config)) {
    out("ruff: off (ruff: false)");
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

declare const STANDALONE: boolean;

if (
  (typeof STANDALONE !== "undefined" && STANDALONE) ||
  (process.argv[1] && import.meta.filename === process.argv[1])
) {
  process.exitCode = await run(process.argv.slice(2));
}
