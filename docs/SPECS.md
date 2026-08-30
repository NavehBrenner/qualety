# Specifications — qualety

This document defines the intended architecture, interfaces, and first set of rules so that a coding agent (or human) can implement the system without ambiguity.

## Locked decisions (August 2026)

These decisions are considered stable unless a major new constraint appears:

1. **Consumption model**  
   CLI-first (ESLint/Ruff-like). Selective execution is required:
    ```bash
    qualety check
    qualety check --plugin react
    qualety check --rule react/data-region-exhaustive
    qualety check --exclude-plugin dry
    qualety check --diff --plugin react
    qualety check --diff-worktree
    ```
    `--diff` is merge-base…HEAD plus dependency closure (TS graph + known doc/code companions); `--diff-worktree` is the dirty tree vs HEAD plus the same closure. Recommended CI uses `--diff`. This monorepo dual-runs full `qualety check` and `qualety check --diff` in CI while proving incremental; consumer guidance can still recommend `--diff` only.
    Exit codes 0/1/2. JSON/SARIF output. Optional MCP server as a thin wrapper around the same engine. Official GitHub Action + pre-commit examples.

2. **Configuration**  
   Primary path is a typed `defineConfig` function (TypeScript) that provides IntelliSense, autocomplete, and runtime validation of unknown keys / mismatched rule ids. On-disk load is JSON + TS/JS (`qualety.config.ts` / `.mts` / `.js` / `.mjs` / `.json`).     Every rule is independently toggleable. **Loading** a plugin via `config.plugins` applies that plugin’s `configs.recommended` (if present) into the effective rule map (`plugins[]` order; later plugin wins on the same id). User `config.rules` overlays last (`"off"` still disables). Core still ships no built-in rule table.    Installing or listing a package without putting it on `plugins[]` enables nothing. Plugin `biome` sections **do** feed the generated Biome config (baseline → `plugins[]` order → user `config.biome.rules`; `biome: false` off). Plugin `ruff` sections **do** feed the generated Ruff config (empty core baseline → `plugins[]` order → user `config.ruff.rules`; `ruff: false` off). They are not product rules.

3. **Core language & multi-language strategy**  
   Core engine, CLI, MCP, and config system are written in **TypeScript**. Default artifact providers (e.g. `"typescript"`) may parse with language-specific libraries **inside** `build` (ts-morph for TypeScript). Rules consume native AST types via `getArtifact` plus their own imports. **The core never imports language-specific AST types** (`SourceFile` is not on `ArtifactMap`; `ParsedProject.sources` stays `unknown`). There is no public `LanguageFrontend` / `hasFrontend` / `createFrontend` product API.

4. **Plugins**  
   First-class and user-writable. There is one explicit contract (see § Plugin contract). Plugins can be published as npm packages or loaded from local paths. Agent skills for creating and maintaining plugins are part of the deliverable.  
   **v1 plugin language is TypeScript only.** Plugins are TypeScript/JavaScript packages that export the `Plugin` interface. Python-written plugins may be supported later via the same protocol once a Python frontend exists.  
    **Core has no built-in rule bag.** Every check is a plugin rule. Core is the engine, default artifact providers, config/CLI, and a generic artifact seam — not a default catalog and **not** a dupehound (or other niche binary) host.     Baseline TypeScript rules live in `@qualety/typescript` (`Plugin.name: "ts"`). React compositional rules live in `@qualety/react` (`Plugin.name: "react"`). Structural DRY lives in `@qualety/dry` (`Plugin.name: "dry"`), which **provides** the `dupehound` artifact. Python baseline lives in `@qualety/python` (`Plugin.name: "python"`), which **provides** the `python` artifact (not a default). `@qualety/plugin-kit` (`Plugin.name: "plugin-kit"`) is the portable plugin-authoring ruleset — not core, not `@qualety/dev`, not a product app catalog. `@qualety/dev` (`Plugin.name: "dev"`) is this monorepo’s dogfood plugin, not a product catalog. Shared/provider-only packages load as **ruleless plugins** (`name` + `provides`, no `rules`) via `plugins[]`.     A plugin may ship `configs.recommended`; loading it via `plugins[]` applies that preset (locked #2). Installing a plugin without listing it on `plugins[]` enables nothing. This repo’s root config lists product plugins and keeps explicit `dev/*` rules (no consumer recommended on `@qualety/dev`); framework plugins only when the tree needs them.

5. **Runtime helpers**  
   Optional companion packages (e.g. a future official `DataRegion`). Static rules work both with the official helpers and with equivalent structural patterns the user already has. **Helpers are optional; this WP ships none.** TanStack Query detectors live under `@qualety/react`, not a separate package.

6. **Scope of v1**  
   High-quality TypeScript/React engine first. Python baseline starts with `@qualety/python` (`python/no-unnecessary-def`); other languages later, reusing the same core protocol.

7. **Relationship to classic linters/formatters**  
    `qualety` is the *higher-order* layer. For JS/TS it **may generate/merge a Biome config and invoke Biome** as part of `qualety check` (single-install gate). For Python it **may generate/merge a Ruff config and invoke Ruff** the same way. Biome and Ruff still own their engines and diagnostics. We **do not** reimplement their rules, wrap them as `biome/…` or `ruff/…` product rules, or own those engines. Formatters stay opt-in (`biome.format: true` / `ruff.format: true`; no default format-on-write, no `qualety fmt`). User `biome.json` / `ruff.toml` / `pyproject.toml` `tool.ruff` are **not** auto-merged; user wins via `config.biome` / `config.ruff` or `biome: false` / `ruff: false`. Pin `@biomejs/biome` in the `qualety` package and `@astral-sh/ruff-wasm-nodejs` in `@qualety/python`; bump deliberately. ESLint, Prettier, and Oxlint stay user-owned. **Compiler defaults** are an exported `compilerOptions` fragment (`@qualety/typescript/tsconfig/recommended.json`); wire with `"extends"`. Typecheck stays the owner’s `tsc` / CI. `qualety check` does not run `tsc --noEmit`. Product `ts/*` still need `plugins[]`.

    This monorepo’s committed `biome.json` remains the `pnpm check` / formatter file. Recommended Biome **deltas** live on `@qualety/typescript` `biome.rules` (not `ts/*` catalog rows): `nursery/noUnsafeTypeAssertion` at error, and `complexity/noExcessiveCognitiveComplexity` at error with `maxAllowedComplexity: 15`. Complexity is **not** a core `BASELINE_RULES` entry and not a product rule. Committed `biome.json` may still duplicate that complexity override for `pnpm check`.

    **Twin parity:** `ts/no-unsafe-assertion` is not equivalent to Biome `nursery/noUnsafeTypeAssertion` (`as any` / `as unknown as T` vs any `as T`). `ts/no-empty-catch` is not equivalent to Biome empty-block rules (catch-only vs all empty blocks). Both stay product rules.

      **TypeScript baseline — what we own:** `ts/public-exports-tested` (static R5-lite), `ts/zod-boundary` (Z1 load/parse + Z2 `JSON.parse`), `ts/type-narrowing-checks`, `ts/no-constant-condition`, `ts/no-unnecessary-abstraction`, `ts/no-unsafe-assertion` (`as any` + `as unknown as T`; angle-bracket `<any>x` deferred), `ts/no-empty-catch`, `ts/no-floating-promises`, `ts/no-misused-promises`, `ts/exhaustive-switch`, `ts/explicit-public-return-types`, `ts/no-non-null-assertion` (`expr!`), `ts/no-export-star`, `ts/no-public-any` (`any` / `any[]`; public `Function` / `Object` deferred).

    **React plugin — what we own:** `react/no-fetch-in-useeffect` and `react/query-error-handled` (R1-lite). TanStack stays inside `@qualety/react` (detectors only). **R3 semantic tokens → future `@qualety/tailwind` (or DS), not react.**

    **DRY plugin — what we own:** `dry/no-duplicate-code` (structural R4: dupehound whole-function path plus ts-morph fragment windows), `dry/no-duplicate-python` (Arm F whole-function twin), and `dry/no-semantic-duplicate` (Type-4 near-dupes via check-time `code-embeddings`, not `qualety index`). We wrap the dupehound CLI for whole-function fingerprints and plugin config; we do not re-own its winnowing / Jaccard. Fragment clones are exact structural hashes on statement windows (TypeScript only). Architecture fitness only if we add something ArchUnit / dependency-cruiser do not already cover.

     **Python plugin — what we own:** `python/no-unnecessary-def` (package-local ≤1-use pass-through / small-flat defs), `python/no-unnecessary-class` (package-local ≤1-use thin / pass-through classes), `python/public-exports-tested` (static test-presence for package `__all__` / `__init__` re-exports), `python/no-mutable-default` (mutable default args), `python/require-typed-public` (annotation presence on public callables), `python/no-bare-except` (bare `except:` / `BaseException`), `python/no-silent-except` (no-op except bodies), `python/no-open-without-with` (unmanaged `open(...)`), `python/no-sys-path-hack` (`sys.path` mutations), `python/no-public-any` (bare `Any` on public callables). Product `python/*` twins **keep**; they are not equivalent to overlapping Ruff codes. Ruff recommended/default select is composed (not a catalog dump); `@qualety/python` `ruff.rules` enables **`UP`** only.

   **What we do not own** (use Biome, ESLint, or dependency-cruiser): circular imports; max relative import depth; simple path bans (`dist/`, `generated/`, …); deep-import / internal-module bans; generic layer charts those tools already do well.

   **Overlap family:** `import-boundary` / layers / no-import-from / no-deep-import / max-relative-depth are one policy family. The v1 TypeScript plugin catalogs **none** of them unless a future WP proves a unique agent-facing gap. Prefer configuring Biome + dependency-cruiser over reimplementation.

8. **One provider map / one engine loop**  
    No unified cross-language AST. Same product idea on two languages ⇒ **two rules** (convention, not `meta.kind`), each `requires` that artifact id. There is a single `Rule` / `RuleContext`. Optional `meta.requires: string[]` names artifacts. In-repo / TypeScript plugin authors use `defineRule` (identity) so `getArtifact(id)` is typed from `ArtifactMap` (no `as ParsedProject` / `as DupehoundIndex`). `defineRule` types accepted `getArtifact` ids from that rule’s `requires` tuple (omitted ⇒ uncallable). Runtime engine `getArtifact` stays untyped at the `Map<string, unknown>` boundary. Load path is Zod (`pluginSchema` / `ruleSchema` / `artifactProviderSchema`), not hand guards.

   **Who provides:** one map. Start empty → register every `provides` entry from loaded **plugin modules** (collision → exit 2, names **both owners**) → for each id in the **default registry** still missing, fill with `owner: "default"`. Defaults only fill gaps; they never replace a plugin-provided id. A plugin `provides.typescript` **wins** (default skipped for that id). v1 default registry is `as const` with `"typescript"` → today’s `ParsedProject`. Default providers are compiled-in trusted factories (`DEFAULT_PROVIDERS` / `createTypeScriptProvider`), gap-filled after plugin `provides`, and are **not** loaded through `pluginSchema`.     `dupehound` stays in `@qualety/dry`. `python` stays in `@qualety/python` (not a default). Multi-team shared providers load as **ruleless plugins** via `plugins[]`. There is **no** `config.languages` and **no** reserved-id category.

    **Engine:** collect all providers into one map → union `requires` from enabled rules → **build each id once** (`await provider.build(context)`) → `create` every rule once with the same context. Required `python` then `typescript` build before any other id; `"code-embeddings"` last among required ids; `ArtifactBuildContext.getArtifact` returns already-built artifacts only (missing → `undefined`). One include/exclude file pass; extension filtering lives **inside** each language provider’s `build` (typescript: `.ts`/`.tsx`/`.mts`/`.cts`; python plugin: `.py`, not `.pyi`). Default include lists `**/*.py`. Empty sources after filter is success, not an error.

   **Fail closed (exit 2, name rule ids):** malformed plugin / rule / provider at load; invalid `requires`; missing provider (provider-neutral copy, not “No plugin provides…”); duplicate provider id; build throw; `getArtifact` for an id not in that rule’s `requires`. Do not silently skip.

    Not a vector store. `qualety index` CLI stays unimplemented. Dupehound (structural fingerprints / winnowing, **not** embeddings) is provided by `@qualety/dry` as artifact id `"dupehound"`. Check-time `"code-embeddings"` (also dry-provided) backs `dry/no-semantic-duplicate`; it is not a product index.

   This avoids both the precision loss of a lowest-common-denominator IR and the cost of re-parsing for every rule.

9. **Performance approach**  
   TypeScript core is the deliberate starting point for velocity and for a TypeScript-native plugin ecosystem. Performance is treated as a hard constraint:
   - Default CI mode should be incremental (`--diff` / changed files only).
    - Cache the default TypeScript provider’s project/AST state across runs where possible.
   - Avoid naïve full-project type-aware analysis on every invocation.
   - Measure real wall-clock time on representative monorepos early.
   - Only if measured numbers are unacceptable: extract hot paths (parsing, simple structural walks) into a native (Rust/oxc) addon while keeping the rule-authoring surface in TypeScript.  
   A full rewrite of the core in Rust (or making Rust the first supported language for self-hosting) is explicitly **out of scope** for v1.

10. **Distribution surfaces**  
    One engine, three install surfaces. Plugins stay runtime JS modules (locked #4). A static binary cannot load arbitrary user plugins without embedding a JS runtime or an RPC plugin protocol. This train **accepts that**.

    | Surface | Role | Custom JS plugins |
    |---|---|---|
    | **npm** | Primary for the TypeScript ecosystem and **dynamic** user plugins (`import` of package names / local paths, as today) | **yes** |
    | **Standalone binary** | **Batteries-included:** TypeScript engine + **official plugins** compiled/bundled in. Compile of the existing engine (locked #3 / #9) — **not** a second implementation | **no** |
    | **pip** | Thin wrapper around **that same binary** — not a Python engine, not a second rule runtime | **no** (same as binary) |

    **Official plugins** (binary bundle) are product app catalogs, not authoring or dogfood:

    | Package | npm | Binary / pip |
    |---|---|---|
    | `qualety` (engine) | yes | the binary *is* the engine |
    | `@qualety/typescript` | yes | bundled |
    | `@qualety/react` | yes | bundled |
    | `@qualety/dry` | yes | bundled |
     | `@qualety/python` | yes | bundled |
    | `@qualety/plugin-kit` | yes (plugin authors) | **not** bundled |
    | `@qualety/dev` | no (`private`) | **not** bundled |
    | Future product plugin | yes when it ships | bundled when it ships |

    Bundling is not a core rule bag. Locked **#4** stands: core has no built-in rules; the binary statically includes the **same plugin modules**. Locked **#2** stands: bundling does not auto-enable; **loading** via `plugins[]` applies `configs.recommended`.

    **Config contract unchanged:** `plugins[]` + per-rule toggles. Binary/pip resolve **known official specs** from the bundle. Unknown / path / third-party specs **fail closed (exit 2)** with copy that says custom plugins need npm. Do not auto-register a silent extra catalog.

     **Compile:** `bun build --compile` (CI). Local dev stays pnpm/Node. Binary/pip config path is `qualety.config.json`; `defineConfig` / TS/JS config remain npm.

     **Surfaces ship on tag `v*`** (GitHub Release binaries + npm provenance + PyPI trusted publish). Merging to main does not publish.

     **This train does not:** embed a JS runtime; add a WASM/RPC plugin protocol; author plugins in Python; vendor dupehound or CPython (PATH / `QUALETY_DUPEHOUND`; `python3` on PATH for Python rules). Custom plugins stay Node/npm.

---

## 1. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI / MCP Server                     │
│  qualety check | query | index | report             │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                     Rule Engine (core)                      │
│  - loads plugins                                            │
│  - one provider map (plugin provides, then default gaps)    │
│  - unions requires; builds each artifact once               │
│  - one create() loop; collects violations                   │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
                │   Artifact providers        │
                │   default: "typescript" →   │
                │     ParsedProject           │
                │   dry: "dupehound",         │
                │        "code-embeddings"    │
                │   python: "python"          │
               └─────────────────────────────┘
```

### Core concepts

- **Rule**: A named, configurable check that produces zero or more `Violation`s.
- **Violation**: `{ ruleId, severity, file, range, message, suggestion }`  
  `suggestion` is **required**. When a rule has nothing to suggest, pass the sentinel exported from core:

  `NO_SUGGESTION = "No suggestion available for this rule."`

    Product rules in this repo (`ts/public-exports-tested`, `ts/zod-boundary`, `ts/type-narrowing-checks`, `ts/no-constant-condition`, `ts/no-unnecessary-abstraction`, `ts/no-unsafe-assertion`, `ts/no-empty-catch`, `ts/no-floating-promises`, `ts/no-misused-promises`, `ts/exhaustive-switch`, `ts/explicit-public-return-types`, `ts/no-non-null-assertion`, `ts/no-export-star`, `ts/no-public-any`, `react/no-fetch-in-useeffect`, `react/query-error-handled`, `dry/no-duplicate-code`, `dry/no-duplicate-python`, `dry/no-semantic-duplicate`, `python/no-unnecessary-def`, `python/no-unnecessary-class`, `python/public-exports-tested`, `python/no-mutable-default`, `python/require-typed-public`, `python/no-bare-except`, `python/no-silent-except`, `python/no-open-without-with`, `python/no-sys-path-hack`, `python/no-public-any`, `dev/core-provider-boundaries`, `dev/docs-export-honesty`, `dev/no-fs-in-rules`, `dev/concrete-suggestion`) **must** use concrete suggestions, not the sentinel. CLI prints a `suggestion:` line unless the value is exactly `NO_SUGGESTION`. `report()` fills the sentinel at runtime if the field is missing (JS plugins keep working).
- **Plugin**: A package that exports `name` plus optional `rules` and/or `provides`. Ruleless plugins (`name` + `provides` only) are shared providers. Optional `biome.rules` (`group/name`) and `ruff.rules` (native Ruff codes / prefixes) feed the generated linter configs; they are **not** product rules.
- **Artifact**: Opaque value built once per check when an enabled rule `requires` its id. One provider map: plugin `provides` first, then default registry gap-fill (`"typescript"` → `ParsedProject`; `"dupehound"` and `"code-embeddings"` in `@qualety/dry`; `"python"` in `@qualety/python`). `"code-embeddings"` is a check-time artifact, not `qualety index`.

## 2. Plugin contract (explicit)

Every plugin must export an object matching this shape (TypeScript types will be published):

```ts
export interface Plugin {
  name: string;                 // e.g. "react" or "@my-org/internal"
  version?: string;
  rules?: Record<string, Rule>;
  provides?: Record<string, ArtifactProvider>;
  configs?: {
    recommended?: Partial<UserConfig>;
  };
  biome?: {
    rules?: Record<string, "off" | "warn" | "error" | [severity, options]>;
  };
  ruff?: {
    rules?: Record<string, "off" | "warn" | "error" | [severity, options]>;
  };
}

export interface ArtifactProvider {
  build(context: ArtifactBuildContext): Promise<unknown> | unknown;
}

export interface ArtifactBuildContext {
  cwd: string;
  files: readonly string[];     // display paths, stable order
  exclude: readonly string[];
  requiredBy: readonly string[]; // enabled rule ids that require this artifact
  getArtifact(id: string): unknown; // already-built only; missing → undefined
}

export interface Rule {
  meta: {
    requires?: string[];        // artifact ids
    docs: { description: string; url?: string };
    schema?: JSONSchema;
    fixable?: "code" | "whitespace";
  };
  create(context: RuleContext): void | RuleListener;
}

export interface RuleContext<Requires extends readonly string[] = readonly string[]> {
  id: string;
  options: unknown;             // validated object when `[severity, options]`; undefined if omitted
  report(violation: Omit<Violation, "ruleId">): void;
  getCwd(): string;
  getFiles(): readonly string[]; // one include/exclude pass, display paths
  getArtifact<Id extends Requires[number]>(id: Id): Id extends keyof ArtifactMap ? ArtifactMap[Id] : unknown;
}

/** Opaque to core; default TypeScript provider uses ts-morph Project + SourceFiles. */
export interface ParsedProject {
  readonly project: unknown;
  readonly sources: ReadonlyMap<string, SourceUnit>;
}

/** Plugins augment via interface merging. Engine still uses Map<string, unknown>. */
export interface ArtifactMap {
  typescript: ParsedProject;
}

export function defineRule<const Requires extends readonly string[] = []>(rule: {
  meta: RuleMeta & { requires?: Requires };
  create(context: RuleContext<Requires>): void | RuleListener;
}): typeof rule;
```

Runtime schemas (engine `safeParse` at load; do **not** replace the TypeScript interfaces above): `requiresSchema`, `ruleMetaSchema`, `functionSchema`, `ruleSchema`, `artifactProviderSchema`, `pluginProvidesSchema`, `pluginSchema`. Those schemas (and siblings) re-exported from core `index` are supported surface for authors who want to parse; `userConfigSchema` stays on the config module (already exported). `defineRule` is a typed identity and does **not** parse — JS / fixture plugins skip it, so the engine must validate the advertised catalog anyway (malformed rule → exit 2 even if that rule is `"off"`). `config.rules[id]` is `"error" | "warn" | "off"` or `[severity, options]` (`options` is a JSON object). No bare options object. `"off"` with options → exit 2. Severity-only → `context.options` is `undefined` (not `{}`). When options are present, core compiles `meta.schema` (JSON Schema **subset**) to Zod and `safeParse`s at load/select for every configured non-off entry, including ids later filtered by `--rule` / `--plugin`. Subset: `type: "object"` with `properties`, optional `required`, `additionalProperties` (`false` → strict); `type: "number"` with `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` (draft-6 **number** form). Unlisted object properties are optional. Unsupported type or keyword, unknown keys, type mismatch, or options when the rule has no `meta.schema` → exit 2 naming the rule id. If the user passed no options, do not compile `meta.schema`. Parsed plugin output is not substituted for the original object (`create` / `build` identity stays).

`create` is invoked once per enabled rule, not once per file. Rules never touch the filesystem or the CLI; they only receive their context and call `context.report`. TypeScript consumers: `requires: ["typescript"]` and `getArtifact("typescript")` (typed as `ParsedProject` via `ArtifactMap`; `.project` / `.sources`). Core `ParsedProject.sources` stays `unknown`; plugins kill `as SourceFile` with `instanceof` / type guards (locked #3). A plugin `provides.build` function **may** spawn tools; rules must not. Duplicate artifact id fails closed (both owners named). Defaults only fill gaps — a plugin `provides.typescript` wins. This keeps rules testable and isolatable.

A malformed plugin / rule / provider, invalid `requires`, a missing provider, a duplicate provider id, a build throw, or `getArtifact` for an id not in that rule’s `requires` is an error (exit 2; do not silently skip). Missing-provider copy is provider-neutral (`No provider for artifact "…" (required by …).`). The message names the rule id(s).

A custom plugin is simply an npm package (or local folder) that exports a `Plugin`. The core discovers it from the `plugins` array in the user’s config. Core never ships a default rule table; a rule exists only if a loaded plugin lists it. Loading a plugin via `plugins[]` applies its `configs.recommended` (user `config.rules` last). Installing a package without listing it on `plugins[]` enables nothing. Plugin `biome.rules` keys are `group/name` (exactly one `/`); extra `biome` keys fail closed (exit 2). Plugin `ruff.rules` keys are native Ruff codes or prefixes (`E501`, `UP`); extra `ruff` keys fail closed (exit 2). Check writes `.qualety/biome.json` and runs Biome when a config is present and `biome !== false`, even if every product rule is off. Check writes `.qualety/ruff.toml` and runs Ruff when a config is present and `ruff !== false`, even if every product rule is off. `--plugin` / `--rule` / `--exclude-plugin` skip those phases. Zero JS/TS/JSX/JSON in the file list skips Biome (success). Zero `.py` in the file list skips Ruff (success). Biome or Ruff unrunnable while enabled → exit 2.

**v1 constraint**: plugins are authored in TypeScript/JavaScript only. Custom plugins load only on npm/Node this train (locked #10).

## 3. First-class rules (v1 targets)

### R1 — Query error handling (`react/query-error-handled`)

Implemented in `@qualety/react` as **`react/query-error-handled`**.  
`defineRule` with `requires: ["typescript"]`; read AST from `getArtifact("typescript")` (`ParsedProject`, no cast). Structural only — no mandatory DataRegion / helper.

**Intent:** Every TanStack `useQuery` (and locked twins) usage must not ignore errors.

| Topic | Decision |
|--------|----------|
| Import | Specifier `=== "@tanstack/react-query"` or starts with `@tanstack/react-query/`. |
| In | `useQuery`, `useInfiniteQuery` (same error model). Named aliases and `TQ.useQuery` / default-or-namespace member access. |
| Skip | `useSuspenseQuery`, `useSuspenseInfiniteQuery` — do **not** require `isError` (error often via boundary / throw). |
| Out | `useQueries`, `useMutation`, SWR, Apollo, parent Error Boundary graph proof, pending/loading UI, DataRegion / `matchQuery`. |
| Compliance (any one) | (1) Same **enclosing function body** branches (`if` / ternary / `&&`) on a **fact derived from that call’s result**: tracked `isError` / `error` / `status` via the result binding (`q.isError`, `q.status`, `q.error`), destructure (including renames such as `{ isError: failed }`), or a simple same-function alias / reassign (`const failed = q.isError`, `const s = q.status`). `status` must be compared with `===` / `==` to `"error"` / `'error'`. Free / unrelated identifiers named `isError` / `error` / `status`, or another call’s flags, do **not** count. Mere destructure without a branch is **not** enough. Nested function declarations / non-IIFE callbacks are **not** that body. (2) Options object (v5 first arg or v4 second) has `throwOnError: true` or a function (not literally `false`). (3) No other escapes. |
| Unfollowed | `throwOnError` as an identifier / shorthand we cannot see statically → **not** compliance. |
| Known miss | Interprocedural / helper / prop-drilled / Error Boundary graph — only the enclosing function body is scanned. |
| Config | none. |
| Violation | Range on the hook call; `ruleId` `react/query-error-handled`; message names the hook and says the error is unhandled; concrete suggestion to branch locally **or** set `throwOnError: true` and render an Error Boundary. |

**Recommended:** `configs.recommended.rules["react/query-error-handled"] = "error"`. Loading the plugin via `plugins[]` applies recommended (locked #2).

### `react/no-fetch-in-useeffect`

Implemented in `@qualety/react`.  
`defineRule` with `requires: ["typescript"]`; read AST from `getArtifact("typescript")` (`ParsedProject`, no cast). Aligns with React’s [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).

**Intent:** Do not kick off HTTP data loading inside `useEffect` / `useLayoutEffect`. Prefer data libraries, route loaders, or RSC.

| Topic | Decision |
|--------|----------|
| Effect callees | `useEffect`, `useLayoutEffect` whose binding resolves to `react` (named, `import React`, `import * as React`; specifier `=== "react"` or starts with `react/`). Unresolved / local same-name functions: **not** flagged. |
| Callback shape | First arg is inline `function` / arrow. Identifier callbacks: **known miss**, not followed in v1. |
| Nested policy | Scan the callback body, blocks (`if` / `try` / `for`), and **IIFEs**. **Do not** scan nested function declarations / non-IIFE arrows (event handlers / helpers). |
| Forbidden | `fetch(...)` (global or imported; a module-level local `function`/`const` named `fetch` is not the global). Callees bound to default/named/namespace import from specifier `axios` / `ky` / `got` (exact, or those names as path prefix `axios/…`). Cheap methods: `.get` / `.post` / `.put` / `.patch` / `.delete` on those same bindings (`axios.get`, `client.post`). |
| Not forbidden | DOM, subscriptions, analytics, `setTimeout`, non-listed HTTP libs. |
| Config | none. Future allowlist is a SPECS note only — not shipped. |
| Violation | Range on the **forbidden call**; `ruleId` `react/no-fetch-in-useeffect`; message names the API (`fetch` / `axios.get` / …); concrete suggestion to load with TanStack Query / SWR / a route loader / RSC. |

**Recommended:** `configs.recommended.rules["react/no-fetch-in-useeffect"] = "error"`.

### R2 — Exhaustive data states via compositional components (DataRegion pattern)

**Deferred.** No mandatory DataRegion / `matchQuery` helper in this WP. Backlog (`react/query-pending-handled`, optional later DataRegion path) lives in [docs/rulesets/react.md](./rulesets/react.md) — research inventory, not implement-now.

### R3 — Semantic style tokens only

**Not the React plugin.** Future `@qualety/tailwind` (or DS). Do not add token/class allowlists to `@qualety/react`.

### R4 — Structural DRY (`dry/no-duplicate-code`)

Implemented in `@qualety/dry` as **`dry/no-duplicate-code`** (renamed from `dry/no-duplicate-functions`; no dual-id window).  
`defineRule` with `requires: ["dupehound", "typescript"]`; `getArtifact` is typed via `ArtifactMap` (no cast). Uses `getCwd`, `getFiles`, `getArtifact`, `report`. Dry still `provides.dupehound` only; default `"typescript"` fills the gap. The **rule** does not spawn CLIs. We do not re-own dupehound winnowing / Jaccard / pin.

**Intent:** No duplicate logical code — whole function-likes **and** repeated intra-body fragments — in included non-test sources.

| Topic | Decision |
|--------|----------|
| Engine | **Hybrid, one `ruleId`.** **Arm F** = dupehound whole-function path (`provides.dupehound`, pin **v0.1.2**, `min_tokens`, `--exclude-tests`). **Arm W** = ts-morph consecutive-statement windows. Merged reporting under `dry/no-duplicate-code`. |
| Out | Semantic near-dupes (`dry/no-semantic-duplicate`, not Arm F/W), Slopo as a product, `query --similar`, auto-merge / codemods, type/interface/type-alias clone detection, near-miss fragment reorder, options / `meta.schema`, a second structural rule id. Incremental `dupehound check --diff` is later (`--diff` / WP-015). |
| Arm W unit | Consecutive statements in the same block (function body or nested `if`/`else`/`try`/`catch`/`for`/`while`/`switch` clause). Do not flatten nested function-likes. Module-level type/interface/alias clones are never windows. |
| Arm W eligible | ≥ 3 non-blank lines of the span’s text (`split(/\n/)`, trim, drop empty). A single multi-line statement can qualify. |
| Arm W hash | Exact structural: emit `SyntaxKind`; **hole** local binding identifiers; **keep** property names and literals; stop at nested function-likes. Type-2 on bindings only. No Jaccard / near-miss. |
| Skip | `.d.ts`, `*.test.*` / `*.spec.*`, path segment `__tests__` or `fixtures`; honor exclude via `sources`. Do not add test globs to the global default exclude. Arm F also keeps dupehound `--exclude-tests` + generated defaults. |
| Report gate | Detect at eligible sizes. **Report** a cluster only if `joint_loc >= 20` **OR** `repetitions >= 4`. `repetitions` = member count. `joint_loc` = `window_non_blank_lines * repetitions`. Arm F uses `endLine − startLine + 1` (min member span). Examples: 3×3 quiet; 3×4 report; 13×2 report. Do not change dupehound `min_tokens` as a substitute. |
| Clustering | ≥ 2 members. Gate first, then longest window wins among *reported* spans. Overlap both arms → one violation (longer line span, then Arm F, then `(file, startLine)`). Representative = first by `(file, startLine)`. Report non-reps only. |
| Violation | `Omit<Violation, "ruleId">` (engine stamps severity). Message names hosts / locations / that it is duplicate logical code. Arm F: reuse the representative. Arm W: extract or reuse it. Never `NO_SUGGESTION`. Arm W uses real ts-morph columns; Arm F keeps best-effort lines, column 1. |
| Severity | `"error"` in recommended; config may set `"warn"`. No extra soft-gate product mode. |
| Capability | `requires: ["dupehound", "typescript"]`. Fail closed (exit 2, clear message naming the rule) if a provider is missing, dupehound is missing / unrunnable, times out, or returns invalid JSON. Empty clusters after skips is success, not an error. |
| Install | Binary on `PATH` or `QUALETY_DUPEHOUND`. Pin **v0.1.2**. No network in default `check`. Optional `scripts/install-dupehound.sh` for local/CI. |
| Peace with abstraction | No code special-case of `ts/no-unnecessary-abstraction`. Multiplicity ≥ 2 is required before DRY can fire; the report gate may require 4 for tiny fragments. |

**Recommended:** `configs.recommended.rules["dry/no-duplicate-code"] = "error"`. Loading the plugin via `plugins[]` applies recommended (locked #2).

**Python twin (`dry/no-duplicate-python`):** same plugin, separate id (locked #8). Arm F only (`requires: ["dupehound"]`, pin **v0.1.2**). Does **not** `requires` `python` and does **not** copy Arm W. Keep `.py` members (drop `.pyi`); drop the cluster if fewer than 2 remain. Same Arm F report gate, message, and suggestion. Skip `test_*.py` / `*_test.py` / `*.test.py` / `*.spec.py` and path segments `tests` / `__tests__` / `fixtures` / `__pycache__`. Fail closed (exit 2) naming this rule. Mixed TS+Python clusters are quiet after each rule keeps only its language. Arm F of `dry/no-duplicate-code` keeps only `.ts` / `.tsx` / `.mts` / `.cts` members so Python never reports under the TS id. `configs.recommended.rules["dry/no-duplicate-python"] = "error"`.

See [docs/rulesets/dry.md](./rulesets/dry.md).

### Semantic DRY (`dry/no-semantic-duplicate`)

Implemented in `@qualety/dry` as **`dry/no-semantic-duplicate`**. Complements structural DRY; does not replace it. Overlap is OK. One rule id for TypeScript and Python (exception to locked #8 “two languages ⇒ two rules”: embeddings are language-agnostic after chunk text).

`defineRule` with `requires: ["code-embeddings", "typescript", "python"]`. Dry `provides` `"code-embeddings"` (and still `"dupehound"`). The rule only reads `getArtifact("code-embeddings")`. Enabling it needs `@qualety/python` in `plugins[]` even for TS-only trees (python provider no-ops with no `.py`). Not `qualety index`.

| Topic | Decision |
|--------|----------|
| Chunks | Functions, methods, and classes. Not sliding windows / whole-file-only. TS from `"typescript"`; Python from `"python"`. |
| Min-size | Skip if non-blank lines < 5 or whitespace tokens < 20. |
| Skip | Same family as structural dry (TS: `.d.ts`, `*.test.*` / `*.spec.*`, `__tests__` / `fixtures`; Python: `test_*.py` / `*_test.py` / `*.test.py` / `*.spec.py`, `conftest.py`, `.pyi`, `tests` / `__tests__` / `fixtures` / `__pycache__`). |
| Similarity | Cosine on MiniLM vectors. Default threshold **0.90** (`COSINE_THRESHOLD`). Optional `{ threshold }` (`number`, exclusiveMinimum `0`, maximum `1`) via `["error", { threshold }]`. Omit options → 0.90. Union-find; one violation per cluster ≥ 2. Primary = first by `(path, name)`. |
| Model | Internal `EmbedModule`; v1 module id `minilm-l6-local`, revision `onnx-quantized-1`, 384-d quantized ONNX. No hosted API. `QUALETY_EMBEDDINGS_MODEL` / `QUALETY_EMBEDDINGS_MODULE` overrides. |
| Cache | `$XDG_CACHE_HOME/qualety/code-embeddings/` (default `~/.cache/qualety/code-embeddings/`). Override `QUALETY_EMBEDDINGS_CACHE`. Key `modelId/revision/sha256(normalized)`. |
| Fail closed | Model load failure with ≥1 embeddable chunk → exit 2 naming `dry/no-semantic-duplicate` and `code-embeddings`. Zero chunks → success, do not load the model. Per-chunk embed miss → omit that chunk. |
| Dispose | After a successful or failed embed build, dispose the in-process pipeline when the transformers API exposes it. |
| Recommended | `configs.recommended.rules["dry/no-semantic-duplicate"] = "error"`. |

### R5 — Test presence (static)

Implemented in `@qualety/typescript` as **`ts/public-exports-tested`**.  
`defineRule` with `requires: ["typescript"]`; read AST from `getArtifact("typescript")` (`ParsedProject`, no cast). Coverage tools are out of scope for this check.

**Intent:** Every **public** value export in included non-test sources must be referenced at least once from a **test** path.

| Topic | Decision |
|--------|----------|
| Public export | Value exports in non-test, non-`.d.ts` files already in the TypeScript artifact: `export function` / `class` / `const` / `let` / `var` / `enum`, `export default`, `export { name }`, `export { name } from`. Name for default is `"default"`. |
| Skip | Type-only (`export type`, `export interface`, `export { type X }`). `export *` / `export * as ns`. `export =`. Ambient `.d.ts`. Exports in test paths. |
| Test path (not configurable in v1) | File is in the TypeScript artifact, and basename matches `*.test.*` / `*.spec.*`, or a path segment is `__tests__`. |
| Reference | Test-file import whose specifier **resolves relatively** (`.ts` / `.tsx` / `.mts` / `.cts` + `index`) to the exporting file in `getArtifact("typescript").sources`, and the import binds that export name (named) or is a default import (`default`). `import *` does not satisfy named exports. Bare specifiers / dynamic `import()` do not count in v1. |
   | Barrel + source | If both `impl.ts` (`export const x`) and `barrel.ts` (`export { x } from "./impl"`) are in `getArtifact("typescript").sources`, a test import from the barrel satisfies **only** the barrel export, not impl’s own public export. Each public surface needs its own test reference. |
| Scope | Include/exclude only. No index. **Tests must not be excluded** or every export fails. This rule only sees files in the TypeScript artifact; a default/global `exclude` of `**/*.test.*` / `**/*.spec.*` wipes the reference sources. Production excludes (`**/generated/**`, `**/dist/**`) are fine. Recommended and example configs keep tests in the set. |
| Violation | `ruleId` `ts/public-exports-tested`; location on the export; message names the export and file; suggestion: import it from a test. |
| Recommended | `configs.recommended.rules["ts/public-exports-tested"] = "error"`. Loading the plugin via `plugins[]` applies recommended (locked #2). |

See [docs/rulesets/typescript.md](./rulesets/typescript.md).

### R6 — Architecture fitness (stretch)

(Details of R6 remain as previously specified.)

### v1 TypeScript plugin catalog

`@qualety/typescript` (`name: "ts"`) ships only:

| Rule | Status |
|------|--------|
| `ts/public-exports-tested` | Implemented (this section) |
| `ts/zod-boundary` | Implemented (Z1 load/parse + Z2 `JSON.parse`; see [typescript.md](./rulesets/typescript.md)) |
| `ts/type-narrowing-checks` | Implemented (checker-visible narrowing; see [typescript.md](./rulesets/typescript.md)) |
| `ts/no-constant-condition` | Implemented (constant conditions + same-file call-site facts; see [typescript.md](./rulesets/typescript.md)) |
| `ts/no-unnecessary-abstraction` | Implemented (package-local ≤1-use helpers and types; see [typescript.md](./rulesets/typescript.md)) |
| `ts/no-unsafe-assertion` | Implemented (`as any` + `as unknown as T`; angle-bracket `<any>x` deferred) |
| `ts/no-empty-catch` | Implemented (empty / comment-only catch) |
| `ts/no-floating-promises` | Implemented (expression-statement Promises; underapprox without lib `Promise`) |
| `ts/no-misused-promises` | Implemented (Promise-returning fn in sync void callback / `.forEach`; underapprox) |
| `ts/exhaustive-switch` | Implemented (finite union / enum; never-typed default counts) |
| `ts/explicit-public-return-types` | Implemented (exported fn / public method return annotations) |
| `ts/no-non-null-assertion` | Implemented (`expr!`; not definite-assignment fields) |
| `ts/no-export-star` | Implemented (`export *` and `export * as ns`) |
| `ts/no-public-any` | Implemented (exported `any` / `any[]`; public `Function` / `Object` deferred) |

**Not catalogued** (do not implement in this plugin): circular imports, max relative import depth, simple path bans, deep-import / internal-module bans, generic layer charts. Use Biome / ESLint / dependency-cruiser.

**Overlap family:** `import-boundary` / layers / no-import-from / no-deep-import / max-relative-depth — catalog **none**.

React compositional rules live in `@qualety/react`, not this plugin. See the React catalog below and [docs/rulesets/react.md](./rulesets/react.md).

### v1 React plugin catalog

`@qualety/react` (`name: "react"`) ships only:

| Rule | Status |
|------|--------|
| `react/no-fetch-in-useeffect` | Implemented (this section) |
| `react/query-error-handled` | Implemented (this section; R1-lite) |

Backlog (effects family, query-pending, component API, Next/RSC, tailwind/R3) is documented in [docs/rulesets/react.md](./rulesets/react.md) and is **not** an implementation list for this WP.

Do **not** own classic eslint-plugin-react / react-hooks / jsx-a11y, TanStack eslint mechanical rules, or `@next/no-async-client-component`.

### v1 DRY plugin catalog

`@qualety/dry` (`name: "dry"`) ships only:

| Rule | Status |
|------|--------|
| `dry/no-duplicate-code` | Implemented (this section; structural R4, hybrid + report gate) |
| `dry/no-duplicate-python` | Implemented (R4 twin; Arm F whole-function only) |
| `dry/no-semantic-duplicate` | Implemented (this section; Type-4 near-dupes, TS+Python, `code-embeddings`) |

### v1 Python plugin catalog

`@qualety/python` (`name: "python"`) ships only:

| Rule | Status |
|------|--------|
| `python/no-unnecessary-def` | Implemented (package-local ≤1-use pass-through / small-flat defs; see [python.md](./rulesets/python.md)) |
| `python/no-unnecessary-class` | Implemented (package-local ≤1-use thin / pass-through classes; see [python.md](./rulesets/python.md)) |
| `python/public-exports-tested` | Implemented (static test-presence for package `__all__` / `__init__` re-exports; see [python.md](./rulesets/python.md)) |
| `python/no-mutable-default` | Implemented (mutable default args; see [python.md](./rulesets/python.md)) |
| `python/require-typed-public` | Implemented (annotation presence on public callables; see [python.md](./rulesets/python.md)) |
| `python/no-bare-except` | Implemented (bare `except:` / `BaseException`; not plain `Exception`; see [python.md](./rulesets/python.md)) |
| `python/no-silent-except` | Implemented (except body only pass/ellipsis/continue/string; see [python.md](./rulesets/python.md)) |
| `python/no-open-without-with` | Implemented (unmanaged `open(...)` in the same function; see [python.md](./rulesets/python.md)) |
| `python/no-sys-path-hack` | Implemented (`sys.path` / `sys.path_hooks` import-fix mutations; see [python.md](./rulesets/python.md)) |
| `python/no-public-any` | Implemented (public callables must not annotate with bare `Any`; see [python.md](./rulesets/python.md)) |

Authored in TypeScript. Provides artifact `"python"` (CPython `ast` via `python3` spawn); not a default provider. Not a Ruff clone. DRY / types arm / Python-authored plugins are **not** this WP.

## 4. CLI interface

```bash
qualety init
qualety doctor
qualety check
qualety check --plugin react
qualety check --rule react/data-region-exhaustive
qualety check --exclude-plugin dry
qualety check --diff
qualety check --diff-worktree
qualety index
qualety query --similar "..."
qualety report
```

## 5. Configuration

```ts
import { defineConfig } from "qualety";

export default defineConfig({
  plugins: [
    "@qualety/typescript",
    "@qualety/react",
    // "@qualety/dry",
    "./my-custom-plugin",
  ],
  // recommended applied by load; overlay to disable or retune
  rules: {
    "ts/public-exports-tested": "off",
  },
  include: ["src/**/*.{ts,tsx}"],
  exclude: ["**/generated/**"],
  // biome: false,  // off switch; omit to run the Biome phase
  // ruff: false,   // off switch; omit to run the Ruff phase
});
```

`defineConfig` is a typed identity (same policy as `defineRule`). Runtime validation is load-time Zod only (`validateConfig` / `readConfigFile`).

`config.rules[id]` is `"error" | "warn" | "off"` or `[severity, options]` where `options` is a JSON object. No bare options object. No `"off"` with options. Invalid options fail closed (exit 2, name the rule). Recommended presets stay severity-only unless a rule truly needs options in recommended.

**Do not exclude test paths** (`**/*.test.*`, `**/*.spec.*`, `__tests__/**`) when `ts/public-exports-tested` is enabled. The rule only sees files in the TypeScript artifact; wiping tests from the set makes every public export fail. Keep tests in `include`. Default exclude is `node_modules` and `dist` only.

## 6. MCP server

Thin wrapper exposing at least: `check_file`, `check_diff`, `query_similar`, `list_violations`, `get_rule_docs`.

## 7. Language support matrix (initial)

| Capability                    | TypeScript | Python |
|-------------------------------|------------|--------|
| AST compositional rules       | Primary    | First slice (`python/no-unnecessary-def`) |
| Semantic style / tokens       | Primary    | Later   |
| Semantic DRY (embeddings)     | Yes (`dry/no-semantic-duplicate`) | Yes (`dry/no-semantic-duplicate`) |
| Structural clone detection    | Yes        | Yes     |
| Test-presence                 | Yes        | Yes     |
| Architecture fitness          | Yes        | Yes     |

## 8. Agent skills

Supported skills (not drafts):

- [`skills/create-plugin`](../skills/create-plugin/SKILL.md) — scaffold a contract-valid plugin (rules or ruleless provider). Consumer config wiring (`plugins[]` applies recommended; overlay to disable) is a closing section of this skill, not a third skill.
- [`skills/add-rule`](../skills/add-rule/SKILL.md) — add one tested rule to an existing plugin.

Later: skills for filing issues and opening PRs against this repository.

Portable authoring rules that statically catch the smells these skills teach live in `@qualety/plugin-kit` (not core, not `@qualety/dev`).

## 9. Success metrics for v0.1

- Three compositional rules (R1–R3) working on a real React + TanStack Query codebase
- CLI `check` usable in GitHub Actions (with `--diff` as the recommended CI mode)
- Clear, actionable violation messages
- Published plugin contract + at least one example custom plugin
- Agent skills that allow another model to create a working plugin
- Measured performance on at least one non-trivial monorepo; no naïve full-project re-parse on every run
