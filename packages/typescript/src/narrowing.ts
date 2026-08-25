import type { RuleContext } from "qualety";
import {
  type CallExpression,
  Node,
  SourceFile,
  SyntaxKind,
  type Type,
  type TypeNode,
} from "ts-morph";
import {
  aliasesOf,
  type FunctionLike,
  firstArgIdentifier,
  isFunctionLike,
  isSchemaParseCall,
} from "./parse-flow.ts";

export type CheckCandidate = {
  node: Node;
  subject: string;
  kind:
    | "predicate"
    | "typeof"
    | "instanceof"
    | "nullish"
    | "truthiness"
    | "nonempty"
    | "schema-parse";
};

export type ConstantHit = {
  polarity: "true" | "false";
  reason: "param-type" | "prior-guard" | "call-site" | "literal" | "prior-parse";
  suggestion: string;
  reportAt: Node;
  message?: string;
};

const TIGHTEN_OR_DROP =
  "Tighten the callee parameter type to match what callers already pass, or remove this internal check.";
const DROP_INTERNAL =
  "Remove this check or the dead branch; the parameter type already implies it.";
const DROP_RESTATED = "Remove the restated guard and use the already-narrowed binding.";
const DROP_PARSE =
  "Remove the second parse or restated hand-guard; use the parsed .data / narrowed binding.";
const DROP_LITERAL = "Remove this branch; the condition is constant.";
const DROP_CALLER = "Remove this guard if it exists only to satisfy the call.";

export function unwrapParens(node: Node): Node {
  let current = node;
  while (Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

export function splitNegation(node: Node): { inner: Node; negated: boolean } {
  let current = unwrapParens(node);
  let negated = false;
  while (
    Node.isPrefixUnaryExpression(current) &&
    current.getOperatorToken() === SyntaxKind.ExclamationToken
  ) {
    negated = !negated;
    current = unwrapParens(current.getOperand());
  }
  return { inner: current, negated };
}

export function bindFunctionScan(
  scan: (
    fn: FunctionLike,
    file: string,
    sourceFile: SourceFile,
    context: Pick<RuleContext, "report">,
    reported: Set<string>,
  ) => void,
): (context: RuleContext) => void {
  return (context) => {
    const sources = context.getArtifact("typescript").sources;
    for (const [abs, unit] of sources) {
      if (!(unit instanceof SourceFile)) {
        continue;
      }
      const reported = new Set<string>();
      unit.forEachDescendant((node) => {
        if (isFunctionLike(node)) {
          scan(node, abs, unit, context, reported);
        }
      });
    }
  };
}

export function classifyCondition(fn: FunctionLike, cond: Node): CheckCandidate | undefined {
  const { inner } = splitNegation(unwrapParens(cond));
  return classifyExpr(fn, inner);
}

export function conditionLeaves(fn: FunctionLike, cond: Node): CheckCandidate[] {
  const found: CheckCandidate[] = [];
  const queue = [cond];
  while (queue.length > 0) {
    const expr = unwrapParens(queue.pop() ?? cond);
    if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === "&&") {
      queue.push(expr.getLeft(), expr.getRight());
      continue;
    }
    const cand = classifyCondition(fn, expr);
    if (cand !== undefined) {
      found.push(cand);
    }
  }
  return found;
}

function classifyExpr(fn: FunctionLike, node: Node): CheckCandidate | undefined {
  const expr = unwrapParens(node);
  return classifyIdent(fn, expr) ?? classifyCall(expr) ?? classifyBinary(expr);
}

function classifyIdent(fn: FunctionLike, expr: Node): CheckCandidate | undefined {
  if (!Node.isIdentifier(expr)) {
    return undefined;
  }
  let init: Node | undefined;
  fn.forEachDescendant((node) => {
    if (Node.isVariableDeclaration(node) && node.getName() === expr.getText()) {
      init = node.getInitializer();
    }
  });
  if (init !== undefined) {
    const fromInit = classifyExpr(fn, init);
    if (fromInit !== undefined) {
      return fromInit;
    }
  }
  const type = expr.getType();
  if (
    !(type.isBoolean() && !type.isBooleanLiteral() && !type.isUnion()) &&
    type.isUnion() &&
    hasNullish(type)
  ) {
    return { node: expr, subject: expr.getText(), kind: "truthiness" };
  }
  return undefined;
}

function classifyCall(expr: Node): CheckCandidate | undefined {
  if (!Node.isCallExpression(expr)) {
    return undefined;
  }
  const arg = expr.getArguments()[0];
  if (arg === undefined || !Node.isIdentifier(arg)) {
    return undefined;
  }
  const subject = arg.getText();
  const callee = expr.getExpression();
  if (isSchemaParseCall(expr)) {
    return { node: expr, subject, kind: "schema-parse" };
  }
  const guardName = Node.isIdentifier(callee)
    ? callee.getText()
    : Node.isPropertyAccessExpression(callee)
      ? callee.getName()
      : undefined;
  if (hasTypePredicate(expr) || (guardName !== undefined && /^(is|assert)[A-Z]/.test(guardName))) {
    return { node: expr, subject, kind: "predicate" };
  }
  return undefined;
}

function classifyNullishBinary(
  node: Node,
  op: string,
  left: Node,
  right: Node,
): CheckCandidate | undefined {
  if (
    (op !== "===" && op !== "==" && op !== "!==" && op !== "!=") ||
    !(isNullishLiteral(left) || isNullishLiteral(right))
  ) {
    return undefined;
  }
  if (Node.isIdentifier(left) && isNullishLiteral(right)) {
    return { node, subject: left.getText(), kind: "nullish" };
  }
  if (Node.isIdentifier(right) && isNullishLiteral(left)) {
    return { node, subject: right.getText(), kind: "nullish" };
  }
  const objectName = objectVsNullish(left, right);
  if (objectName !== undefined) {
    return { node, subject: objectName, kind: "nullish" };
  }
  return undefined;
}

function classifyBinary(node: Node): CheckCandidate | undefined {
  if (!Node.isBinaryExpression(node)) {
    return undefined;
  }
  const op = node.getOperatorToken().getText();
  const left = unwrapParens(node.getLeft());
  const right = unwrapParens(node.getRight());
  if (op === "instanceof" && Node.isIdentifier(left)) {
    return { node, subject: left.getText(), kind: "instanceof" };
  }
  const typeofId = typeofOperand(left) ?? typeofOperand(right);
  const lit = stringLit(left) ?? stringLit(right);
  if (
    typeofId !== undefined &&
    lit !== undefined &&
    (op === "===" || op === "==" || op === "!==" || op === "!=")
  ) {
    return { node, subject: typeofId, kind: "typeof" };
  }
  const nullish = classifyNullishBinary(node, op, left, right);
  if (nullish !== undefined) {
    return nullish;
  }
  const nonEmpty = nonEmptySubject(node);
  if (nonEmpty !== undefined) {
    return { node, subject: nonEmpty, kind: "nonempty" };
  }
  return undefined;
}
export function diagnoseConstant(
  fn: FunctionLike,
  cond: Node,
  sourceFile: SourceFile,
): ConstantHit | undefined {
  const literal = literalConstant(cond);
  if (literal !== undefined) {
    return literal;
  }
  const cand = classifyCondition(fn, cond);
  if (cand === undefined) {
    return undefined;
  }
  const { negated } = splitNegation(unwrapParens(cond));
  return (
    priorParseHit(fn, cand, cond, negated) ??
    paramTypeHit(fn, cand, cond, negated) ??
    priorGuardHit(fn, cand, cond, negated) ??
    diagnoseAllCallers(fn, cand, cond, negated, sourceFile)
  );
}

function priorParseHit(
  fn: FunctionLike,
  cand: CheckCandidate,
  cond: Node,
  negated: boolean,
): ConstantHit | undefined {
  if (
    !hasPriorParse(fn, cand.subject, cond.getStart()) ||
    (cand.kind !== "predicate" &&
      cand.kind !== "typeof" &&
      cand.kind !== "nullish" &&
      cand.kind !== "schema-parse")
  ) {
    return undefined;
  }
  return {
    polarity: negated ? "false" : "true",
    reason: "prior-parse",
    suggestion: DROP_PARSE,
    reportAt: cond,
  };
}

function paramTypeHit(
  fn: FunctionLike,
  cand: CheckCandidate,
  cond: Node,
  negated: boolean,
): ConstantHit | undefined {
  const param = fn.getParameters().find((item) => item.getName() === cand.subject);
  if (param === undefined) {
    return undefined;
  }
  const implied = declaredTypeImplies(param, cand);
  if (implied === undefined) {
    return undefined;
  }
  return {
    polarity: (negated ? !implied : implied) ? "true" : "false",
    reason: "param-type",
    suggestion: DROP_INTERNAL,
    reportAt: cond,
  };
}

function priorGuardHit(
  fn: FunctionLike,
  cand: CheckCandidate,
  cond: Node,
  negated: boolean,
): ConstantHit | undefined {
  if (!priorFactImplies(fn, cond, cand)) {
    return undefined;
  }
  return {
    polarity: negated ? "false" : "true",
    reason: "prior-guard",
    suggestion: DROP_RESTATED,
    reportAt: cond,
  };
}

export function mixedCallerHits(fn: FunctionLike, sourceFile: SourceFile): ConstantHit[] {
  const hits: ConstantHit[] = [];
  for (const cond of conditionNodes(fn)) {
    hits.push(...mixedHitsForCondition(fn, cond, sourceFile));
  }
  return hits;
}

function mixedHitsForCondition(
  fn: FunctionLike,
  cond: Node,
  sourceFile: SourceFile,
): ConstantHit[] {
  const cand = classifyCondition(fn, cond);
  if (cand === undefined) {
    return [];
  }
  const paramIndex = fn.getParameters().findIndex((item) => item.getName() === cand.subject);
  if (paramIndex < 0) {
    return [];
  }
  const calls = sameFileCalls(sourceFile, fn);
  if (calls.length < 2) {
    return [];
  }
  const implying = calls.filter((call) => argImpliesGuard(call, paramIndex, cand));
  if (implying.length === 0 || implying.length === calls.length) {
    return [];
  }
  return implying.flatMap((call) => mixedHitForCall(call, paramIndex, cand));
}

function mixedHitForCall(
  call: CallExpression,
  paramIndex: number,
  cand: CheckCandidate,
): ConstantHit[] {
  const caller = enclosingFunction(call);
  const arg = call.getArguments()[paramIndex];
  if (caller === undefined || arg === undefined || !Node.isIdentifier(arg)) {
    return [];
  }
  const guard = wrappingGuard(call, caller, arg.getText(), cand);
  if (guard === undefined || bindingUsedElsewhere(caller, arg.getText(), [call, guard])) {
    return [];
  }
  return [
    {
      polarity: "true",
      reason: "call-site",
      suggestion: DROP_CALLER,
      reportAt: guard,
      message: "This check is redundant given the subsequent call.",
    },
  ];
}

export function secondParseNodes(fn: FunctionLike): Node[] {
  const seen = new Set<string>();
  const extras: Node[] = [];
  walkOwn(fn, (node) => {
    if (!isSchemaParseCall(node)) {
      return;
    }
    const name = firstArgIdentifier(node);
    if (name === undefined) {
      return;
    }
    const names = aliasesOf(fn, name);
    const key = [...names].sort().join(",");
    if (seen.has(key) || [...names].some((alias) => seen.has(alias))) {
      extras.push(node);
      return;
    }
    for (const alias of names) {
      seen.add(alias);
    }
  });
  return extras;
}

export function hasPriorParse(fn: FunctionLike, subject: string, before: number): boolean {
  const names = aliasesOf(fn, subject);
  let found = false;
  walkOwn(fn, (node) => {
    if (node.getStart() >= before || !isSchemaParseCall(node)) {
      return;
    }
    const arg = firstArgIdentifier(node);
    if (arg !== undefined && names.has(arg)) {
      found = true;
    }
  });
  return found;
}

export function isStrictRefinement(before: Type, after: Type): boolean {
  if (before.getText() === after.getText()) {
    return false;
  }
  return after.isAssignableTo(before) && !before.isAssignableTo(after);
}

export function subjectIdentIn(root: Node, name: string): Node | undefined {
  if (Node.isIdentifier(root) && root.getText() === name) {
    return root;
  }
  let found: Node | undefined;
  root.forEachDescendant((node) => {
    if (found !== undefined) {
      return;
    }
    if (Node.isIdentifier(node)) {
      if (node.getText() === name && !declaresName(node)) {
        found = node;
      }
    }
  });
  return found;
}

export function conditionNodes(fn: FunctionLike): Node[] {
  const nodes: Node[] = [];
  walkOwn(fn, (node) => {
    if (Node.isIfStatement(node)) {
      nodes.push(node.getExpression());
    }
    if (Node.isConditionalExpression(node)) {
      nodes.push(node.getCondition());
    }
  });
  return nodes;
}

export function truePathRoot(cond: Node): Node | undefined {
  const parent = cond.getParent();
  if (parent === undefined) {
    return undefined;
  }
  const { negated } = splitNegation(unwrapParens(cond));
  if (Node.isIfStatement(parent) && parent.getExpression() === cond) {
    if (negated) {
      return parent.getElseStatement();
    }
    return parent.getThenStatement();
  }
  if (Node.isConditionalExpression(parent) && parent.getCondition() === cond) {
    return negated ? parent.getWhenFalse() : parent.getWhenTrue();
  }
  return undefined;
}

function diagnoseAllCallers(
  fn: FunctionLike,
  cand: CheckCandidate,
  cond: Node,
  negated: boolean,
  sourceFile: SourceFile,
): ConstantHit | undefined {
  const paramIndex = fn.getParameters().findIndex((item) => item.getName() === cand.subject);
  if (paramIndex < 0) {
    return undefined;
  }
  const calls = sameFileCalls(sourceFile, fn);
  if (calls.length === 0) {
    return undefined;
  }
  if (!calls.every((call) => argImpliesGuard(call, paramIndex, cand))) {
    return undefined;
  }
  return {
    polarity: negated ? "false" : "true",
    reason: "call-site",
    suggestion: TIGHTEN_OR_DROP,
    reportAt: cond,
  };
}

function literalConstant(cond: Node): ConstantHit | undefined {
  const type = unwrapParens(cond).getType();
  if (!type.isBooleanLiteral()) {
    return undefined;
  }
  return {
    polarity: type.getText() === "true" ? "true" : "false",
    reason: "literal",
    suggestion: DROP_LITERAL,
    reportAt: cond,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: kind dispatch; splitting recreates single-use helpers
function declaredTypeImplies(
  param: { getTypeNode: () => TypeNode | undefined; getType: () => Type },
  cand: CheckCandidate,
): boolean | undefined {
  const typeNode = param.getTypeNode();
  if (typeNode === undefined) {
    return undefined;
  }
  const text = typeNode.getText().trim();
  if (cand.kind === "typeof") {
    const lit = typeofLiteralFrom(cand.node);
    if (lit === undefined || text.includes("|")) {
      return undefined;
    }
    return text === lit ? true : undefined;
  }
  if (cand.kind === "nullish") {
    return /\bnull\b|\bundefined\b|\?/.test(text) ? undefined : true;
  }
  if (cand.kind === "predicate" && Node.isCallExpression(cand.node)) {
    const target = predicateTargetType(cand.node);
    const paramType = param.getType();
    if (target === undefined || !isUsableType(target) || !isUsableType(paramType)) {
      return undefined;
    }
    return paramType.isAssignableTo(target) ? true : undefined;
  }
  return undefined;
}

function priorFactImplies(fn: FunctionLike, cond: Node, cand: CheckCandidate): boolean {
  for (const earlier of conditionNodes(fn)) {
    if (earlier.getStart() >= cond.getStart()) {
      continue;
    }
    const prev = classifyCondition(fn, earlier);
    if (prev === undefined || !sameGuardShape(prev, cand)) {
      continue;
    }
    const pathRoot = truePathRoot(earlier);
    if (pathRoot !== undefined && containsNode(pathRoot, cond)) {
      return true;
    }
  }
  return false;
}

function isUsableType(type: Type): boolean {
  return !type.isAny() && !type.isNever() && type.getText() !== "error";
}

export function shouldReportUnchanged(cand: CheckCandidate, before: Type, after: Type): boolean {
  if (cand.kind === "nonempty") {
    return !isNonEmptyType(after);
  }
  if (!isUsableType(before) || !isUsableType(after)) {
    return false;
  }
  if (cand.kind === "instanceof") {
    return false;
  }
  if (cand.kind === "predicate") {
    if (!Node.isCallExpression(cand.node)) {
      return false;
    }
    const target = predicateTargetType(cand.node);
    if (target !== undefined && isUsableType(target) && before.isAssignableTo(target)) {
      return false;
    }
    return isBareBooleanGuard(cand.node);
  }
  return true;
}

function isBareBooleanGuard(node: Node): boolean {
  if (!Node.isCallExpression(node)) {
    return false;
  }
  if (hasTypePredicate(node)) {
    return true;
  }
  const signature = node.getProject().getTypeChecker().getResolvedSignature(node);
  if (signature === undefined) {
    return false;
  }
  const ret = signature.getReturnType();
  return ret.isBoolean() && !ret.isBooleanLiteral();
}

function guardPolarity(subjectType: Type, cand: CheckCandidate): boolean | undefined {
  switch (cand.kind) {
    case "typeof":
      return typeofPolarity(subjectType, cand);
    case "predicate": {
      if (!Node.isCallExpression(cand.node)) {
        return undefined;
      }
      const target = predicateTargetType(cand.node);
      if (target === undefined) {
        return undefined;
      }
      return subjectType.isAssignableTo(target) ? true : undefined;
    }
    case "nullish":
      return hasNullish(subjectType) ? undefined : true;
    case "nonempty":
      return isNonEmptyType(subjectType) ? true : undefined;
    case "truthiness":
      return subjectType.isBooleanLiteral() ? subjectType.getText() === "true" : undefined;
    case "instanceof":
    case "schema-parse":
      return undefined;
  }
}

function typeofPolarity(subjectType: Type, cand: CheckCandidate): boolean | undefined {
  const lit = typeofLiteralFrom(cand.node);
  if (lit === undefined) {
    return undefined;
  }
  if (typeMatchesTypeof(subjectType, lit)) {
    return true;
  }
  if (typeExcludesTypeof(subjectType, lit)) {
    return false;
  }
  return undefined;
}

function argImpliesGuard(call: CallExpression, paramIndex: number, cand: CheckCandidate): boolean {
  const arg = call.getArguments()[paramIndex];
  if (arg === undefined) {
    return false;
  }
  const argType = arg.getType();
  if (!isUsableType(argType)) {
    return false;
  }
  return guardPolarity(argType, cand) === true;
}

function walkOwn(fn: FunctionLike, visit: (node: Node) => void): void {
  fn.forEachDescendant((node, traversal) => {
    if (node !== fn && isFunctionLike(node)) {
      traversal.skip();
      return;
    }
    visit(node);
  });
}

function sameFileCalls(sourceFile: SourceFile, fn: FunctionLike): CallExpression[] {
  const parent = fn.getParent();
  const target =
    Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)
      ? fn.getSymbol()
      : Node.isVariableDeclaration(parent)
        ? parent.getNameNode()?.getSymbol()
        : fn.getSymbol();
  if (target === undefined) {
    return [];
  }
  const calls: CallExpression[] = [];
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) {
      return;
    }
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr)) {
      return;
    }
    const symbol = expr.getSymbol();
    if (symbol === undefined) {
      return;
    }
    const aliased = symbol.getAliasedSymbol() ?? symbol;
    if (
      symbol !== target &&
      aliased !== target &&
      aliased.getFullyQualifiedName() !== target.getFullyQualifiedName()
    ) {
      return;
    }
    if (node.getStart() >= fn.getStart() && node.getEnd() <= fn.getEnd()) {
      return;
    }
    calls.push(node);
  });
  return calls;
}

function wrappingGuard(
  call: Node,
  caller: FunctionLike,
  name: string,
  expected: CheckCandidate,
): Node | undefined {
  let current: Node | undefined = call.getParent();
  while (current !== undefined && current !== caller) {
    if (Node.isIfStatement(current)) {
      const cond = current.getExpression();
      const cand = classifyCondition(caller, cond);
      if (cand !== undefined && cand.subject === name && cand.kind === expected.kind) {
        return cond;
      }
    }
    current = current.getParent();
  }
  return undefined;
}

function bindingUsedElsewhere(fn: FunctionLike, name: string, ignored: Node[]): boolean {
  let used = false;
  fn.forEachDescendant((node) => {
    if (!Node.isIdentifier(node) || node.getText() !== name || declaresName(node)) {
      return;
    }
    if (ignored.some((item) => containsNode(item, node))) {
      return;
    }
    used = true;
  });
  return used;
}

function containsNode(outer: Node, inner: Node): boolean {
  return inner.getStart() >= outer.getStart() && inner.getEnd() <= outer.getEnd();
}

export function enclosingFunction(node: Node): FunctionLike | undefined {
  let current: Node | undefined = node.getParent();
  while (current !== undefined) {
    if (isFunctionLike(current)) {
      return current;
    }
    current = current.getParent();
  }
  return undefined;
}

function sameGuardShape(left: CheckCandidate, right: CheckCandidate): boolean {
  if (left.kind !== right.kind || left.subject !== right.subject) {
    return false;
  }
  if (left.kind === "predicate") {
    return calleeName(left.node) === calleeName(right.node);
  }
  if (left.kind === "typeof") {
    return typeofLiteralFrom(left.node) === typeofLiteralFrom(right.node);
  }
  return true;
}

function calleeName(node: Node): string | undefined {
  if (!Node.isCallExpression(node)) {
    return undefined;
  }
  const expr = node.getExpression();
  if (Node.isIdentifier(expr)) {
    return expr.getText();
  }
  if (Node.isPropertyAccessExpression(expr)) {
    return expr.getName();
  }
  return undefined;
}

function hasTypePredicate(call: CallExpression): boolean {
  const checker = call.getProject().getTypeChecker();
  const signature = checker.getResolvedSignature(call);
  if (signature === undefined) {
    return false;
  }
  const typeNode = returnTypeNode(signature.getDeclaration());
  return typeNode !== undefined && Node.isTypePredicate(typeNode);
}

function predicateTargetType(call: CallExpression): Type | undefined {
  const checker = call.getProject().getTypeChecker();
  const signature = checker.getResolvedSignature(call);
  if (signature === undefined) {
    return undefined;
  }
  const typeNode = returnTypeNode(signature.getDeclaration());
  if (typeNode === undefined || !Node.isTypePredicate(typeNode)) {
    return undefined;
  }
  return typeNode.getTypeNode()?.getType();
}

function returnTypeNode(decl: Node): TypeNode | undefined {
  if (
    Node.isFunctionDeclaration(decl) ||
    Node.isFunctionExpression(decl) ||
    Node.isArrowFunction(decl) ||
    Node.isMethodDeclaration(decl)
  ) {
    return decl.getReturnTypeNode();
  }
  return undefined;
}

function typeofOperand(node: Node): string | undefined {
  if (!Node.isTypeOfExpression(node)) {
    return undefined;
  }
  const expr = unwrapParens(node.getExpression());
  return Node.isIdentifier(expr) ? expr.getText() : undefined;
}

function stringLit(node: Node): string | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

function isNullishLiteral(node: Node): boolean {
  return Node.isNullLiteral(node) || (Node.isIdentifier(node) && node.getText() === "undefined");
}

function objectVsNullish(left: Node, right: Node): string | undefined {
  const access = Node.isPropertyAccessExpression(left)
    ? left
    : Node.isPropertyAccessExpression(right)
      ? right
      : undefined;
  if (access === undefined) {
    return undefined;
  }
  const object = unwrapParens(access.getExpression());
  return Node.isIdentifier(object) ? object.getText() : undefined;
}

function nonEmptySubject(node: Node): string | undefined {
  if (!Node.isBinaryExpression(node)) {
    return undefined;
  }
  const op = node.getOperatorToken().getText();
  const left = unwrapParens(node.getLeft());
  const right = unwrapParens(node.getRight());
  if (!Node.isNumericLiteral(right) || !Node.isPropertyAccessExpression(left)) {
    return undefined;
  }
  if (left.getName() !== "length") {
    return undefined;
  }
  const object = unwrapParens(left.getExpression());
  if (!Node.isIdentifier(object)) {
    return undefined;
  }
  if (!looksLikeArrayBinding(object)) {
    return undefined;
  }
  const num = Number(right.getLiteralText());
  const isNonZero =
    (op === "===" || op === "==" || op === "!==" || op === "!=") && num === 0 && op.startsWith("!");
  if ((op === ">" && num === 0) || (op === ">=" && num === 1) || isNonZero) {
    return object.getText();
  }
  return undefined;
}

function typeofLiteralFrom(node: Node): string | undefined {
  if (!Node.isBinaryExpression(node)) {
    return undefined;
  }
  return stringLit(unwrapParens(node.getLeft())) ?? stringLit(unwrapParens(node.getRight()));
}

function typeMatchesTypeof(type: Type, lit: string): boolean {
  if (type.isUnion()) {
    return type.getUnionTypes().every((part) => typeMatchesTypeof(part, lit));
  }
  if (lit === "string") {
    return type.isString();
  }
  if (lit === "number") {
    return type.isNumber();
  }
  if (lit === "boolean") {
    return type.isBoolean() || type.isBooleanLiteral();
  }
  if (lit === "undefined") {
    return type.isUndefined();
  }
  if (lit === "object") {
    return type.isNull() || type.isObject() || type.isClassOrInterface();
  }
  return false;
}

function typeExcludesTypeof(type: Type, lit: string): boolean {
  if (type.isUnion()) {
    return false;
  }
  if (lit === "string") {
    return (
      type.isNumber() ||
      type.isBoolean() ||
      type.isBooleanLiteral() ||
      type.isUndefined() ||
      type.isNull()
    );
  }
  if (lit === "number") {
    return (
      type.isString() ||
      type.isBoolean() ||
      type.isBooleanLiteral() ||
      type.isUndefined() ||
      type.isNull()
    );
  }
  if (lit === "boolean") {
    return type.isString() || type.isNumber() || type.isUndefined() || type.isNull();
  }
  return false;
}

function hasNullish(type: Type): boolean {
  const parts = type.isUnion() ? type.getUnionTypes() : [type];
  return parts.some((part) => part.isNull() || part.isUndefined());
}

function isNonEmptyType(type: Type): boolean {
  return type.isTuple() && type.getTupleElements().length > 0;
}

function looksLikeArrayBinding(ident: Node): boolean {
  if (!Node.isIdentifier(ident)) {
    return false;
  }
  const type = ident.getType();
  if (type.isArray() || type.isTuple()) {
    return true;
  }
  if (type.isString() || type.isNumber() || type.isBoolean()) {
    return false;
  }
  const symbol = ident.getSymbol();
  const decl = symbol?.getDeclarations()[0];
  if (decl === undefined) {
    return false;
  }
  if (Node.isParameterDeclaration(decl) || Node.isVariableDeclaration(decl)) {
    const text = decl.getTypeNode()?.getText() ?? "";
    return text.includes("[]") || text.includes("Array<");
  }
  return false;
}

function declaresName(node: Node): boolean {
  const parent = node.getParent();
  if (parent === undefined) {
    return false;
  }
  if (Node.isParameterDeclaration(parent) || Node.isVariableDeclaration(parent)) {
    const nameNode = parent.getNameNode();
    return nameNode !== undefined && nameNode.getStart() === node.getStart();
  }
  return false;
}

export type { FunctionLike };
export { isFunctionLike };
