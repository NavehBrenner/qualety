import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "./engine.ts";
import type { Plugin } from "./index.ts";
import {
  GENERATED_RUFF_PATH,
  mergeRuffRules,
  readRuffVersion,
  resolveRuffModule,
  ruffEnabled,
  runRuffPhase,
  serializeRuffToml,
  writeGeneratedRuffConfig,
} from "./ruff.ts";
import { pluginSchema } from "./schemas.ts";

const silent = () => {};
const here = fileURLToPath(new URL(".", import.meta.url));
const smoke = join(here, "../fixtures/ruff-finding");

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-ruff-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

const bagPlugin = (name: string, rules: Plugin["ruff"]): Plugin => ({
  name,
  ruff: rules,
});
const pythonRuff = bagPlugin("python", { rules: { UP: "error", B: "error" } });
const thingPy = `import sys

import attrs

import demo.helper

x = lambda: None  # noqa: E731
`;
const thingTree = {
  "demo/helper.py": "x = 1\n",
  "demo/thing.py": thingPy,
};

test("merge order is plugins then user; last plugin wins; core baseline empty", () => {
  const first = bagPlugin("first", {
    rules: { UP: "warn", F401: "error" },
  });
  const second = bagPlugin("second", {
    rules: { UP: "error" },
  });
  const merged = mergeRuffRules([first, second], {
    E501: "off",
  });
  expect(merged.F401).toBe("error");
  expect(merged.UP).toBe("error");
  expect(merged.E501).toBe("off");
  expect(Object.keys(merged).sort()).toEqual(["E501", "F401", "UP"]);
});

test("merge rejects a Ruff rule id that is not a code or prefix", () => {
  expect(() =>
    mergeRuffRules([bagPlugin("py", { rules: { "ruff/E501": "error" } })], undefined),
  ).toThrow(/expected a Ruff code or prefix/);
  expect(() => mergeRuffRules([bagPlugin("py", { rules: { ALL: "error" } })], undefined)).toThrow(
    /expected a Ruff code or prefix/,
  );
  expect(() => mergeRuffRules([bagPlugin("py", { rules: { e501: "error" } })], undefined)).toThrow(
    /expected a Ruff code or prefix/,
  );
});

test("merge rejects non-empty Ruff options", () => {
  expect(() =>
    mergeRuffRules([bagPlugin("py", { rules: { UP: ["error", { preview: true }] } })], undefined),
  ).toThrow(/does not accept options/);
});

test("serializeRuffToml writes extend-select and ignore without select", () => {
  expect(serializeRuffToml({ UP: "error", E501: "off", F: "warn" })).toBe(
    `[lint]
extend-select = [ "F", "UP" ]
ignore = [ "E501" ]
`,
  );
  expect(serializeRuffToml({})).toBe("");
  expect(serializeRuffToml({ UP: "error" })).not.toMatch(/^select\s*=/m);
});

test("serializeRuffToml mirrors inherited select and isort plus plugin extend-select", () => {
  expect(
    serializeRuffToml(
      { UP: "error" },
      {
        select: ["E", "I", "RUF"],
        isort: { "known-first-party": ["demo"] },
      },
    ),
  ).toBe(`[lint]
select = [ "E", "I", "RUF" ]
extend-select = [ "UP" ]

[lint.isort]
known-first-party = [ "demo" ]
`);
  expect(serializeRuffToml({}, { isort: { "known-first-party": ["demo"] } })).toBe(`[lint.isort]
known-first-party = [ "demo" ]
`);
});

test("pluginSchema accepts ruff.rules and rejects extra keys and bad ids", () => {
  expect(
    pluginSchema.safeParse({
      name: "python",
      ruff: { rules: { UP: "error" } },
    }).success,
  ).toBe(true);
  expect(
    pluginSchema.safeParse({
      name: "python",
      ruff: { rules: {}, files: [] },
    }).success,
  ).toBe(false);
  expect(
    pluginSchema.safeParse({
      name: "python",
      ruff: { rules: { "ruff/E501": "error" } },
    }).success,
  ).toBe(false);
  expect(
    pluginSchema.safeParse({
      name: "python",
      ruff: { rules: { ALL: "error" } },
    }).success,
  ).toBe(false);
});

test("ruff: false skips the Ruff phase", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [],
      rules: {},
      biome: false,
      ruff: false,
    }),
    "src/unused.py": "import sys\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("empty product rules still run Ruff", async () => {
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
  expect(out).toMatch(/\bF401\b/);
  expect(out).not.toMatch(/ruff\/F401/);
  expect(out).toMatch(/suggestion:/);
});

test("typescript-only file list skips Ruff without failing", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [],
      rules: {},
      include: ["**/*.ts"],
      biome: false,
    }),
    "src/hello.ts": "export const n = 1;\n",
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
  expect(lines.join("\n")).not.toMatch(/F401|Ruff/);
});

test("name filters skip the Ruff phase", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
      name: "fixture",
      rules: {
        ping: {
          meta: { docs: { description: "always reports" } },
          create(context) {
            context.report({
              severity: "error",
              file: context.getFiles()[0] ?? ".",
              range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
              message: "ping",
            });
          },
        },
      },
    };`,
    "qualety.config.json": JSON.stringify({
      plugins: ["./plugin.mjs"],
      rules: { "fixture/ping": "error" },
      biome: false,
    }),
    "src/unused.py": "import sys\n",
  });
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, {
      plugins: [],
      excludePlugins: [],
      rules: ["fixture/ping"],
      diff: "off",
    }),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/fixture\/ping/);
  expect(lines.join("\n")).not.toMatch(/F401/);
});

test("missing Ruff module exits 2", async () => {
  const dir = await writeTree({ "src/hello.py": "x = 1\n" });
  await expect(
    runRuffPhase({
      cwd: dir,
      files: ["src/hello.py"],
      plugins: [],
      ruff: undefined,
      modulePath: join(dir, "no-such-ruff.js"),
    }),
  ).rejects.toThrow(/Ruff is not runnable/);
});

test("writeGeneratedRuffConfig writes python UP delta without select", async () => {
  const dir = await writeTree({});
  const path = await writeGeneratedRuffConfig(
    dir,
    [{ name: "python", ruff: { rules: { UP: "error" } } }],
    undefined,
  );
  expect(path).toBe(GENERATED_RUFF_PATH);
  const written = await readFile(join(dir, GENERATED_RUFF_PATH), "utf8");
  expect(written).toBe(`[lint]
extend-select = [ "UP" ]
`);
  expect(written).not.toMatch(/^select\s*=/m);
});

test("project lint select and isort inherit drops false I001 and RUF100", async () => {
  const dir = await writeTree({
    ...thingTree,
    "pyproject.toml": `[tool.ruff.lint]
select = ["E", "I", "RUF"]
[tool.ruff.lint.isort]
known-first-party = ["demo"]
`,
  });
  const codes = (
    await runRuffPhase({
      cwd: dir,
      files: ["demo/thing.py"],
      plugins: [pythonRuff],
      ruff: undefined,
    })
  ).map((violation) => violation.ruleId);
  expect(codes).not.toContain("I001");
  expect(codes).not.toContain("RUF100");
  const written = await readFile(join(dir, GENERATED_RUFF_PATH), "utf8");
  expect(written).toMatch(/select = \[ "E", "I", "RUF" \]/);
  expect(written).toMatch(/known-first-party = \[ "demo" \]/);
  expect(written).toMatch(/extend-select = \[ "B", "UP" \]/);
});

test("no project ruff tables stays standalone without hard-ignore", async () => {
  const dir = await writeTree({
    ...thingTree,
    "pyproject.toml": `[project]
name = "demo"
version = "0.0.0"
`,
  });
  const codes = (
    await runRuffPhase({
      cwd: dir,
      files: ["demo/thing.py"],
      plugins: [pythonRuff],
      ruff: undefined,
    })
  ).map((violation) => violation.ruleId);
  expect(codes).toContain("I001");
  expect(codes).toContain("RUF100");
  const written = await readFile(join(dir, GENERATED_RUFF_PATH), "utf8");
  expect(written).not.toMatch(/^select\s*=/m);
  expect(written).not.toMatch(/I001|RUF100/);
  expect(written).not.toMatch(/known-first-party/);
});

test("ruff.toml wins over pyproject.toml", async () => {
  const dir = await writeTree({
    "ruff.toml": `[lint]
select = ["I"]
[lint.isort]
known-first-party = ["demo"]
`,
    "pyproject.toml": `[tool.ruff.lint]
select = ["E"]
[tool.ruff.lint.isort]
known-first-party = ["other"]
`,
  });
  await writeGeneratedRuffConfig(dir, [], undefined);
  const written = await readFile(join(dir, GENERATED_RUFF_PATH), "utf8");
  expect(written).toMatch(/select = \[ "I" \]/);
  expect(written).toMatch(/known-first-party = \[ "demo" \]/);
  expect(written).not.toMatch(/"E"|other/);
});

test(".ruff.toml is used when ruff.toml is absent", async () => {
  const dir = await writeTree({
    ".ruff.toml": `[lint.isort]
known-first-party = ["demo"]
`,
    "pyproject.toml": `[tool.ruff.lint.isort]
known-first-party = ["other"]
`,
  });
  await writeGeneratedRuffConfig(dir, [], undefined);
  const written = await readFile(join(dir, GENERATED_RUFF_PATH), "utf8");
  expect(written).toMatch(/known-first-party = \[ "demo" \]/);
  expect(written).not.toMatch(/other/);
});

test("non-allowlisted project ruff keys stay out of the mirror", async () => {
  const dir = await writeTree({
    "pyproject.toml": `[tool.ruff]
line-length = 88
target-version = "py311"
[tool.ruff.format]
quote-style = "double"
[tool.ruff.lint]
select = ["E"]
[tool.ruff.lint.pydocstyle]
convention = "google"
`,
  });
  await writeGeneratedRuffConfig(dir, [], undefined);
  const written = await readFile(join(dir, GENERATED_RUFF_PATH), "utf8");
  expect(written).toBe(`[lint]
select = [ "E" ]
`);
});

test("invalid project ruff toml stays standalone and does not fall through", async () => {
  const dir = await writeTree({
    ...thingTree,
    "ruff.toml": "[[[not toml",
    "pyproject.toml": `[tool.ruff.lint]
select = ["E", "I", "RUF"]
[tool.ruff.lint.isort]
known-first-party = ["demo"]
`,
  });
  const codes = (
    await runRuffPhase({
      cwd: dir,
      files: ["demo/thing.py"],
      plugins: [pythonRuff],
      ruff: undefined,
    })
  ).map((violation) => violation.ruleId);
  expect(codes).toContain("RUF100");
  const written = await readFile(join(dir, GENERATED_RUFF_PATH), "utf8");
  expect(written).not.toMatch(/^select\s*=/m);
  expect(written).not.toMatch(/known-first-party/);
});

test("resolveRuffModule finds the pinned package", async () => {
  const path = resolveRuffModule();
  expect(path).toMatch(/ruff/);
  expect(await readRuffVersion(path)).toMatch(/\d/);
  expect(ruffEnabled({ plugins: [], rules: {} })).toBe(true);
  expect(ruffEnabled({ plugins: [], rules: {}, ruff: false })).toBe(false);
});
