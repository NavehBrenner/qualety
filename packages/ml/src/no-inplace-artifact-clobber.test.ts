import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noInplaceArtifactClobber } from "./no-inplace-artifact-clobber.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const pythonDist = fileURLToPath(new URL("../../python/dist/index.js", import.meta.url));
const mlDist = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const RULE = "ml/no-inplace-artifact-clobber";
const execFileAsync = promisify(execFile);

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: [RULE], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initGit(cwd: string): Promise<void> {
  await git(cwd, ["init", "-b", "main"]);
  await git(cwd, ["config", "user.name", "qualety-test"]);
  await git(cwd, ["config", "user.email", "qualety@test"]);
  await git(cwd, ["config", "commit.gpgsign", "false"]);
}

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-ml-clobber-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

function configJson(): string {
  return JSON.stringify({
    plugins: [pythonDist, mlDist],
    rules: { [RULE]: "error" },
    biome: false,
    ruff: false,
  });
}

async function runDir(dir: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    dir,
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: [RULE], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-inplace-artifact-clobber and recommended includes it", () => {
  expect(noInplaceArtifactClobber).toBeDefined();
  expect(plugin.rules?.["no-inplace-artifact-clobber"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("unrelated open log is quiet", async () => {
  const result = await runFixture("clobber-unrelated-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("unrecoverable dest is quiet", async () => {
  const result = await runFixture("clobber-unrecoverable-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("in-place torch.save to a tracked path exits 1", async () => {
  const dir = await writeTree({
    "qualety.config.json": configJson(),
    "model.pt": "weights\n",
    "src/export.py": 'import torch\n\ntorch.save(torch.tensor(1.0), "model.pt")\n',
  });
  await initGit(dir);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "base"]);
  const result = await runDir(dir);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/no-inplace-artifact-clobber/);
  expect(result.out).toMatch(/model\.pt/);
  expect(result.out).toMatch(/os\.replace/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("staging plus os.replace onto tracked final name exits 0", async () => {
  const dir = await writeTree({
    "qualety.config.json": configJson(),
    "model.pt": "weights\n",
    "src/export.py":
      'import os\nimport torch\n\ntorch.save(torch.tensor(1.0), "model.pt.tmp")\nos.replace("model.pt.tmp", "model.pt")\n',
  });
  await initGit(dir);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "base"]);
  const result = await runDir(dir);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("non-git cwd is quiet", async () => {
  const dir = await writeTree({
    "qualety.config.json": configJson(),
    "model.pt": "weights\n",
    "src/export.py": 'import torch\n\ntorch.save(torch.tensor(1.0), "model.pt")\n',
  });
  const result = await runDir(dir);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
