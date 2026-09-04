import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { runGit, splitGitNames } from "./git-seed.ts";
import { createGitWorktreeProvider } from "./git-worktree.ts";
import type { ArtifactBuildContext, GitWorktreeArtifact } from "./index.ts";

const execFileAsync = promisify(execFile);

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
  const dir = await mkdtemp(join(tmpdir(), "ci-git-worktree-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

function buildContext(cwd: string): ArtifactBuildContext {
  return {
    cwd,
    files: [],
    exclude: [],
    requiredBy: ["test"],
    getArtifact: () => undefined,
  };
}

async function build(cwd: string): Promise<GitWorktreeArtifact> {
  const artifact = await createGitWorktreeProvider().build(buildContext(cwd));
  if (!isWorktree(artifact)) {
    throw new Error("git-worktree build did not return GitWorktreeArtifact");
  }
  return artifact;
}

function isWorktree(value: unknown): value is GitWorktreeArtifact {
  return (
    typeof value === "object" &&
    value !== null &&
    "available" in value &&
    typeof value.available === "boolean" &&
    "entries" in value &&
    value.entries instanceof Map
  );
}

test("fake repo reports tracked clean, dirty, and untracked", async () => {
  const dir = await writeTree({
    "keep/clean.txt": "clean\n",
    "keep/dirty.txt": "before\n",
  });
  await initGit(dir);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "base"]);
  await writeFile(join(dir, "keep/dirty.txt"), "after\n");
  await writeFile(join(dir, "extra.dat"), "untracked\n");
  const artifact = await build(dir);
  expect(artifact.available).toBe(true);
  expect(artifact.toplevel).toBe(dir);
  expect(artifact.entries.get("keep/clean.txt")).toEqual({
    dirty: false,
    untracked: false,
    tracked: true,
  });
  expect(artifact.entries.get("keep/dirty.txt")).toEqual({
    dirty: true,
    untracked: false,
    tracked: true,
  });
  expect(artifact.entries.get("extra.dat")).toEqual({
    dirty: false,
    untracked: true,
    tracked: false,
  });
});

test("runGit and splitGitNames are shared with git-seed", async () => {
  expect(splitGitNames("keep/a.txt\n\nextra.dat\n")).toEqual(["keep/a.txt", "extra.dat"]);
  const dir = await writeTree({ "x.txt": "x\n" });
  await initGit(dir);
  expect((await runGit(dir, ["rev-parse", "--is-inside-work-tree"])).trim()).toBe("true");
});

test("non-git dir is unavailable", async () => {
  const dir = await writeTree({ "readme.txt": "no git\n" });
  const artifact = await build(dir);
  expect(artifact.available).toBe(false);
  expect(artifact.toplevel).toBeUndefined();
  expect(artifact.entries.size).toBe(0);
});
