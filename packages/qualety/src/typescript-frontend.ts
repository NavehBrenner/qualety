import { dirname, extname, join, resolve } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import type { ArtifactProvider, SourceUnit } from "./index.ts";

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"] as const;
const TS_EXTENSIONS = new Set<string>(TS_EXTS);

export function createTypeScriptProvider(): ArtifactProvider {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });
  return {
    build: (context) => {
      const absolutePaths = context.files
        .map((file) => resolve(context.cwd, file))
        .filter((path) => TS_EXTENSIONS.has(extname(path)));
      const sources = new Map<string, SourceUnit>();
      for (const path of absolutePaths) {
        sources.set(path, project.addSourceFileAtPath(path));
      }
      return { project, sources };
    },
  };
}

export function expandTypeScriptClosure(
  cwd: string,
  workspaceFiles: readonly string[],
  seedFiles: readonly string[],
): string[] {
  const workspace = new Set(workspaceFiles.map((file) => resolve(cwd, file)));
  const seeds = seedFiles.map((file) => resolve(cwd, file)).filter((file) => workspace.has(file));
  const tsFiles = [...workspace].filter((file) => TS_EXTENSIONS.has(extname(file)));
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });
  const sources = new Map<string, SourceFile>();
  for (const path of tsFiles) {
    sources.set(path, project.addSourceFileAtPath(path));
  }
  const neighbors = collectImportEdges(sources);
  return [...walkImportClosure(seeds, neighbors, sources)].sort();
}

function collectImportEdges(sources: Map<string, SourceFile>): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  for (const [from, source] of sources) {
    for (const specifier of specifiersOf(source)) {
      const target = resolveRelative(from, specifier, sources);
      if (target === undefined) {
        continue;
      }
      addUndirected(neighbors, from, target);
      addUndirected(neighbors, target, from);
    }
  }
  return neighbors;
}

function specifiersOf(source: SourceFile): string[] {
  const specs: string[] = [];
  for (const decl of source.getImportDeclarations()) {
    specs.push(decl.getModuleSpecifierValue());
  }
  for (const decl of source.getExportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec !== undefined) {
      specs.push(spec);
    }
  }
  return specs;
}

function resolveRelative(
  fromFile: string,
  specifier: string,
  sources: ReadonlyMap<string, SourceFile>,
): string | undefined {
  let target: string | undefined;
  if (specifier.startsWith(".")) {
    const resolved = resolve(dirname(fromFile), specifier);
    const hits = [resolved];
    for (const ext of TS_EXTS) {
      hits.push(resolved + ext);
      hits.push(join(resolved, `index${ext}`));
    }
    target = hits.find((path) => sources.has(path));
  }
  return target;
}

function walkImportClosure(
  seeds: readonly string[],
  neighbors: Map<string, Set<string>>,
  sources: Map<string, SourceFile>,
): Set<string> {
  const closure = new Set(seeds);
  const queue = seeds.filter((file) => sources.has(file));
  const seen = new Set(queue);
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) {
      break;
    }
    for (const next of neighbors.get(current) ?? []) {
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      queue.push(next);
      closure.add(next);
    }
  }
  return closure;
}

function addUndirected(neighbors: Map<string, Set<string>>, from: string, to: string): void {
  const set = neighbors.get(from) ?? new Set<string>();
  set.add(to);
  neighbors.set(from, set);
}
