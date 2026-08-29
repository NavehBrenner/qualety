import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  biomeEnabled,
  GENERATED_BIOME_PATH,
  mergeBiomeRules,
  nestBiomeRules,
  readBiomeVersion,
  resolveBiomeBinary,
  runBiomePhase,
  writeGeneratedBiomeConfig,
} from "./biome.ts";
import { check } from "./engine.ts";
import type { Plugin } from "./index.ts";
import { pluginSchema } from "./schemas.ts";

const silent = () => {};
const here = fileURLToPath(new URL(".", import.meta.url));
const smoke = join(here, "../fixtures/biome-finding");

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-biome-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

const baselinePlugin = (name: string, rules: Plugin["biome"]): Plugin => ({
  name,
  biome: rules,
});

test("merge order is baseline then plugins then user; last plugin wins", () => {
  const first = baselinePlugin("first", {
    rules: {
      "nursery/noUnsafeTypeAssertion": "warn",
      "suspicious/noDebugger": "error",
    },
  });
  const second = baselinePlugin("second", {
    rules: { "nursery/noUnsafeTypeAssertion": "error" },
  });
  const merged = mergeBiomeRules([first, second], {
    "complexity/noExcessiveCognitiveComplexity": ["error", { maxAllowedComplexity: 15 }],
  });
  expect(merged["suspicious/noConfusingVoidType"]).toBe("off");
  expect(merged["suspicious/noDebugger"]).toBe("error");
  expect(merged["nursery/noUnsafeTypeAssertion"]).toBe("error");
  expect(merged["complexity/noExcessiveCognitiveComplexity"]).toEqual([
    "error",
    { maxAllowedComplexity: 15 },
  ]);
});

test("merge rejects a Biome rule id that is not group/name", () => {
  expect(() =>
    mergeBiomeRules([baselinePlugin("ts", { rules: { noSlash: "error" } })], undefined),
  ).toThrow(/expected group\/name/);
  expect(() =>
    mergeBiomeRules([baselinePlugin("ts", { rules: { "a/b/c": "error" } })], undefined),
  ).toThrow(/expected group\/name/);
});

test("nestBiomeRules writes preset and [severity, options] as level/options", () => {
  expect(
    nestBiomeRules({
      "suspicious/noConfusingVoidType": "off",
      "complexity/noExcessiveCognitiveComplexity": ["error", { maxAllowedComplexity: 15 }],
    }),
  ).toEqual({
    preset: "recommended",
    suspicious: { noConfusingVoidType: "off" },
    complexity: {
      noExcessiveCognitiveComplexity: {
        level: "error",
        options: { maxAllowedComplexity: 15 },
      },
    },
  });
});

test("pluginSchema accepts biome.rules and still accepts ruleless providers", () => {
  expect(
    pluginSchema.safeParse({
      name: "ts",
      biome: { rules: { "nursery/noUnsafeTypeAssertion": "error" } },
    }).success,
  ).toBe(true);
  expect(
    pluginSchema.safeParse({
      name: "shared",
      provides: {
        graph: {
          build() {
            return 1;
          },
        },
      },
    }).success,
  ).toBe(true);
});

test("pluginSchema rejects extra biome keys and bad rule ids", () => {
  expect(
    pluginSchema.safeParse({
      name: "ts",
      biome: { rules: {}, files: [] },
    }).success,
  ).toBe(false);
  expect(
    pluginSchema.safeParse({
      name: "ts",
      biome: { rules: { noSlash: "error" } },
    }).success,
  ).toBe(false);
});

test("biome: false skips the Biome phase", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [],
      rules: {},
      biome: false,
      ruff: false,
    }),
    "src/debug.ts": "debugger;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("empty product rules still run Biome", async () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    smoke,
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
  );
  const out = lines.join("\n");
  expect(errors.join("\n")).toBe("");
  expect(code).toBe(1);
  expect(out).toMatch(/lint\/suspicious\/noDebugger/);
  expect(out).toMatch(/suggestion:/);
});

test("python-only file list skips Biome without failing", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [],
      rules: {},
      include: ["**/*.py"],
      ruff: false,
    }),
    "src/hello.py": "x = 1\n",
  });
  const lines: string[] = [];
  const errors: string[] = [];
  expect(
    await check(
      dir,
      (m) => lines.push(String(m)),
      (m) => errors.push(String(m)),
    ),
  ).toBe(0);
  expect(errors.join("\n")).toBe("");
  expect(lines.join("\n")).not.toMatch(/noDebugger|Biome/);
});

test("missing Biome binary exits 2", async () => {
  const dir = await writeTree({ "src/hello.ts": "export const n = 1;\n" });
  await expect(
    runBiomePhase({
      cwd: dir,
      files: ["src/hello.ts"],
      plugins: [],
      biome: undefined,
      bin: join(dir, "no-such-biome"),
    }),
  ).rejects.toThrow(/Biome is not runnable/);
});

test("writeGeneratedBiomeConfig writes merged rules", async () => {
  const dir = await writeTree({});
  const path = await writeGeneratedBiomeConfig(
    dir,
    [
      {
        name: "ts",
        biome: { rules: { "nursery/noUnsafeTypeAssertion": "error" } },
      },
    ],
    {
      rules: {
        "complexity/noExcessiveCognitiveComplexity": ["error", { maxAllowedComplexity: 15 }],
      },
    },
  );
  expect(path).toBe(GENERATED_BIOME_PATH);
  const written = z
    .object({
      linter: z.object({
        rules: z.object({
          preset: z.string(),
          suspicious: z.object({ noConfusingVoidType: z.string() }),
          nursery: z.object({ noUnsafeTypeAssertion: z.string() }),
          complexity: z.object({
            noExcessiveCognitiveComplexity: z.object({
              level: z.string(),
              options: z.record(z.string(), z.unknown()),
            }),
          }),
        }),
      }),
    })
    .parse(JSON.parse(await readFile(join(dir, GENERATED_BIOME_PATH), "utf8")));
  expect(written.linter.rules.preset).toBe("recommended");
  expect(written.linter.rules.suspicious.noConfusingVoidType).toBe("off");
  expect(written.linter.rules.nursery.noUnsafeTypeAssertion).toBe("error");
  expect(written.linter.rules.complexity.noExcessiveCognitiveComplexity).toEqual({
    level: "error",
    options: { maxAllowedComplexity: 15 },
  });
});

test("resolveBiomeBinary finds the pinned package", async () => {
  const bin = resolveBiomeBinary();
  expect(bin).toMatch(/biome/);
  expect(await readBiomeVersion(bin, process.cwd())).toMatch(/\d/);
  expect(biomeEnabled({ plugins: [], rules: {} })).toBe(true);
  expect(biomeEnabled({ plugins: [], rules: {}, biome: false })).toBe(false);
});
