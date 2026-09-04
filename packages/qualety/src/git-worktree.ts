import { runGit, splitGitNames } from "./git-seed.ts";
import type { ArtifactBuildContext, GitPathStatus, GitWorktreeArtifact } from "./index.ts";

export async function buildGitWorktree(
  context: ArtifactBuildContext,
): Promise<GitWorktreeArtifact> {
  try {
    const toplevel = (await runGit(context.cwd, ["rev-parse", "--show-toplevel"])).trim();
    const [dirtyOut, extraOut, trackedOut] = await Promise.all([
      runGit(context.cwd, ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
      runGit(context.cwd, ["ls-files", "--others", "--exclude-standard"]),
      runGit(context.cwd, ["ls-files"]),
    ]);
    const dirty = new Set(posixNames(dirtyOut));
    const extra = posixNames(extraOut);
    const entries = new Map<string, GitPathStatus>();
    for (const path of posixNames(trackedOut)) {
      entries.set(path, { dirty: dirty.has(path), untracked: false, tracked: true });
    }
    for (const path of extra) {
      entries.set(path, { dirty: false, untracked: true, tracked: false });
    }
    return { toplevel, available: true, entries };
  } catch {
    return { available: false, entries: new Map() };
  }
}

function posixNames(stdout: string): string[] {
  return splitGitNames(stdout).map((name) => name.replaceAll("\\", "/"));
}
