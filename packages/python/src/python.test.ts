import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { buildPythonProject } from "./python.ts";

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-python-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

test("empty py set does not spawn", async () => {
  const result = await buildPythonProject({
    cwd: process.cwd(),
    files: ["src/foo.ts"],
    exclude: [],
    requiredBy: ["python/no-unnecessary-def"],
    getArtifact: () => undefined,
    env: { ...process.env, PATH: "" },
  });
  expect(result.sources.size).toBe(0);
  expect(result.nameCards).toEqual([]);
});

test("missing python3 with a py file throws naming the rule", async () => {
  const dir = await writeTree({ "a.py": "x = 1\n" });
  await expect(
    buildPythonProject({
      cwd: dir,
      files: ["a.py"],
      exclude: [],
      requiredBy: ["python/no-unnecessary-def"],
      getArtifact: () => undefined,
      env: { ...process.env, PATH: "" },
    }),
  ).rejects.toThrow(/python\/no-unnecessary-def/);
});

test("syntax error file is omitted", async () => {
  const dir = await writeTree({
    "ok.py": "def foo():\n    return 1\n",
    "bad.py": "def (\n",
  });
  const result = await buildPythonProject({
    cwd: dir,
    files: ["ok.py", "bad.py"],
    exclude: [],
    requiredBy: ["python/no-unnecessary-def"],
    getArtifact: () => undefined,
  });
  expect(result.sources.size).toBe(1);
  expect([...result.sources.keys()].some((path) => path.endsWith("ok.py"))).toBe(true);
});

test("nameCards collect module-level numeric constants", async () => {
  const dir = await writeTree({
    "a.py": "FORCE_CAP = 30\n",
    "b.py": "DEFAULT_FORCE_CAP = -1.5\n",
  });
  const result = await buildPythonProject({
    cwd: dir,
    files: ["a.py", "b.py"],
    exclude: [],
    requiredBy: ["python/single-source-threshold"],
    getArtifact: () => undefined,
  });
  expect(result.nameCards.map((card) => card.name).sort()).toEqual([
    "DEFAULT_FORCE_CAP",
    "FORCE_CAP",
  ]);
  expect(result.nameCards.find((card) => card.name === "FORCE_CAP")?.value).toBe(30);
  expect(result.nameCards.find((card) => card.name === "DEFAULT_FORCE_CAP")?.value).toBe(-1.5);
  expect(result.nameCards[0]?.embedText).toMatch(/force cap/);
});

test("pyi files are skipped", async () => {
  const dir = await writeTree({ "a.pyi": "def foo() -> int: ...\n" });
  const result = await buildPythonProject({
    cwd: dir,
    files: ["a.pyi"],
    exclude: [],
    requiredBy: ["python/no-unnecessary-def"],
    getArtifact: () => undefined,
    env: { ...process.env, PATH: "" },
  });
  expect(result.sources.size).toBe(0);
});
