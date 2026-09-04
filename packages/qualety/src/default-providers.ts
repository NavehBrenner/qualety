import { createGitWorktreeProvider } from "./git-worktree.ts";
import { createTypeScriptProvider } from "./typescript-frontend.ts";

export const DEFAULT_PROVIDERS = {
  typescript: createTypeScriptProvider,
  "git-worktree": createGitWorktreeProvider,
} as const;
