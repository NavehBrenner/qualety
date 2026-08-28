import { basename, relative, resolve } from "node:path";
import type { Range } from "qualety";
import { Node, SourceFile } from "ts-morph";

const MIN_NONBLANK_LINES = 5;
const MIN_WHITESPACE_TOKENS = 20;

export type ChunkLang = "ts" | "python";

export type CodeChunk = {
  path: string;
  name: string;
  lang: ChunkLang;
  range: Range;
  text: string;
};

export function normalizeChunkText(text: string): string {
  return text.trim().replace(/\n(?:[ \t]*\n)+/g, "\n\n");
}

export function collectChunks(
  cwd: string,
  typescriptArtifact: unknown,
  pythonArtifact: unknown,
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const tsSources =
    isRecord(typescriptArtifact) && typescriptArtifact.sources instanceof Map
      ? typescriptArtifact.sources
      : undefined;
  if (tsSources !== undefined) {
    for (const abs of tsSources.keys()) {
      const unit = tsSources.get(abs);
      if (unit instanceof SourceFile && !skipTypeScriptPath(abs, cwd)) {
        const path = displayFile(cwd, abs);
        unit.forEachDescendant((node) => {
          const chunk = typeScriptChunk(unit, path, node);
          if (chunk !== undefined) {
            pushIfEligible(chunks, chunk);
          }
        });
      }
    }
  }
  collectPythonChunks(cwd, pythonArtifact, chunks);
  chunks.sort(
    (left, right) => left.path.localeCompare(right.path) || left.name.localeCompare(right.name),
  );
  return chunks;
}

function typeScriptChunk(sourceFile: SourceFile, path: string, node: Node): CodeChunk | undefined {
  if (Node.isClassDeclaration(node)) {
    const name = node.getName();
    const nameNode = node.getNameNode();
    if (name === undefined || nameNode === undefined) {
      return undefined;
    }
    return namedChunk(sourceFile, path, "ts", name, nameNode, node.getText());
  }
  if (Node.isFunctionDeclaration(node)) {
    const name = node.getName();
    const nameNode = node.getNameNode();
    if (name === undefined || nameNode === undefined) {
      return undefined;
    }
    return namedChunk(sourceFile, path, "ts", name, nameNode, node.getText());
  }
  if (Node.isMethodDeclaration(node)) {
    const nameNode = node.getNameNode();
    const name = node.getName();
    if (nameNode === undefined) {
      return undefined;
    }
    return namedChunk(sourceFile, path, "ts", qualify(node, name), nameNode, node.getText());
  }
  if (Node.isConstructorDeclaration(node)) {
    return namedChunk(sourceFile, path, "ts", qualify(node, "constructor"), node, node.getText());
  }
  if (!Node.isFunctionExpression(node) && !Node.isArrowFunction(node)) {
    return undefined;
  }
  const parent = node.getParent();
  if (!Node.isVariableDeclaration(parent)) {
    return undefined;
  }
  return namedChunk(sourceFile, path, "ts", parent.getName(), parent.getNameNode(), node.getText());
}

function namedChunk(
  sourceFile: SourceFile,
  path: string,
  lang: ChunkLang,
  name: string,
  nameNode: Node,
  text: string,
): CodeChunk {
  const start = sourceFile.getLineAndColumnAtPos(nameNode.getStart());
  const end = sourceFile.getLineAndColumnAtPos(nameNode.getEnd());
  return {
    path,
    name,
    lang,
    range: {
      start: { line: start.line, column: start.column },
      end: { line: end.line, column: end.column },
    },
    text: normalizeChunkText(text),
  };
}

function qualify(node: Node, name: string): string {
  const parent = node.getParent();
  if (Node.isClassDeclaration(parent) || Node.isClassExpression(parent)) {
    const className = parent.getName();
    if (className !== undefined) {
      return `${className}.${name}`;
    }
  }
  return name;
}

function collectPythonChunks(cwd: string, artifact: unknown, chunks: CodeChunk[]) {
  if (!isRecord(artifact) || !(artifact.sources instanceof Map)) {
    return;
  }
  for (const [abs, unit] of artifact.sources) {
    if (!isRecord(unit) || typeof unit.text !== "string" || !isRecord(unit.tree)) {
      continue;
    }
    if (skipPythonPath(abs, cwd)) {
      continue;
    }
    walkPythonNode(displayFile(cwd, abs), unit.text, unit.tree, "", chunks);
  }
}

function walkPythonNode(
  path: string,
  source: string,
  node: Record<string, unknown>,
  className: string,
  chunks: CodeChunk[],
) {
  const type = node._type;
  if (type === "FunctionDef" || type === "AsyncFunctionDef") {
    const name = typeof node.name === "string" ? node.name : "";
    const chunkName = className === "" ? name : `${className}.${name}`;
    pushIfEligible(chunks, pythonChunk(path, chunkName, source, node, type === "AsyncFunctionDef"));
    for (const child of pythonChildren(node)) {
      walkPythonNode(path, source, child, "", chunks);
    }
    return;
  }
  if (type === "ClassDef") {
    const name = typeof node.name === "string" ? node.name : "";
    pushIfEligible(chunks, pythonChunk(path, name, source, node, false, true));
    for (const child of pythonChildren(node)) {
      walkPythonNode(path, source, child, name, chunks);
    }
    return;
  }
  for (const child of pythonChildren(node)) {
    walkPythonNode(path, source, child, className, chunks);
  }
}

function pythonChunk(
  path: string,
  name: string,
  source: string,
  node: Record<string, unknown>,
  asyncDef: boolean,
  isClass = false,
): CodeChunk {
  const startLine = typeof node.lineno === "number" ? node.lineno : 1;
  const endLine = typeof node.end_lineno === "number" ? node.end_lineno : startLine;
  const col = (typeof node.col_offset === "number" ? node.col_offset : 0) + 1;
  const prefix = isClass ? "class " : asyncDef ? "async def " : "def ";
  const startCol = col + prefix.length;
  return {
    path,
    name,
    lang: "python",
    range: {
      start: { line: startLine, column: startCol },
      end: { line: startLine, column: startCol + name.length },
    },
    text: normalizeChunkText(
      source
        .split("\n")
        .slice(startLine - 1, endLine)
        .join("\n"),
    ),
  };
}

function pythonChildren(node: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const value of Object.values(node)) {
    if (isRecord(value) && typeof value._type === "string") {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item) && typeof item._type === "string") {
          out.push(item);
        }
      }
    }
  }
  return out;
}

function pushIfEligible(chunks: CodeChunk[], chunk: CodeChunk) {
  const lines = chunk.text.split("\n").filter((line) => line.trim() !== "");
  const tokens = chunk.text.split(/\s+/).filter((token) => token.length > 0);
  if (
    chunk.name.length > 0 &&
    lines.length >= MIN_NONBLANK_LINES &&
    tokens.length >= MIN_WHITESPACE_TOKENS
  ) {
    chunks.push(chunk);
  }
}

export function skipTypeScriptPath(file: string, cwd: string): boolean {
  const relativePath = displayFile(cwd, file);
  const base = basename(relativePath);
  const parts = relativePath.split("/");
  return (
    /\.d\.(?:ts|mts|cts)$/.test(base) ||
    /\.(?:test|spec)\./.test(base) ||
    parts.includes("__tests__") ||
    parts.includes("fixtures")
  );
}

export function skipPythonPath(file: string, cwd: string): boolean {
  const relativePath = displayFile(cwd, file);
  const base = basename(relativePath);
  const parts = relativePath.split("/");
  return (
    base === "conftest.py" ||
    base.endsWith(".pyi") ||
    base.startsWith("test_") ||
    base.endsWith("_test.py") ||
    base.endsWith(".test.py") ||
    base.endsWith(".spec.py") ||
    parts.includes("tests") ||
    parts.includes("__tests__") ||
    parts.includes("fixtures") ||
    parts.includes("__pycache__")
  );
}

export function displayFile(cwd: string, file: string): string {
  const abs = resolve(cwd, file);
  const rel = relative(cwd, abs);
  return (rel === "" ? file : rel).split("\\").join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
