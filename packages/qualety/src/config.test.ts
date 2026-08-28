import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import rootVitestConfig from "../../../vitest.config.ts";
import {
  CONFIG_FILENAMES,
  ConfigError,
  loadConfig,
  readConfigFile,
  userConfigSchema,
  validateConfig,
} from "./config.ts";
import type { UserConfig } from "./index.ts";
import {
  defineConfig as exportedDefineConfig,
  artifactProviderSchema as indexArtifactProviderSchema,
  defineRule as indexDefineRule,
  functionSchema as indexFunctionSchema,
  pluginProvidesSchema as indexPluginProvidesSchema,
  pluginSchema as indexPluginSchema,
  requiresSchema as indexRequiresSchema,
  ruleMetaSchema as indexRuleMetaSchema,
  ruleSchema as indexRuleSchema,
  runTimedCommand as indexRunTimedCommand,
} from "./index.ts";

const valid: UserConfig = { plugins: [], rules: {} };

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-config-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

test("defineConfig is exported and returns the same reference", () => {
  expect(exportedDefineConfig(valid)).toBe(valid);
  expect(CONFIG_FILENAMES.length).toBeGreaterThan(0);
  expect(userConfigSchema).toBeDefined();
  expect(new ConfigError("x")).toBeInstanceOf(Error);
  expect(readConfigFile).toEqual(expect.any(Function));
  expect(indexDefineRule).toEqual(expect.any(Function));
  expect(indexArtifactProviderSchema).toBeDefined();
  expect(indexFunctionSchema).toBeDefined();
  expect(indexPluginProvidesSchema).toBeDefined();
  expect(indexPluginSchema).toBeDefined();
  expect(indexRequiresSchema).toBeDefined();
  expect(indexRuleMetaSchema).toBeDefined();
  expect(indexRuleSchema).toBeDefined();
  expect(indexRunTimedCommand).toEqual(expect.any(Function));
  expect(rootVitestConfig).toBeDefined();
});

test("validateConfig accepts biome false and rules overlay", () => {
  expect(validateConfig({ ...valid, biome: false })).toEqual({ ...valid, biome: false });
  expect(
    validateConfig({
      ...valid,
      biome: {
        rules: {
          "complexity/noExcessiveCognitiveComplexity": ["error", { maxAllowedComplexity: 15 }],
        },
        format: true,
      },
    }).biome,
  ).toEqual({
    rules: {
      "complexity/noExcessiveCognitiveComplexity": ["error", { maxAllowedComplexity: 15 }],
    },
    format: true,
  });
});

test("validateConfig rejects invalid biome contributions", () => {
  expect(() => validateConfig({ ...valid, biome: { rules: { noSlash: "error" } } })).toThrow(
    /expected group\/name/,
  );
  expect(() => validateConfig({ ...valid, biome: { files: [] } })).toThrow(
    /Unknown biome key: files/,
  );
});

test("validateConfig rejects unknown keys", () => {
  expect(() => validateConfig({ ...valid, architecture: {} })).toThrow(
    /Unknown config key: architecture/,
  );
});

test("validateConfig rejects languages", () => {
  expect(() => validateConfig({ ...valid, languages: ["typescript"] })).toThrow(
    /Unknown config key: languages/,
  );
});

test("validateConfig rejects invalid severity", () => {
  expect(() =>
    validateConfig({ ...valid, rules: { "ts/public-exports-tested": "fatal" } }),
  ).toThrow(/Invalid severity for "ts\/public-exports-tested"/);
});

test("validateConfig accepts [severity, options]", () => {
  expect(
    validateConfig({
      plugins: [],
      rules: { "dry/no-semantic-duplicate": ["error", { threshold: 0.8 }] },
    }),
  ).toEqual({
    plugins: [],
    rules: { "dry/no-semantic-duplicate": ["error", { threshold: 0.8 }] },
  });
});

test("validateConfig rejects bare options object", () => {
  expect(() =>
    validateConfig({ ...valid, rules: { "dry/no-semantic-duplicate": { threshold: 0.8 } } }),
  ).toThrow(/dry\/no-semantic-duplicate/);
  expect(() =>
    validateConfig({ ...valid, rules: { "dry/no-semantic-duplicate": { threshold: 0.8 } } }),
  ).toThrow(/options require a severity/);
});

test("validateConfig rejects extra tuple slots and one-element arrays", () => {
  expect(() =>
    validateConfig({
      ...valid,
      rules: { "dry/no-semantic-duplicate": ["error", { threshold: 0.8 }, "extra"] },
    }),
  ).toThrow(/expected \[severity, options\]/);
  expect(() =>
    validateConfig({ ...valid, rules: { "dry/no-semantic-duplicate": ["error"] } }),
  ).toThrow(/expected \[severity, options\]/);
});

test("validateConfig rejects non-object options slot", () => {
  expect(() =>
    validateConfig({ ...valid, rules: { "dry/no-semantic-duplicate": ["error", 0.8] } }),
  ).toThrow(/Invalid options for "dry\/no-semantic-duplicate"/);
});

test("validateConfig rejects off with options", () => {
  expect(() =>
    validateConfig({
      ...valid,
      rules: { "dry/no-semantic-duplicate": ["off", { threshold: 0.8 }] },
    }),
  ).toThrow(/Rule "dry\/no-semantic-duplicate" is "off"/);
});

test("validateConfig requires plugins", () => {
  expect(() => validateConfig({})).toThrow(/must include "plugins"/);
  expect(() => validateConfig({ rules: {} })).toThrow(/must include "plugins"/);
  expect(validateConfig({ plugins: [] })).toEqual({ plugins: [] });
});

test("validateConfig accepts config without languages", () => {
  expect(validateConfig({ plugins: ["./plugin"], rules: { "demo/ping": "error" } })).toEqual({
    plugins: ["./plugin"],
    rules: { "demo/ping": "error" },
  });
});

test("loadConfig reads a JSON config", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: ["./plugin"],
      rules: { "demo/ping": "error" },
    }),
  });
  const loaded = await loadConfig(dir);
  expect(loaded?.config).toEqual({
    plugins: ["./plugin"],
    rules: { "demo/ping": "error" },
  });
  expect(loaded?.path).toBe(join(dir, "qualety.config.json"));
});

test("loadConfig reads a JS config default export", async () => {
  const dir = await writeTree({
    "qualety.config.mjs": `export default {
      plugins: [],
      rules: { "demo/off": "off" },
    };
    `,
  });
  const loaded = await loadConfig(dir);
  expect(loaded?.config.rules).toEqual({ "demo/off": "off" });
});

test("loadConfig reads a TypeScript config default export", async () => {
  const dir = await writeTree({
    "qualety.config.ts": `export default {
      plugins: [] as string[],
      rules: {},
    };
    `,
  });
  const loaded = await loadConfig(dir);
  expect(loaded?.config).toEqual(valid);
});

test("loadConfig returns undefined when no config file exists", async () => {
  const dir = await writeTree({ "readme.txt": "no config here" });
  expect(await loadConfig(dir)).toBeUndefined();
});

test("loadConfig rejects unknown keys in JSON", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({ ...valid, extra: true }),
  });
  await expect(loadConfig(dir)).rejects.toThrow(/Unknown config key: extra/);
});
