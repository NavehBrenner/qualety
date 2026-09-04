import { buildGitWorktree } from "./git-worktree.ts";
import type { ArtifactProvider } from "./index.ts";
import { createTypeScriptProvider } from "./typescript-frontend.ts";

export const DEFAULT_PROVIDERS = {
  typescript: createTypeScriptProvider,
  "git-worktree": (): ArtifactProvider => ({ build: buildGitWorktree }),
} as const;
