import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function listGitSeed(cwd: string, mode: "upstream" | "worktree"): Promise<string[]> {
  const toplevel = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
  let names: string[];
  if (mode === "worktree") {
    const dirty = splitGitNames(
      await runGit(cwd, ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
    );
    const extra = splitGitNames(await runGit(cwd, ["ls-files", "--others", "--exclude-standard"]));
    names = [...new Set([...dirty, ...extra])];
  } else {
    const upstream =
      (await gitOk(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"])) ??
      (await gitOk(cwd, ["rev-parse", "--verify", "origin/main"])) ??
      (await gitOk(cwd, ["rev-parse", "--verify", "origin/master"]));
    if (upstream === undefined) {
      throw new Error(
        "No upstream base was found (tried @{upstream}, origin/main, origin/master).",
      );
    }
    const base = (await runGit(cwd, ["merge-base", "HEAD", upstream])).trim();
    names = splitGitNames(
      await runGit(cwd, ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`]),
    );
  }
  return names.map((name) => resolve(toplevel, name));
}

async function gitOk(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return (await runGit(cwd, args)).trim();
  } catch {
    return undefined;
  }
}

export async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
    return result.stdout;
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT") {
      throw new Error("git is not available.");
    }
    const stderr =
      typeof e === "object" && e !== null && "stderr" in e && typeof e.stderr === "string"
        ? e.stderr.trim()
        : "";
    const detail = stderr !== "" ? stderr : e instanceof Error ? e.message : String(e);
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

export function splitGitNames(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line !== "");
}
