import {
  asNodes,
  isPythonNode,
  nodeRange,
  type PythonNode,
  type PythonSource,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import { defineRule, type GitWorktreeArtifact, type RuleContext } from "qualety";
import { attrChain, callKeyword, forEachMlSource, lastAttr, treeHas } from "./ast.ts";
import { enclosingDef, isArtifactSave } from "./provenance.ts";

const HINT =
  "Write to a staging path and os.replace onto the final name (or write under a unique run directory); do not clobber a tracked or dirty artifact path in place.";

const ARTIFACT_NAME =
  /checkpoint|artifact|weights|output|model\.pt|\.ckpt|\.safetensors|\.pth$|\.pt$|\.joblib$|\.pkl$/i;

export const noInplaceArtifactClobber = defineRule({
  meta: {
    requires: ["python", "git-worktree"],
    docs: {
      description:
        "Do not overwrite a tracked or dirty artifact path in place; write to a staging path and os.replace onto the final name.",
    },
  },
  create(context) {
    const python = context.getArtifact("python");
    const git = context.getArtifact("git-worktree");
    if (!git.available) {
      return;
    }
    const toplevel = git.toplevel;
    if (toplevel === undefined) {
      return;
    }
    forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
      walkNodes(unit.tree, (node) => {
        considerWrite(node, unit, toplevel, git, context);
      });
    });
  },
});

function considerWrite(
  node: PythonNode,
  unit: PythonSource,
  toplevel: string,
  git: GitWorktreeArtifact,
  context: RuleContext<readonly ["python", "git-worktree"]>,
): void {
  const saved = saveDest(node);
  const dest = saved ?? pathWriteDest(node);
  if (dest === undefined) {
    return;
  }
  const scope = enclosingDef(unit.tree, node) ?? unit.tree;
  if (saved === undefined && !ARTIFACT_NAME.test(dest) && !treeHas(scope, isArtifactSave)) {
    return;
  }
  if (hasAtomicReplace(scope, dest)) {
    return;
  }
  const key = gitPathKey(dest, unit.file, toplevel, git.entries);
  if (key === undefined) {
    return;
  }
  context.report({
    severity: "error",
    file: unit.file,
    range: nodeRange(node),
    message: `In-place write clobbers tracked or dirty artifact path "${key}".`,
    suggestion: HINT,
  });
}

function saveDest(node: PythonNode): string | undefined {
  if (node._type !== "Call") {
    return undefined;
  }
  const chain = attrChain(node.func);
  const tail = chain[chain.length - 1];
  if (tail === "save" && chain[0] === "torch") {
    return stringConstant(asNodes(node.args)[1] ?? callKeyword(node, "f"));
  }
  if (tail === "dump" && chain[0] === "joblib") {
    return stringConstant(asNodes(node.args)[1] ?? callKeyword(node, "filename"));
  }
  return undefined;
}

function pathWriteDest(node: PythonNode): string | undefined {
  if (node._type !== "Call") {
    return undefined;
  }
  const name = lastAttr(node.func);
  if (name === "open") {
    const mode =
      stringConstant(callKeyword(node, "mode")) ?? stringConstant(asNodes(node.args)[1]) ?? "";
    return mode === "w" || mode === "wb" ? stringConstant(asNodes(node.args)[0]) : undefined;
  }
  if (name !== "write_bytes") {
    return undefined;
  }
  if (
    !isPythonNode(node.func) ||
    node.func._type !== "Attribute" ||
    !isPythonNode(node.func.value)
  ) {
    return undefined;
  }
  const recv = node.func.value;
  if (recv._type !== "Call" || lastAttr(recv.func) !== "Path") {
    return undefined;
  }
  return stringConstant(asNodes(recv.args)[0]);
}

function hasAtomicReplace(scope: PythonNode, dest: string): boolean {
  const dests: string[] = [];
  walkNodes(scope, (node) => {
    if (node._type !== "Call" || lastAttr(node.func) !== "replace") {
      return;
    }
    const target = stringConstant(asNodes(node.args)[1] ?? asNodes(node.args)[0]);
    if (target !== undefined) {
      dests.push(target);
    }
  });
  return dests.includes(dest);
}

function gitPathKey(
  dest: string,
  sourceFile: string,
  toplevel: string,
  entries: GitWorktreeArtifact["entries"],
): string | undefined {
  const posix = dest.replaceAll("\\", "/").replace(/^\.\//, "");
  const root = toplevel.replaceAll("\\", "/");
  const stripped = posix.startsWith(`${root}/`) ? posix.slice(root.length + 1) : posix;
  if (entries.has(stripped)) {
    return stripped;
  }
  if (posix.startsWith("/")) {
    return undefined;
  }
  const sourcePosix = sourceFile.replaceAll("\\", "/");
  const slash = sourcePosix.lastIndexOf("/");
  const parent = slash === -1 ? sourcePosix : sourcePosix.slice(0, slash);
  const joined = `${parent}/${posix}`;
  if (!joined.startsWith(`${root}/`)) {
    return undefined;
  }
  const relative = joined.slice(root.length + 1);
  return entries.has(relative) ? relative : undefined;
}
