#!/usr/bin/env node
import { parseArgs } from "node:util";
import { type CheckFilters, check } from "./engine.ts";

const USAGE = `qualety — executable code invariants

Usage:
  qualety check [options]

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

  const [command, ...rest] = positionals;
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

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exitCode = await run(process.argv.slice(2));
}
