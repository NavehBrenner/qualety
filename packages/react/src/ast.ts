import type { RuleContext } from "qualety";
import {
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  Node,
  SourceFile,
} from "ts-morph";

export type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration;

const HTTP_PACKAGES = ["axios", "ky", "got"] as const;
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);
const QUERY_HOOKS = new Set(["useQuery", "useInfiniteQuery"]);

export function bindFileScan(
  scan: (sf: SourceFile, file: string, context: Pick<RuleContext, "report">) => void,
): (context: RuleContext) => void {
  return (context) => {
    const sources = context.getArtifact("typescript").sources;
    for (const [abs, unit] of sources) {
      if (unit instanceof SourceFile) {
        scan(unit, abs, context);
      }
    }
  };
}

export function isFunctionLike(node: Node): node is FunctionLike {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node)
  );
}

export function isReactSpecifier(spec: string): boolean {
  return spec === "react" || spec.startsWith("react/");
}

export function isHttpPackage(spec: string): boolean {
  return HTTP_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`));
}

export function isTanstackQuerySpecifier(spec: string): boolean {
  return spec === "@tanstack/react-query" || spec.startsWith("@tanstack/react-query/");
}

export function collectReactEffectBindings(sf: SourceFile): {
  effects: Set<string>;
  namespaces: Set<string>;
} {
  const { named, namespaces } = collectMatchingImports(sf, isReactSpecifier);
  const effects = new Set<string>();
  for (const item of named) {
    if (EFFECT_HOOKS.has(item.imported)) {
      effects.add(item.local);
    }
  }
  return { effects, namespaces };
}

export function collectHttpClientBindings(sf: SourceFile): Set<string> {
  const clients = new Set<string>();
  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (!HTTP_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) {
      continue;
    }
    const def = decl.getDefaultImport();
    if (def !== undefined) {
      clients.add(def.getText());
    }
    const ns = decl.getNamespaceImport();
    if (ns !== undefined) {
      clients.add(ns.getText());
    }
    for (const named of decl.getNamedImports()) {
      clients.add(named.getAliasNode()?.getText() ?? named.getName());
    }
  }
  return clients;
}

export function fileDeclaresLocalFetch(sf: SourceFile): boolean {
  for (const stmt of sf.getStatements()) {
    if (Node.isFunctionDeclaration(stmt) && stmt.getName() === "fetch") {
      return true;
    }
    if (Node.isVariableStatement(stmt)) {
      for (const decl of stmt.getDeclarations()) {
        if (decl.getName() === "fetch") {
          return true;
        }
      }
    }
  }
  return false;
}

export function collectQueryHookBindings(sf: SourceFile): {
  hooks: Map<string, string>;
  namespaces: Set<string>;
} {
  const { named, namespaces } = collectMatchingImports(sf, isTanstackQuerySpecifier);
  const hooks = new Map<string, string>();
  for (const item of named) {
    if (QUERY_HOOKS.has(item.imported)) {
      hooks.set(item.local, item.imported);
    }
  }
  return { hooks, namespaces };
}

function collectMatchingImports(sf: SourceFile, matchSpec: (spec: string) => boolean) {
  const named: { local: string; imported: string }[] = [];
  const namespaces = new Set<string>();
  for (const decl of sf.getImportDeclarations()) {
    if (!matchSpec(decl.getModuleSpecifierValue())) {
      continue;
    }
    const def = decl.getDefaultImport();
    if (def !== undefined) {
      namespaces.add(def.getText());
    }
    const ns = decl.getNamespaceImport();
    if (ns !== undefined) {
      namespaces.add(ns.getText());
    }
    for (const item of decl.getNamedImports()) {
      named.push({
        local: item.getAliasNode()?.getText() ?? item.getName(),
        imported: item.getName(),
      });
    }
  }
  return { named, namespaces };
}

export function isEffectCall(call: Node, effects: Set<string>, namespaces: Set<string>): boolean {
  if (!Node.isCallExpression(call)) {
    return false;
  }
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) {
    return effects.has(expr.getText());
  }
  if (Node.isPropertyAccessExpression(expr)) {
    if (!EFFECT_HOOKS.has(expr.getName())) {
      return false;
    }
    const obj = expr.getExpression();
    return Node.isIdentifier(obj) && namespaces.has(obj.getText());
  }
  return false;
}

export function queryHookName(
  call: Node,
  hooks: Map<string, string>,
  namespaces: Set<string>,
): string | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) {
    return hooks.get(expr.getText());
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const name = expr.getName();
    if (!QUERY_HOOKS.has(name)) {
      return undefined;
    }
    const obj = expr.getExpression();
    if (Node.isIdentifier(obj) && namespaces.has(obj.getText())) {
      return name;
    }
  }
  return undefined;
}

export function forbiddenHttpApi(
  call: Node,
  clients: Set<string>,
  localFetch: boolean,
): string | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) {
    const name = expr.getText();
    if (name === "fetch" && !localFetch) {
      return "fetch";
    }
    if (clients.has(name)) {
      return name;
    }
    return undefined;
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const method = expr.getName();
    if (!HTTP_METHODS.has(method)) {
      return undefined;
    }
    const obj = expr.getExpression();
    if (Node.isIdentifier(obj) && clients.has(obj.getText())) {
      return `${obj.getText()}.${method}`;
    }
  }
  return undefined;
}

export function isIifeCallee(fn: Node): boolean {
  let current: Node = fn;
  let parent = fn.getParent();
  while (parent !== undefined && Node.isParenthesizedExpression(parent)) {
    current = parent;
    parent = parent.getParent();
  }
  return (
    parent !== undefined && Node.isCallExpression(parent) && parent.getExpression() === current
  );
}

export function inlineCallback(call: Node): Node | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }
  const arg = call.getArguments()[0];
  if (arg === undefined) {
    return undefined;
  }
  if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
    return arg;
  }
  return undefined;
}

export function enclosingFunction(node: Node): FunctionLike | undefined {
  let parent = node.getParent();
  while (parent !== undefined) {
    if (
      Node.isFunctionDeclaration(parent) ||
      Node.isFunctionExpression(parent) ||
      Node.isArrowFunction(parent) ||
      Node.isMethodDeclaration(parent)
    ) {
      return parent;
    }
    parent = parent.getParent();
  }
  return undefined;
}
