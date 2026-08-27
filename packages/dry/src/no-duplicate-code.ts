import { basename, relative, resolve } from "node:path";
import { defineRule, type Violation } from "qualety";
import { Node, SourceFile, type Statement, SyntaxKind } from "ts-morph";
import type { DupehoundIndex } from "./dupehound.ts";

const MIN_WINDOW_LINES = 3;
const JOINT_LOC_GATE = 20;
const REPS_GATE = 4;

type CloneArm = "F" | "W";

type CloneSpan = {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  host: string;
  loc: number;
};

type CloneCluster = {
  arm: CloneArm;
  similarity: number;
  members: CloneSpan[];
};

type CloneReport = {
  arm: CloneArm;
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  item: Omit<Violation, "ruleId">;
};

export const noDuplicateCode = defineRule({
  meta: {
    requires: ["dupehound", "typescript"],
    docs: {
      description:
        "No duplicate logical code (whole functions or repeated fragments) in included non-test sources.",
    },
  },
  create(context) {
    const index = context.getArtifact("dupehound");
    const artifact = context.getArtifact("typescript");
    const cwd = context.getCwd();
    const functionClusters: CloneCluster[] = [];
    for (const cluster of index.clusters) {
      const members = cluster.members.filter((member) =>
        /\.(?:ts|tsx|mts|cts)$/.test(member.file.replaceAll("\\", "/")),
      );
      if (members.length < 2) {
        continue;
      }
      functionClusters.push({
        arm: "F",
        similarity: cluster.similarity,
        members: members.map((member) => ({
          file: member.file,
          startLine: member.startLine,
          startColumn: 1,
          endLine: member.endLine,
          endColumn: 1,
          host: member.name,
          loc: member.endLine - member.startLine + 1,
        })),
      });
    }
    const merged = mergeReports([
      ...reportsFromClusters(functionClusters),
      ...reportsFromClusters(clustersFromWindows(artifact.sources, cwd)),
    ]);
    for (const report of merged) {
      context.report(report.item);
    }
  },
});

export function reportsFromIndex(index: DupehoundIndex): Omit<Violation, "ruleId">[] {
  const clusters: CloneCluster[] = [];
  for (const cluster of index.clusters) {
    clusters.push({
      arm: "F",
      similarity: cluster.similarity,
      members: cluster.members.map((member) => ({
        file: member.file,
        startLine: member.startLine,
        startColumn: 1,
        endLine: member.endLine,
        endColumn: 1,
        host: member.name,
        loc: member.endLine - member.startLine + 1,
      })),
    });
  }
  const out: Omit<Violation, "ruleId">[] = [];
  for (const report of reportsFromClusters(clusters)) {
    if (report.item.message.length > 0) {
      out.push(report.item);
    }
  }
  return out;
}

function clustersFromWindows(sources: ReadonlyMap<string, unknown>, cwd: string): CloneCluster[] {
  const buckets = new Map<string, CloneSpan[]>();
  for (const [abs, unit] of sources) {
    if (!(unit instanceof SourceFile) || skipFile(abs, cwd)) {
      continue;
    }
    const file = displayFile(cwd, abs);
    unit.forEachDescendant((node) => {
      if (Node.isBlock(node)) {
        addListWindows(unit, file, node.getStatements(), buckets);
        return;
      }
      if (Node.isCaseClause(node) || Node.isDefaultClause(node)) {
        addListWindows(unit, file, node.getStatements(), buckets);
      }
    });
  }
  const clusters: CloneCluster[] = [];
  for (const members of buckets.values()) {
    if (members.length >= 2) {
      clusters.push({ arm: "W", similarity: 1, members });
    }
  }
  return clusters;
}

function addListWindows(
  sourceFile: SourceFile,
  file: string,
  statements: Statement[],
  buckets: Map<string, CloneSpan[]>,
) {
  const fullText = sourceFile.getFullText();
  for (let start = 0; start < statements.length; start += 1) {
    addWindowsFrom(sourceFile, file, statements, start, fullText, buckets);
  }
}

function addWindowsFrom(
  sourceFile: SourceFile,
  file: string,
  statements: Statement[],
  start: number,
  fullText: string,
  buckets: Map<string, CloneSpan[]>,
) {
  for (let end = start; end < statements.length; end += 1) {
    const first = statements[start];
    const last = statements[end];
    if (first === undefined || last === undefined) {
      continue;
    }
    const loc = fullText
      .slice(first.getStart(), last.getEnd())
      .split("\n")
      .filter((line) => line.trim() !== "").length;
    const count = end - start + 1;
    if (
      loc < MIN_WINDOW_LINES ||
      (count === 1 && (CONTROL_KINDS.has(first.getKind()) || hasNestedFunctionLike(first))) ||
      (count === 2 && loc < 10)
    ) {
      continue;
    }
    const startPos = sourceFile.getLineAndColumnAtPos(first.getStart());
    const endPos = sourceFile.getLineAndColumnAtPos(last.getEnd());
    const parts: string[] = [];
    for (const statement of statements.slice(start, end + 1)) {
      hashNode(statement, parts);
    }
    const span: CloneSpan = {
      file,
      startLine: startPos.line,
      startColumn: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column,
      host: hostName(first),
      loc,
    };
    const key = parts.join("\0");
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [span]);
    } else {
      bucket.push(span);
    }
  }
}

function hashNode(node: Node, parts: string[]) {
  parts.push(`K${node.getKind()}`);
  if (hashNestedFunctionLike(node, parts)) {
    return;
  }
  if (Node.isIdentifier(node)) {
    parts.push(keptNameText(node));
    return;
  }
  if (Node.isPrivateIdentifier(node)) {
    parts.push(keptNameText(node));
    return;
  }
  if (Node.isStringLiteral(node)) {
    parts.push(node.getText());
    return;
  }
  if (Node.isNoSubstitutionTemplateLiteral(node)) {
    parts.push(node.getText());
    return;
  }
  if (Node.isNumericLiteral(node)) {
    parts.push(node.getText());
    return;
  }
  if (Node.isBigIntLiteral(node)) {
    parts.push(node.getText());
    return;
  }
  if (Node.isRegularExpressionLiteral(node)) {
    parts.push(node.getText());
    return;
  }
  const kind = node.getKind();
  if (
    kind === SyntaxKind.TemplateHead ||
    kind === SyntaxKind.TemplateMiddle ||
    kind === SyntaxKind.TemplateTail
  ) {
    parts.push(node.getText());
    return;
  }
  for (const child of node.getChildren()) {
    hashNode(child, parts);
  }
}

function hashNestedFunctionLike(node: Node, parts: string[]): boolean {
  if (!NESTED_FN_KINDS.has(node.getKind())) {
    return false;
  }
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    const nameNode = node.getNameNode();
    if (nameNode !== undefined) {
      parts.push(keptNameText(nameNode));
    }
  }
  return true;
}

function hasNestedFunctionLike(node: Node): boolean {
  if (NESTED_FN_KINDS.has(node.getKind())) {
    return true;
  }
  for (const child of node.getChildren()) {
    if (hasNestedFunctionLike(child)) {
      return true;
    }
  }
  return false;
}

function keptNameText(node: Node): string {
  const parent = node.getParent();
  if (parent === undefined) {
    return "#";
  }
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
    return node.getText();
  }
  if (Node.isMetaProperty(parent) && parent.getNameNode() === node) {
    return node.getText();
  }
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) {
    return node.getText();
  }
  if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node) {
    return node.getText();
  }
  if (Node.isMethodDeclaration(parent) && parent.getNameNode() === node) {
    return node.getText();
  }
  if (Node.isPropertyDeclaration(parent) && parent.getNameNode() === node) {
    return node.getText();
  }
  if (Node.isJsxAttribute(parent) && parent.getNameNode() === node) {
    return node.getText();
  }
  return "#";
}

const NESTED_FN_KINDS = new Set<SyntaxKind>([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
]);

const CONTROL_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.TryStatement,
  SyntaxKind.SwitchStatement,
]);

function hostName(node: Node): string {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current)) {
      return current.getName() ?? "<anonymous>";
    }
    if (Node.isFunctionExpression(current) || Node.isArrowFunction(current)) {
      const parent = current.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (Node.isFunctionExpression(current)) {
        return current.getName() ?? "<anonymous>";
      }
      return "<anonymous>";
    }
    current = current.getParent();
  }
  return "<anonymous>";
}

function skipFile(abs: string, cwd: string): boolean {
  const relativePath = displayFile(cwd, abs);
  const base = basename(relativePath);
  const parts = relativePath.split("/");
  return (
    /\.d\.(?:ts|mts|cts)$/.test(base) ||
    /\.(?:test|spec)\./.test(base) ||
    parts.includes("__tests__") ||
    parts.includes("fixtures")
  );
}

function displayFile(cwd: string, file: string): string {
  const abs = resolve(cwd, file);
  const rel = relative(cwd, abs);
  return (rel === "" ? file : rel).split("\\").join("/");
}

function reportsFromClusters(clusters: CloneCluster[]): CloneReport[] {
  const reports: CloneReport[] = [];
  for (const cluster of clusters) {
    reports.push(...reportsFromCluster(cluster));
  }
  return reports;
}

function reportsFromCluster(cluster: CloneCluster): CloneReport[] {
  if (cluster.members.length < 2) {
    return [];
  }
  const windowLoc = Math.min(...cluster.members.map((member) => member.loc));
  const repetitions = cluster.members.length;
  if (windowLoc * repetitions < JOINT_LOC_GATE && repetitions < REPS_GATE) {
    return [];
  }
  const members = cluster.members.slice().sort((left, right) => {
    return (
      left.file.localeCompare(right.file) ||
      left.startLine - right.startLine ||
      left.startColumn - right.startColumn
    );
  });
  const rep = members[0];
  if (rep === undefined) {
    return [];
  }
  return members.slice(1).map((member) => ({
    arm: cluster.arm,
    file: member.file,
    startLine: member.startLine,
    startColumn: member.startColumn,
    endLine: member.endLine,
    endColumn: member.endColumn,
    item: cluster.arm === "F" ? armFReport(member, rep, cluster) : armWReport(member, rep),
  }));
}

function armFReport(
  member: CloneSpan,
  rep: CloneSpan,
  cluster: CloneCluster,
): Omit<Violation, "ruleId"> {
  const pct = Math.round(cluster.similarity * 100);
  return {
    severity: "error",
    file: member.file,
    range: {
      start: { line: member.startLine, column: 1 },
      end: { line: member.endLine, column: 1 },
    },
    message: `"${member.host}" is duplicate logical code of "${rep.host}" in ${rep.file}:${rep.startLine} (${pct}% similar).`,
    suggestion: `Reuse "${rep.host}" from ${rep.file}:${rep.startLine} instead of reimplementing it.`,
  };
}

function armWReport(member: CloneSpan, rep: CloneSpan): Omit<Violation, "ruleId"> {
  return {
    severity: "error",
    file: member.file,
    range: {
      start: { line: member.startLine, column: member.startColumn },
      end: { line: member.endLine, column: member.endColumn },
    },
    message: `"${member.host}" contains duplicate logical code of "${rep.host}" in ${rep.file}:${rep.startLine}.`,
    suggestion: `Extract a shared helper from ${rep.file}:${rep.startLine} and call it from both sites.`,
  };
}

function mergeReports(reports: CloneReport[]): CloneReport[] {
  const ranked = reports.slice().sort((left, right) => {
    const span = right.endLine - right.startLine - (left.endLine - left.startLine);
    if (span !== 0) {
      return span;
    }
    if (left.arm !== right.arm) {
      return left.arm === "F" ? -1 : 1;
    }
    return (
      left.file.localeCompare(right.file) ||
      left.startLine - right.startLine ||
      left.startColumn - right.startColumn
    );
  });
  const kept: CloneReport[] = [];
  for (const item of ranked) {
    if (
      !kept.some(
        (other) =>
          other.file === item.file &&
          !(other.endLine < item.startLine || item.endLine < other.startLine),
      )
    ) {
      kept.push(item);
    }
  }
  return kept.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.startLine - right.startLine ||
      left.startColumn - right.startColumn,
  );
}
