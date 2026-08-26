import { resolve } from "node:path";

const COMPANION_PAIRS = [
  ["docs/rulesets/typescript.md", "packages/typescript/src/index.ts"],
  ["docs/rulesets/react.md", "packages/react/src/index.ts"],
  ["docs/rulesets/dry.md", "packages/dry/src/index.ts"],
  ["docs/rulesets/dev.md", "packages/dev/src/index.ts"],
  ["docs/rulesets/plugin-kit.md", "packages/plugin-kit/src/index.ts"],
  ["docs/api.md", "packages/qualety/src/index.ts"],
] as const;

export function expandCompanions(
  cwd: string,
  workspaceFiles: readonly string[],
  closedFiles: readonly string[],
): string[] {
  const workspace = new Set(workspaceFiles.map((file) => resolve(cwd, file)));
  const closed = new Set(closedFiles.map((file) => resolve(cwd, file)));
  for (const [doc, code] of COMPANION_PAIRS) {
    const docAbs = resolve(cwd, doc);
    const codeAbs = resolve(cwd, code);
    if (!closed.has(docAbs) && !closed.has(codeAbs)) {
      continue;
    }
    if (workspace.has(docAbs)) {
      closed.add(docAbs);
    }
    if (workspace.has(codeAbs)) {
      closed.add(codeAbs);
    }
  }
  return [...closed].sort();
}
