import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { run } from "./cli.ts";

const silent = () => {};

const pingPlugin = `export default {
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
    quiet: {
      meta: { docs: { description: "never reports" } },
      create() {},
    },
  },
};
`;

const otherPlugin = `export default {
  name: "other",
  rules: {
    pong: {
      meta: { docs: { description: "always reports" } },
      create(context) {
        context.report({
          severity: "error",
          file: context.getFiles()[0] ?? ".",
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: "pong",
        });
      },
    },
  },
};
`;

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-cli-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

async function pingTree(
  rules: Record<string, string>,
  extra: Record<string, string> = {},
): Promise<string> {
  return writeTree({
    "plugin.mjs": pingPlugin,
    "other.mjs": otherPlugin,
    "qualety.config.json": JSON.stringify({
      plugins: ["./plugin.mjs", "./other.mjs"],
      rules,
      biome: false,
    }),
    "src/hello.ts": "export const n = 1;\n",
    ...extra,
  });
}

test("check with no rules exits 0 and is honest", async () => {
  const dir = await writeTree({});
  const lines: string[] = [];
  expect(await run(["check"], (m) => lines.push(String(m)), silent, dir)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("check with empty rules object is honest", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [],
      rules: {},
      biome: false,
    }),
  });
  const lines: string[] = [];
  expect(await run(["check"], (m) => lines.push(String(m)), silent, dir)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("--help exits 0", async () => {
  expect(await run(["--help"], silent, silent)).toBe(0);
});

test("--help lists filter flags", async () => {
  const lines: string[] = [];
  expect(await run(["--help"], (m) => lines.push(String(m)), silent)).toBe(0);
  const text = lines.join("\n");
  expect(text).toMatch(/--plugin <name>/);
  expect(text).toMatch(/--exclude-plugin <name>/);
  expect(text).toMatch(/--rule <id>/);
  expect(text).toMatch(/--diff-worktree/);
  expect(text).toMatch(/--diff /);
  expect(text).toMatch(/qualety init/);
  expect(text).toMatch(/qualety doctor/);
});

test("unknown flag exits 2", async () => {
  expect(await run(["check", "--nope"], silent, silent)).toBe(2);
});

test("--diff and --diff-worktree together exit 2", async () => {
  const errors: string[] = [];
  expect(
    await run(["check", "--diff", "--diff-worktree"], silent, (m) => errors.push(String(m))),
  ).toBe(2);
  expect(errors.join("\n")).toMatch(/cannot be used together/);
});

test("--plugin keeps that plugin's rules", async () => {
  const dir = await pingTree({ "fixture/ping": "error", "other/pong": "error" });
  const lines: string[] = [];
  expect(
    await run(["check", "--plugin", "fixture"], (m) => lines.push(String(m)), silent, dir),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/fixture\/ping/);
  expect(lines.join("\n")).not.toMatch(/other\/pong/);
});

test("--exclude-plugin drops that plugin", async () => {
  const dir = await pingTree({ "fixture/ping": "error", "other/pong": "error" });
  const lines: string[] = [];
  expect(
    await run(["check", "--exclude-plugin", "fixture"], (m) => lines.push(String(m)), silent, dir),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/other\/pong/);
  expect(lines.join("\n")).not.toMatch(/fixture\/ping/);
});

test("--rule keeps that id", async () => {
  const dir = await pingTree({ "fixture/ping": "error", "other/pong": "error" });
  const lines: string[] = [];
  expect(
    await run(["check", "--rule", "fixture/ping"], (m) => lines.push(String(m)), silent, dir),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/fixture\/ping/);
  expect(lines.join("\n")).not.toMatch(/other\/pong/);
});

test("--plugin union keeps each named plugin", async () => {
  const dir = await pingTree({ "fixture/ping": "error", "other/pong": "error" });
  const lines: string[] = [];
  expect(
    await run(
      ["check", "--plugin", "fixture", "--plugin", "other"],
      (m) => lines.push(String(m)),
      silent,
      dir,
    ),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/fixture\/ping/);
  expect(lines.join("\n")).toMatch(/other\/pong/);
});

test("--plugin then --exclude-plugin drops after allow", async () => {
  const dir = await pingTree({ "fixture/ping": "error", "other/pong": "error" });
  const lines: string[] = [];
  expect(
    await run(
      ["check", "--plugin", "fixture", "--plugin", "other", "--exclude-plugin", "other"],
      (m) => lines.push(String(m)),
      silent,
      dir,
    ),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/fixture\/ping/);
  expect(lines.join("\n")).not.toMatch(/other\/pong/);
});

test("--plugin and --rule intersect", async () => {
  const dir = await pingTree({ "fixture/ping": "error", "other/pong": "error" });
  const lines: string[] = [];
  expect(
    await run(
      ["check", "--plugin", "other", "--rule", "fixture/ping"],
      (m) => lines.push(String(m)),
      silent,
      dir,
    ),
  ).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules matched filters/);
});

test("unknown --plugin exits 2 with the name", async () => {
  const dir = await pingTree({ "fixture/ping": "error" });
  const errors: string[] = [];
  expect(
    await run(["check", "--plugin", "react"], silent, (m) => errors.push(String(m)), dir),
  ).toBe(2);
  expect(errors.join("\n")).toMatch(/Unknown plugin name: react/);
});

test("--diff without rules does not invoke git", async () => {
  const dir = await writeTree({});
  const lines: string[] = [];
  expect(await run(["check", "--diff"], (m) => lines.push(String(m)), silent, dir)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("--diff-worktree without rules does not invoke git", async () => {
  const dir = await writeTree({});
  const lines: string[] = [];
  expect(await run(["check", "--diff-worktree"], (m) => lines.push(String(m)), silent, dir)).toBe(
    0,
  );
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("init writes generated Biome config", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({ plugins: [], rules: {} }),
  });
  const lines: string[] = [];
  expect(await run(["init"], (m) => lines.push(String(m)), silent, dir)).toBe(0);
  expect(lines.join("\n")).toMatch(/\.qualety\/biome\.json/);
});

test("init without config exits 2", async () => {
  const dir = await writeTree({});
  const errors: string[] = [];
  expect(await run(["init"], silent, (m) => errors.push(String(m)), dir)).toBe(2);
  expect(errors.join("\n")).toMatch(/No qualety config found/);
});

test("doctor reports biome off without config", async () => {
  const dir = await writeTree({});
  const lines: string[] = [];
  expect(await run(["doctor"], (m) => lines.push(String(m)), silent, dir)).toBe(0);
  expect(lines.join("\n")).toMatch(/biome: off \(no qualety config\)/);
});

test("doctor reports biome on with version and binary", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({ plugins: [], rules: {} }),
  });
  const lines: string[] = [];
  expect(await run(["doctor"], (m) => lines.push(String(m)), silent, dir)).toBe(0);
  const text = lines.join("\n");
  expect(text).toMatch(/biome: on/);
  expect(text).toMatch(/version:/);
  expect(text).toMatch(/binary:/);
});

test("name filters skip the Biome phase", async () => {
  const dir = await writeTree({
    "plugin.mjs": pingPlugin,
    "qualety.config.json": JSON.stringify({
      plugins: ["./plugin.mjs"],
      rules: { "fixture/ping": "error" },
    }),
    "src/hello.ts": "debugger;\n",
  });
  const lines: string[] = [];
  expect(
    await run(["check", "--rule", "fixture/ping"], (m) => lines.push(String(m)), silent, dir),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/fixture\/ping/);
  expect(lines.join("\n")).not.toMatch(/noDebugger/);
});

test("unknown command exits 2", async () => {
  expect(await run(["frobnicate"], silent, silent)).toBe(2);
});

test("no arguments exits 2", async () => {
  expect(await run([], silent, silent)).toBe(2);
});
