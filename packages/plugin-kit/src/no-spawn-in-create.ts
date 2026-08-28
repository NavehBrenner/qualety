import { defineRule, type RuleContext } from "qualety";
import { Node, SourceFile } from "ts-morph";
import {
  entryValue,
  objectInit,
  pluginLiterals,
  resolveBinding,
  ruleCreate,
  unwrapRule,
} from "./ast.ts";

const SUGGESTION =
  "Move process work into provides.build (or a provider plugin); rules only consume artifacts.";

const SPAWN_NAMES = new Set([
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
]);

export const noSpawnInCreate = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Do not spawn processes from a rule create function; providers own binaries via provides.build.",
    },
  },
  create: (context) => {
    const sources = context.getArtifact("typescript").sources;
    for (const unit of sources.values()) {
      if (unit instanceof SourceFile) {
        scanFile(unit, sources, context);
      }
    }
  },
});

function scanFile(
  sourceFile: SourceFile,
  sources: ReadonlyMap<string, unknown>,
  context: Pick<RuleContext, "report">,
) {
  for (const plugin of pluginLiterals(sourceFile)) {
    const rules = objectInit(plugin, "rules");
    if (!Node.isObjectLiteralExpression(rules)) {
      continue;
    }
    for (const prop of rules.getProperties()) {
      const value = entryValue(prop);
      const create =
        value === undefined ? undefined : createFromValue(value, sourceFile, sources, new Set());
      if (create !== undefined) {
        scanCreate(create, context);
      }
    }
  }
}

function createFromValue(
  value: Node,
  sourceFile: SourceFile,
  sources: ReadonlyMap<string, unknown>,
  seen: Set<Node>,
): Node | undefined {
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  if (Node.isIdentifier(value)) {
    const bound = resolveBinding(value.getText(), sourceFile, sources);
    return bound === undefined
      ? undefined
      : createFromValue(bound, bound.getSourceFile(), sources, seen);
  }
  const rule = unwrapRule(value);
  if (rule === undefined) {
    return undefined;
  }
  const create = ruleCreate(rule);
  if (create === undefined) {
    return undefined;
  }
  if (Node.isIdentifier(create)) {
    return resolveBinding(create.getText(), create.getSourceFile(), sources);
  }
  return create;
}

function scanCreate(create: Node, context: Pick<RuleContext, "report">) {
  const sourceFile = create.getSourceFile();
  const file = sourceFile.getFilePath();
  const locals = fileFunctions(sourceFile);
  const reached = new Set<Node>();
  const queue = [create];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || reached.has(current)) {
      continue;
    }
    reached.add(current);
    current.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) {
        return;
      }
      const expr = node.getExpression();
      const api = spawnApi(expr, sourceFile);
      if (api !== undefined) {
        context.report({
          severity: "error",
          file,
          range: {
            start: node.getSourceFile().getLineAndColumnAtPos(node.getStart()),
            end: node.getSourceFile().getLineAndColumnAtPos(node.getEnd()),
          },
          message: `Do not call ${api} inside a rule create function.`,
          suggestion: SUGGESTION,
        });
        return;
      }
      if (Node.isIdentifier(expr)) {
        const target = locals.get(expr.getText());
        if (target !== undefined) {
          queue.push(target);
        }
      }
    });
  }
}

function fileFunctions(sourceFile: SourceFile): Map<string, Node> {
  const map = new Map<string, Node>();
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name !== undefined) {
      map.set(name, fn);
    }
  }
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (
        init !== undefined &&
        (Node.isFunctionDeclaration(init) ||
          Node.isFunctionExpression(init) ||
          Node.isArrowFunction(init) ||
          Node.isMethodDeclaration(init))
      ) {
        map.set(decl.getName(), init);
      }
    }
  }
  return map;
}

function spawnApi(expr: Node, sourceFile: SourceFile): string | undefined {
  if (Node.isIdentifier(expr)) {
    const name = expr.getText();
    return SPAWN_NAMES.has(name) ? name : undefined;
  }
  if (!Node.isPropertyAccessExpression(expr)) {
    return undefined;
  }
  const name = expr.getName();
  const recv = expr.getExpression();
  if (!SPAWN_NAMES.has(name) || !Node.isIdentifier(recv)) {
    return undefined;
  }
  const text = recv.getText();
  if (text === "child_process" || text === "cp" || childProcessNamespaces(sourceFile).has(text)) {
    return name;
  }
  return undefined;
}

function childProcessNamespaces(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const decl of sourceFile.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (
      spec !== "node:child_process" &&
      spec !== "child_process" &&
      spec !== "node:child_process/promises" &&
      spec !== "child_process/promises"
    ) {
      continue;
    }
    const ns = decl.getNamespaceImport();
    if (ns !== undefined) {
      names.add(ns.getText());
    }
    const def = decl.getDefaultImport();
    if (def !== undefined) {
      names.add(def.getText());
    }
  }
  return names;
}
