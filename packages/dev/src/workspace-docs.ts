import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactBuildContext } from "qualety";

export const WORKSPACE_DOC_PATHS = [
  "docs/api.md",
  "docs/rulesets/typescript.md",
  "docs/rulesets/react.md",
  "docs/rulesets/dry.md",
  "docs/rulesets/dev.md",
  "packages/qualety/package.json",
] as const;

export type WorkspaceDocs = {
  readonly files: ReadonlyMap<string, string>;
};

declare module "qualety" {
  interface ArtifactMap {
    "workspace-docs": WorkspaceDocs;
  }
}

export async function buildWorkspaceDocs(context: ArtifactBuildContext): Promise<WorkspaceDocs> {
  const files = new Map<string, string>();
  for (const rel of WORKSPACE_DOC_PATHS) {
    try {
      files.set(rel, await readFile(join(context.cwd, rel), "utf8"));
    } catch {}
  }
  return { files };
}
