import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { isRecord } from "./record.ts";
import { ruleSettingSchema, userBiomeSchema, userRuffSchema } from "./schemas.ts";

export const userConfigSchema = z
  .object({
    plugins: z.array(z.string()),
    rules: z.record(z.string(), ruleSettingSchema).optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    biome: z.union([z.literal(false), userBiomeSchema]).optional(),
    ruff: z.union([z.literal(false), userRuffSchema]).optional(),
  })
  .strict();

export type UserConfig = z.infer<typeof userConfigSchema>;

export const CONFIG_FILENAMES = [
  "qualety.config.ts",
  "qualety.config.mts",
  "qualety.config.js",
  "qualety.config.mjs",
  "qualety.config.json",
] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function validateConfig(raw: unknown): UserConfig {
  const result = userConfigSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  throw mapConfigZodError(raw, result.error);
}

export async function loadConfig(
  cwd: string,
): Promise<{ path: string; config: UserConfig } | undefined> {
  let dir = cwd;
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      try {
        await access(candidate);
      } catch {
        continue;
      }
      return { path: candidate, config: await readConfigFile(candidate) };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export async function readConfigFile(path: string): Promise<UserConfig> {
  if (path.endsWith(".json")) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      throw new ConfigError(`Failed to read ${path}: ${messageOf(e)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new ConfigError(`Invalid JSON in ${path}: ${messageOf(e)}`);
    }
    return validateConfig(parsed);
  }
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path).href);
  } catch (e) {
    throw new ConfigError(`Failed to load ${path}: ${messageOf(e)}`);
  }
  if (!isRecord(loaded) || !("default" in loaded)) {
    throw new ConfigError(`${path} must have a default export`);
  }
  return validateConfig(loaded.default);
}

function mapConfigZodError(raw: unknown, error: z.ZodError): ConfigError {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return new ConfigError("Config must be an object");
  }

  const extraKeys = unrecognizedConfigKeys(error);
  if (extraKeys.length > 0) {
    const allowed = Object.keys(userConfigSchema.shape).join(", ");
    return new ConfigError(
      `Unknown config key${extraKeys.length > 1 ? "s" : ""}: ${extraKeys.join(", ")}. Allowed keys: ${allowed}.`,
    );
  }

  if (
    error.issues.some((issue) => {
      const key = issue.path[0];
      return (
        key === "plugins" && issue.code === "invalid_type" && valueAt(raw, issue.path) === undefined
      );
    })
  ) {
    return new ConfigError('Config must include "plugins"');
  }
  return (
    firstFieldError(raw, error) ?? new ConfigError(error.issues[0]?.message ?? "Invalid config")
  );
}

function firstFieldError(raw: unknown, error: z.ZodError): ConfigError | undefined {
  for (const issue of error.issues) {
    const mapped = mapFieldIssue(raw, issue);
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return undefined;
}

function mapFieldIssue(raw: unknown, issue: z.ZodIssue): ConfigError | undefined {
  const key = issue.path[0];
  if (key === "plugins" || key === "include" || key === "exclude") {
    return new ConfigError(`"${String(key)}" must be an array of strings`);
  }
  if (key === "biome") {
    return mapComposedLinterIssue(issue, "biome", "expected group/name.");
  }
  if (key === "ruff") {
    return mapComposedLinterIssue(issue, "ruff", "expected a Ruff code or prefix.");
  }
  if (key !== "rules") {
    return undefined;
  }
  if (issue.path.length === 1) {
    return new ConfigError(
      '"rules" must be an object of rule ids to "error" | "warn" | "off" or [severity, options]',
    );
  }
  const id = issue.path[1];
  if (typeof id !== "string") {
    return undefined;
  }
  const value = valueAt(raw, ["rules", id]);
  if (isRecord(value)) {
    return new ConfigError(
      `Invalid rules entry for "${id}": options require a severity. Use "error", "warn", or "off", or ["error" | "warn", options].`,
    );
  }
  if (!Array.isArray(value)) {
    return new ConfigError(
      `Invalid severity for "${id}": ${JSON.stringify(value)}. Use "error", "warn", or "off".`,
    );
  }
  if (value.length !== 2) {
    return new ConfigError(`Invalid rules entry for "${id}": expected [severity, options].`);
  }
  if (value[0] === "off") {
    return new ConfigError(`Rule "${id}" is "off"; options are not allowed.`);
  }
  if (!isRecord(value[1])) {
    return new ConfigError(`Invalid options for "${id}": options must be an object.`);
  }
  return new ConfigError(
    `Invalid severity for "${id}": ${JSON.stringify(value[0])}. Use "error", "warn", or "off".`,
  );
}

function mapComposedLinterIssue(
  issue: z.ZodIssue,
  tool: "biome" | "ruff",
  idHint: string,
): ConfigError {
  if (issue.code === "invalid_union") {
    for (const branch of issue.errors) {
      const mapped = mapComposedLinterUnionBranch(branch, tool, idHint);
      if (mapped !== undefined) {
        return mapped;
      }
    }
  }
  if (issue.code === "unrecognized_keys") {
    return new ConfigError(
      `Unknown ${tool} key${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.join(", ")}.`,
    );
  }
  if (issue.path[1] === "rules" && typeof issue.path[2] === "string") {
    return new ConfigError(
      `Invalid ${tool === "biome" ? "Biome" : "Ruff"} rule id ${JSON.stringify(issue.path[2])}; ${idHint}`,
    );
  }
  if (issue.path[1] === "format") {
    return new ConfigError(`"${tool}.format" must be a boolean`);
  }
  return new ConfigError(`Invalid ${tool} config: ${issue.message}`);
}

function mapComposedLinterUnionBranch(
  branch: z.ZodIssue[],
  tool: "biome" | "ruff",
  idHint: string,
): ConfigError | undefined {
  for (const inner of branch) {
    if (inner.code === "unrecognized_keys") {
      return new ConfigError(
        `Unknown ${tool} key${inner.keys.length > 1 ? "s" : ""}: ${inner.keys.join(", ")}.`,
      );
    }
    if (inner.code === "invalid_key") {
      const id = inner.path.find((part) => part !== "rules") ?? inner.path.at(-1);
      const label = tool === "biome" ? "Biome" : "Ruff";
      return new ConfigError(`Invalid ${label} rule id ${JSON.stringify(String(id))}; ${idHint}`);
    }
  }
  return undefined;
}

function unrecognizedConfigKeys(error: z.ZodError): string[] {
  const keys: string[] = [];
  for (const issue of error.issues) {
    if (issue.code !== "unrecognized_keys" || issue.path.length > 0) {
      continue;
    }
    keys.push(...issue.keys);
  }
  return keys;
}

function valueAt(raw: unknown, path: PropertyKey[]): unknown {
  let current: unknown = raw;
  for (const key of path) {
    if (!isRecord(current)) {
      return current;
    }
    current = current[String(key)];
  }
  return current;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
