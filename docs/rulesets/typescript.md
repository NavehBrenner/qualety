# TypeScript plugin catalog

Honest catalog for **`@qualety/typescript`** (`Plugin.name: "ts"`).  
This is the implementation list for this plugin. [typescript-baseline.md](./typescript-baseline.md) and [typescript-nice-to-have.md](./typescript-nice-to-have.md) are research inventories, **not** an implementation backlog.

Core has no built-in rule bag. Rules exist only on this plugin’s `rules` map. Installing the plugin does **not** enable them. `configs.recommended` sets `ts/public-exports-tested`, `ts/zod-boundary`, `ts/type-narrowing-checks`, `ts/no-constant-condition`, and `ts/no-unnecessary-abstraction` to `"error"` for users who opt into that preset.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `ts/no-constant-condition` | Do not branch on a condition the analyzer can prove always true or always false (param type, prior narrowing, prior parse, same-file call-site facts, cheap literals). `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-unnecessary-abstraction` | Do not keep a local abstraction that does not pay for its indirection: same-file single-use pass-through / small-flat helpers and single-use type aliases. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/public-exports-tested` | Every public value export in included non-test sources is referenced from a test path (static R5-lite; not coverage). `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/type-narrowing-checks` | A runtime check on a value is legitimate only if the TypeScript checker shows a strict refinement of that subject on the true/success path. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/zod-boundary` | Load/parse functions with an `unknown` param (Z1) and `JSON.parse` results (Z2) must hit schema `.parse` / `.safeParse` before property access. `defineRule` / `requires: ["typescript"]` | `error` |

Behavior is locked in [SPECS.md](../SPECS.md) §3 R5. Summary:

- **Public export:** value exports in non-test, non-`.d.ts` files already in the TypeScript artifact: `export function` / `class` / `const` / `let` / `var` / `enum`, `export default`, `export { name }`, `export { name } from`. Default name is `"default"`.
- **Skip:** type-only (`export type`, `export interface`, `export { type X }`); `export *` / `export * as ns`; `export =`; ambient `.d.ts`; exports in test paths.
- **Test path (not configurable in v1):** file is in the pipeline, and basename matches `*.test.*` / `*.spec.*`, or a path segment is `__tests__`.
- **Reference:** a test-file import whose specifier **resolves relatively** (`.ts` / `.tsx` / `.mts` / `.cts` + `index`) to the exporting file in `getArtifact("typescript").sources`, and the import binds that export name (named) or is a default import (`default`). `import *` does not satisfy named exports. Bare specifiers and dynamic `import()` do not count.
- **Barrel + source:** if both `impl.ts` (`export const x`) and `barrel.ts` (`export { x } from "./impl"`) are in `getArtifact("typescript").sources`, a test import from the barrel satisfies **only** the barrel export, not impl’s own public export. Each public surface needs its own test reference.
- **Scope:** include/exclude only. No index.
- **Do not exclude test paths** when this rule is enabled. The rule only sees files in the TypeScript artifact; a default/global `exclude` of `**/*.test.*` / `**/*.spec.*` makes every public export fail. Production excludes (`**/generated/**`, `**/dist/**`) are fine. Recommended and example configs **must keep tests in the set**.
- **Violation:** `ruleId` `ts/public-exports-tested`; location on the export; message names the export and file; suggestion to import it from a test.

### `ts/zod-boundary`

High-signal only. Same function body; not a philosophy linter.

- **Z1:** function / const-arrow / method named `/^(read|load|parse)/i` or in-repo names `validateConfig`, `readConfigFile`, `loadConfig`, `loadPlugin`, with a param typed `unknown`. Body must call `.safeParse` / `.parse` on that binding (or an alias) before property / element access.
- **Z2:** `JSON.parse(…)` result (the call or its binding) must flow into `.safeParse` / `.parse` before property access. Valid: `schema.safeParse(JSON.parse(t))`. Invalid: `JSON.parse(t).foo` or `const x = JSON.parse(t); x.foo`.
- **Known miss:** helper one hop away; renamed bindings beyond a simple alias; `Date.parse` / other non-schema `.parse` names except `JSON.parse` (excluded from schema-parse detection).

### `ts/type-narrowing-checks`

A runtime check on a value is legitimate only if the TypeScript checker shows a **strict refinement** of that subject on the true / success path. Unchanged type is theater.

Candidates (evaluated, not automatic fails): type predicate / `asserts` / `isX` / `assertX`; `typeof`; `instanceof`; nullish / presence on one binding or property; truthiness where TS can refine; non-empty array `length > 0` / `>= 1` / `!== 0`; schema `.safeParse` / `.parse` when the success path still uses the original binding.

**Pass:** true-path type is a strict refinement (`T | undefined` → `T`, `Node` → `FunctionLike`, `T[]` → non-empty, predicate / `instanceof` / `typeof` refine, schema success uses `.data`).

**Fail:** true-path type unchanged (bare-boolean `isFoo(x)`; non-empty-style length leaving `T[]`; nullish that does not drop null/undefined; `safeParse` then property access on raw without narrowing raw).

**Silence (not v1):** `if (x > 5)`, string equality, `length > 5`, multi-binding relations, unresolved `const ok = …` aliases.

Do not flag real ts-morph `Node.is*` / `SyntaxKind` discriminants that narrow, or real `asserts x is T`.

Same span as `ts/no-constant-condition`: **prefer B** (this rule skips when the condition is provably constant).

### `ts/no-constant-condition`

Do not branch on a condition the analyzer can prove always true or always false. **Underapproximate** — silence when unprovable. No numeric / string value lattices.

Proof sources: param type already implies the guard; same-function prior narrowing; same-function prior schema parse (second parse, or hand-guard on raw that restates parse); same-file single-hop call-site facts (all callers already narrowed → report at callee; mixed sites → caller-side redundant checks only if unused elsewhere in the caller); cheap literals (`if (true)`).

Cross-file call sites are a known miss (v2).

### `ts/no-unnecessary-abstraction`

Do not keep a local abstraction that does not pay for its indirection. **Underapproximate** — silence when uncertain. **Same-file only** for caller and type-reference counts (cross-file single-caller is out).

**Quiet barrel / exports:** never flag symbols in a file named `index.ts` / `index.tsx` / `index.mts` / `index.cts`, or a straightforward `package.json` `"exports"` target (string form, or one level of `import` / `require` / `default` / `types`). No `main`/`types` matching; no dist↔src mapping.

**Functions:** exactly one same-file call site (self-calls do not count) **and** either pass-through (body is one call / `return` of one call; unwrap parens / `void` / `await`) **or** small + flat: ≤ 10 non-blank lines of `getBody()` text (`split(/\n/)`, trim, drop empty; braces count if they occupy their own line) and no nested `if` / loop / `try` / `switch`. Zero callers are left to unused/dead-code tools.

**Types:** `type` / `interface` with exactly one same-file type-reference (declaration name does not count). Multiple decls, `extends`, intersections, and unique-symbol brands are silenced.

**React:** only if the owning or workspace-root `package.json` lists `react` / `react-dom` / `preact` in `dependencies` | `peerDependencies` | `devDependencies`, skip `/^use[A-Z]/` names and PascalCase decls that return JSX or are typed as `React.FC` / `FC` / `FunctionComponent`.

### Split (A vs B vs `ts/zod-boundary`)

| Situation | Rule |
|-----------|------|
| Untrusted `unknown` / `JSON.parse` before schema | `ts/zod-boundary` |
| Check runs; true path type unchanged | `ts/type-narrowing-checks` |
| Condition provably always true/false | `ts/no-constant-condition` |
| Second parse on same binding | **B** |
| After successful parse, hand-guard / use of **raw** that is constant given parse | **B** (prefer) |
| After parse, check that isn’t constant but still doesn’t narrow subject | **A** |
| Parse then `.data` correctly | quiet |
| `if (x > 5)` / string eq / `length > 5` | **neither** (silence) |
| Non-empty length without non-empty type | **A** |
| Nullish without dropping nullish | **A** |
| Nullish when already non-nullish | **B** |
| Same span A+B | **prefer B** |

## Not planned in this plugin

Use Biome, ESLint, or dependency-cruiser:

- Circular imports
- Max relative import depth
- Simple path bans (`dist/`, `generated/`, …)
- Deep-import / internal-module bans
- Generic layer charts those tools already do well

**Overlap family** — catalog **none** of these as CI rules here: `import-boundary` / layers / no-import-from / no-deep-import / max-relative-depth.

## Other first-class SPECS rules

R1–R6 stay [SPECS](../SPECS.md) §3 pointers. React / compositional rules live in [`@qualety/react`](./react.md), not this plugin. Structural R4 (`dry/no-duplicate-functions`) lives in [`@qualety/dry`](./dry.md). R3 semantic tokens belong in a future `@qualety/tailwind` (or DS) plugin, not TypeScript, React, or dry. Stretch architecture fitness is not this plugin.
