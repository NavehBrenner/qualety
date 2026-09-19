import { clusterByPredicate, cosineSimilarity, defineRule } from "qualety";
import type { PythonSource } from "./python.ts";
import {
  displayRel,
  jaccard,
  NAME_COSINE,
  nameIsGated,
  normalizeName,
  type ThresholdNameCard,
  TOKEN_JACCARD,
  tokenSet,
} from "./threshold-names.ts";
import { collectImports } from "./walk.ts";

const SUGGEST =
  "Import the canonical name (or re-export from one module) instead of redeclaring it.";

type RuleOptions = {
  names: readonly string[];
  tokenJaccard: number;
  nameCosine: number;
  arms: { exact: boolean; normalized: boolean; embedNames: boolean };
};

type Arm = "exact" | "normalized" | "embed";

type Hit = {
  extra: ThresholdNameCard;
  canonical: ThresholdNameCard;
  arm: Arm;
};

export const singleSourceThreshold = defineRule({
  meta: {
    requires: ["python", "code-embeddings"],
    docs: {
      description:
        "Do not redeclare an outcome-deciding module-level numeric threshold in another module of the same package; define it once and import it.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        names: { type: "array", items: { type: "string" } },
        tokenJaccard: { type: "number", minimum: 0, maximum: 1 },
        nameCosine: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        arms: {
          type: "object",
          additionalProperties: false,
          properties: {
            exact: { type: "boolean" },
            normalized: { type: "boolean" },
            embedNames: { type: "boolean" },
          },
        },
      },
    },
  },
  create(context) {
    const python = context.getArtifact("python");
    if (!(python.sources instanceof Map) || !Array.isArray(python.nameCards)) {
      return;
    }
    const options = readOptions(context.options);
    const cwd = context.getCwd();
    const vectors = options.arms.embedNames
      ? nameVectors(context.getArtifact("code-embeddings"))
      : new Map<string, Float32Array>();
    const hits = collectHits(python.nameCards, python.sources, options, vectors, cwd);
    for (const hit of dedupeHits(hits)) {
      const where = `${hit.canonical.name} at ${displayRel(cwd, hit.canonical.file)}`;
      const disagree =
        hit.extra.value !== hit.canonical.value ? " Values disagree — confirm split-brain." : "";
      const message =
        hit.arm === "exact"
          ? `"${hit.extra.name}" is a second definition of ${where}. Define it once and import it.${disagree}`
          : `"${hit.extra.name}" redeclares the same threshold as ${where}. Define it once and import it.${disagree}`;
      context.report({
        severity: "error",
        file: hit.extra.file,
        range: hit.extra.range,
        message,
        suggestion: `${SUGGEST} Canonical: ${hit.canonical.name} at ${displayRel(cwd, hit.canonical.file)}.`,
      });
    }
  },
});

function readOptions(raw: unknown): RuleOptions {
  const obj = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const armsRaw = "arms" in obj ? obj.arms : undefined;
  const arms =
    armsRaw !== null && typeof armsRaw === "object" && !Array.isArray(armsRaw) ? armsRaw : {};
  const names =
    "names" in obj && Array.isArray(obj.names)
      ? obj.names.filter((item) => typeof item === "string")
      : [];
  return {
    names,
    tokenJaccard:
      "tokenJaccard" in obj && typeof obj.tokenJaccard === "number"
        ? obj.tokenJaccard
        : TOKEN_JACCARD,
    nameCosine:
      "nameCosine" in obj && typeof obj.nameCosine === "number" ? obj.nameCosine : NAME_COSINE,
    arms: {
      exact: !("exact" in arms) || arms.exact !== false,
      normalized: !("normalized" in arms) || arms.normalized !== false,
      embedNames: !("embedNames" in arms) || arms.embedNames !== false,
    },
  };
}

function collectHits(
  cards: readonly ThresholdNameCard[],
  sources: ReadonlyMap<string, PythonSource>,
  options: RuleOptions,
  vectors: ReadonlyMap<string, Float32Array>,
  cwd: string,
): Hit[] {
  const hits: Hit[] = [];
  for (const group of groupCards(cards).values()) {
    if (options.arms.exact) {
      pushArmHits(hits, exactClusters(group), sources, "exact");
    }
    if (options.arms.normalized) {
      pushArmHits(
        hits,
        clusterByPredicate(group, (left, right) => {
          if (!nameIsGated(left.name, options.names) && !nameIsGated(right.name, options.names)) {
            return false;
          }
          const leftNorm = normalizeName(left.name);
          const rightNorm = normalizeName(right.name);
          return (
            (leftNorm.length > 0 && leftNorm === rightNorm) ||
            jaccard(tokenSet(left.name), tokenSet(right.name)) >= options.tokenJaccard
          );
        }),
        sources,
        "normalized",
      );
    }
    if (options.arms.embedNames) {
      pushArmHits(
        hits,
        clusterByPredicate(group, (left, right) => embedMatch(left, right, options, vectors, cwd)),
        sources,
        "embed",
      );
    }
  }
  return hits;
}

function embedMatch(
  left: ThresholdNameCard,
  right: ThresholdNameCard,
  options: RuleOptions,
  vectors: ReadonlyMap<string, Float32Array>,
  cwd: string,
): boolean {
  if (!nameIsGated(left.name, options.names) && !nameIsGated(right.name, options.names)) {
    return false;
  }
  const leftVec = vectors.get(vectorKey(left, cwd));
  const rightVec = vectors.get(vectorKey(right, cwd));
  if (leftVec === undefined || rightVec === undefined) {
    return false;
  }
  return cosineSimilarity(leftVec, rightVec) >= options.nameCosine;
}

function exactClusters(group: readonly ThresholdNameCard[]): ThresholdNameCard[][] {
  const byName = new Map<string, ThresholdNameCard[]>();
  for (const card of group) {
    const list = byName.get(card.name) ?? [];
    if (list.length === 0) {
      byName.set(card.name, list);
    }
    list.push(card);
  }
  return [...byName.values()].filter((list) => list.length >= 2);
}

function pushArmHits(
  hits: Hit[],
  clusters: readonly ThresholdNameCard[][],
  sources: ReadonlyMap<string, PythonSource>,
  arm: Arm,
) {
  for (const cluster of clusters) {
    const ordered = [...cluster].sort(
      (left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name),
    );
    const canonical = ordered[0];
    if (canonical === undefined) {
      continue;
    }
    const defining = definingFiles(cluster, canonical.name);
    for (const extra of ordered.slice(1)) {
      if (!importSilences(extra, canonical.name, defining, sources)) {
        hits.push({ extra, canonical, arm });
      }
    }
  }
}

function definingFiles(cluster: readonly ThresholdNameCard[], name: string): ReadonlySet<string> {
  const files = new Set<string>();
  for (const card of cluster) {
    if (card.name === name) {
      files.add(card.file);
    }
  }
  return files;
}

function importSilences(
  extra: ThresholdNameCard,
  name: string,
  defining: ReadonlySet<string>,
  sources: ReadonlyMap<string, PythonSource>,
): boolean {
  const unit = sources.get(extra.file);
  if (unit === undefined) {
    return true;
  }
  const binds = collectImports(unit, sources);
  for (const imported of binds.named.values()) {
    if (imported.name === name && defining.has(imported.file)) {
      return true;
    }
  }
  return false;
}

function dedupeHits(hits: readonly Hit[]): Hit[] {
  const best = new Map<string, Hit>();
  for (const hit of hits) {
    const key = `${hit.extra.file}:${hit.extra.name}`;
    const prev = best.get(key);
    if (prev === undefined || armRank(hit.arm) < armRank(prev.arm)) {
      best.set(key, hit);
    }
  }
  return [...best.values()].sort(
    (left, right) =>
      left.extra.file.localeCompare(right.extra.file) ||
      left.extra.name.localeCompare(right.extra.name),
  );
}

function armRank(arm: Arm): number {
  if (arm === "exact") {
    return 0;
  }
  if (arm === "normalized") {
    return 1;
  }
  return 2;
}

function groupCards(cards: readonly ThresholdNameCard[]): Map<string, ThresholdNameCard[]> {
  const grouped = new Map<string, ThresholdNameCard[]>();
  for (const card of cards) {
    const list = grouped.get(card.packageDir) ?? [];
    if (list.length === 0) {
      grouped.set(card.packageDir, list);
    }
    list.push(card);
  }
  return grouped;
}

function nameVectors(artifact: unknown): Map<string, Float32Array> {
  const vectors = new Map<string, Float32Array>();
  if (!isRecord(artifact) || !Array.isArray(artifact.names)) {
    return vectors;
  }
  for (const item of artifact.names) {
    if (!isRecord(item) || typeof item.path !== "string" || typeof item.name !== "string") {
      continue;
    }
    if (!(item.vector instanceof Float32Array)) {
      continue;
    }
    vectors.set(`${item.path}:${item.name}`, item.vector);
  }
  return vectors;
}

function vectorKey(card: ThresholdNameCard, cwd: string): string {
  return `${displayRel(cwd, card.file)}:${card.name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
