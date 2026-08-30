# TypeScript plugin catalog

Honest catalog for **`@qualety/typescript`** (`Plugin.name: "ts"`).  
This is the implementation list for this plugin. [typescript-baseline.md](./typescript-baseline.md) and [typescript-nice-to-have.md](./typescript-nice-to-have.md) are research inventories, **not** an implementation backlog.

Core has no built-in rule bag. Rules exist only on this plugin’s `rules` map. Loading the plugin via `plugins[]` applies `configs.recommended` (`ts/public-exports-tested`, `ts/zod-boundary`, `ts/type-narrowing-checks`, `ts/no-constant-condition`, `ts/no-unnecessary-abstraction`, `ts/no-unsafe-assertion`, `ts/no-empty-catch`, `ts/no-floating-promises`, `ts/no-misused-promises`, `ts/exhaustive-switch`, `ts/explicit-public-return-types`, `ts/no-non-null-assertion`, `ts/no-export-star`, and `ts/no-public-any` at `"error"`). Overlay user `config.rules` to `"off"` or retune. `biome: false` skips the Biome phase.

## Compiler defaults

Not a catalog row and not a `tsc` phase. The package ships a `compilerOptions` fragment. Install `@qualety/typescript` and extend it; product `ts/*` still need `plugins[]`. `qualety check` does not run `tsc --noEmit`.

```json
{
  "extends": "@qualety/typescript/tsconfig/recommended.json"
}
```

Keys (all `true`): `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `skipLibCheck`, `verbatimModuleSyntax`, `isolatedModules`. Layer project `target` / `lib` / `module` on the extending config.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `ts/no-constant-condition` | Do not branch on a condition the analyzer can prove always true or always false (param type, prior narrowing, prior parse, same-file call-site facts, cheap literals). `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/exhaustive-switch` | Switch on a finite union or enum must handle every member or use a never-typed default. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/explicit-public-return-types` | Exported functions and public class methods must have an explicit return type. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-empty-catch` | Do not use a catch clause whose body is empty or only comments. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-export-star` | Do not use `export *` or `export * as ns`; name the public surface. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-floating-promises` | Do not leave a Promise as an expression statement without `await`, `return`, `void`, or a rejection handler. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-misused-promises` | Do not pass a Promise-returning function where a sync void callback is expected. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-non-null-assertion` | Do not use a non-null assertion (`expr!`) on an expression. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-public-any` | Public value exports must not be annotated as `any` or `any[]`. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-unnecessary-abstraction` | Do not keep a local abstraction that does not pay for its indirection: package-local ≤1-use pass-through / small-flat helpers and ≤1-use type aliases. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/no-unsafe-assertion` | Do not use `as any` or `as unknown as T` assertions that erase type safety. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/public-exports-tested` | Every public value export in included non-test sources is referenced from a test path (static R5-lite; not coverage). `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/type-narrowing-checks` | A runtime check on a value is legitimate only if the TypeScript checker shows a strict refinement of that subject on the true/success path. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/zod-boundary` | Load/parse functions with an `unknown` param (Z1) and `JSON.parse` results (Z2) must hit schema `.parse` / `.safeParse` before property access. `defineRule` / `requires: ["typescript"]` | `error` |

Recommended Biome **deltas** live on this plugin’s `biome.rules` (not `ts/*` rows). Overlay user `config.biome.rules` (`"off"` or retune) or set `biome: false` to skip the phase. Keys at error: `nursery/noUnsafeTypeAssertion`; `complexity/noExcessiveCognitiveComplexity` (`maxAllowedComplexity: 15`); `suspicious/noExplicitAny`; `style/noNonNullAssertion`; `suspicious/noTsIgnore`; `complexity/noBannedTypes`; `suspicious/noFocusedTests`; `correctness/noUnusedFunctionParameters`; `style/useThrowOnlyError`; `nursery/noImpliedEval`. `ts/no-unsafe-assertion` and `ts/no-empty-catch` stay Implemented: Biome’s `noUnsafeTypeAssertion` flags any `as T`, and empty-block rules are not catch-only.

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

Candidates (evaluated, not automatic fails): type predicate / `asserts` / `isX` / `assertX`; `typeof`; `instanceof`; nullish / presence on one binding or property; truthiness where TS can refine; non-empty array `length > 0` / `>= 1` / `!== 0`; schema `.safeParse` / `.parse` when the success path still uses the original binding. Compound `&&` leaves are evaluated; `||` is left whole (underapprox). True path is the enclosing `if` / ternary.

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

Do not keep a local abstraction that does not pay for its indirection. **Underapproximate** — silence when uncertain. Multiplicity is **package-local** (nearest `package.json` / owning-package helper), not monorepo-wide. Report when the package-local use count is **≤ 1** (0 or 1). Same skip set as declarations: `.d.ts`, `*.test.*` / `*.spec.*`, `__tests__`, `fixtures`.

**Quiet barrel / exports:** never flag symbols in a file named `index.ts` / `index.tsx` / `index.mts` / `index.cts`, or a straightforward `package.json` `"exports"` target (string form, or one level of `import` / `require` / `default` / `types`). No `main`/`types` matching; no dist↔src mapping.

**Functions:** package-local **call sites only** (not import-only / re-export-only; self-calls and the name node do not count; alias unwrap so `import { fn }` then `fn()` matches) **and** either pass-through (body is one call / `return` of one call; unwrap parens / `void` / `await`) **or** small + flat: ≤ 10 non-blank lines of `getBody()` text (`split(/\n/)`, trim, drop empty; braces count if they occupy their own line) and no nested `if` / loop / `try` / `switch`. Zero callers are unnecessary (full YAGNI).

**Types:** `type` / `interface` with package-local type-reference count ≤ 1 (declaration name does not count; import/export specifiers do not count). Multiple decls, `extends`, intersections, and unique-symbol brands are silenced.

**React:** only if the owning or workspace-root `package.json` lists `react` / `react-dom` / `preact` in `dependencies` | `peerDependencies` | `devDependencies`, skip `/^use[A-Z]/` names and PascalCase decls that return JSX or are typed as `React.FC` / `FC` / `FunctionComponent`.

### `ts/no-unsafe-assertion`

Flag `expr as any` and `expr as unknown as T` (once, on the outer assertion). Skip `.d.ts`, `*.test.*` / `*.spec.*`, `__tests__`. Do not flag `as const`, lone `as unknown`, or other `as T`. Non-null `expr!` lives on `ts/no-non-null-assertion`. Angle-bracket `<any>x` is deferred.

### `ts/no-empty-catch`

Flag `catch` whose block has zero statements (`catch {}`, `catch (e) {}`, comment-only). Any statement silences (including `throw`, `return`, `continue`, `;`). Same skip set. Does not prove logging quality.

### `ts/no-floating-promises`

Expression statements only. Skip `void expr`. Skip a chain that has `.catch(...)` or `.then(onFulfilled, onRejected)` (arity ≥ 2). Bare `.then(onFulfilled)` and `.finally` do not skip. `await` / `return` are quiet by construction.

Promise signal is underapprox (default provider skips lib files): checker type named `Promise` / text `/^Promise</` and not `any` / `unknown` / `error` / union / intersection, **or** callee is `async` / explicit return type starting with `Promise` / `new Promise`. Silence when neither is clear. Known miss: unannotated non-async function that returns a Promise when the checker cannot see `Promise`. Same skip set.

### `ts/no-public-any`

Exported declarations only (`export function` / `export const|let|var` / `export default` function or binding). Flag explicit `: any` / `: any[]` on params, returns, and bindings, and initializer `as any` on that export. Skip type-only, `export *`, `export =`, `.d.ts`, test paths. Silence `export { x }` / `export { x } from`. Do not infer unannotated internals. Do not flag `unknown`. Public `Function` / `Object` deferred.

### `ts/no-misused-promises`

Flag a Promise-returning / `async` function in a **sync void** consumer position. Stacks with `ts/no-floating-promises` (expression-statement floats vs callback / assignment). Checker: call argument whose matching parameter is a function returning void / undefined and not `Promise` (silence `any` / `unknown` / error / mixed overloads); assignment / annotated binding whose target is that same void function type. Structural fallback: `.forEach(` callback that is `async` or Promise-returning (lib-less `Array.forEach` is otherwise silent). Do not structural-flag `map` / `filter` / `reduce`. Suggestion: `void` the work, hoist to an outer `async`, `.catch`, or do not pass `async`. Same skip set.

### `ts/exhaustive-switch`

Flag `switch` on a finite unit union / enum when a member has no `case` and there is no exhaustive default. Finite = every constituent is a string / number / boolean literal, enum member, `null`, `undefined`, or `never`. Silence wide `string` / `number` / `any` / `unknown` / unresolved / object. Empty fallthrough counts. Bare `default:` does not; a default with `const _exhaustive: never = …` or a `return` of a never-typed binding does. Suggestion: add missing case(s) or `const _exhaustive: never = …`. Same skip set.

### `ts/explicit-public-return-types`

Exported functions / methods need an explicit **return** type (params not in v1). Scan: `export function` / `export async function` / `export default function`; `export const|let|var` whose initializer is function-like (annotation on the function **or** a function-type on the binding counts); `export default` of a function-like; public methods / getters on `export class` / `export default class`. Skip type-only, `export { x }` / `export { x } from` / `export *`, constructors, private / protected / `#private`, setters, object-literal methods on exported consts, test / `.d.ts`. Suggestion: add `): T` (checker inferred text when cheap).

### `ts/no-non-null-assertion`

Flag `SyntaxKind.NonNullExpression` (`expr!`, including `obj.prop!` / `arr[i]!`). Skip definite assignment on fields (`foo!: T`). Skip test / `.d.ts`. Product rule even if Biome also flags `!`. Suggestion: narrow, default, or throw.

### `ts/no-export-star`

Flag `export * from "…"` and `export * as ns from "…"`. Skip test / `.d.ts`. Suggestion: explicit `export { A, B } from "…"`.

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

R1–R6 stay [SPECS](../SPECS.md) §3 pointers. React / compositional rules live in [`@qualety/react`](./react.md), not this plugin. Structural R4 (`dry/no-duplicate-code`) lives in [`@qualety/dry`](./dry.md). R3 semantic tokens belong in a future `@qualety/tailwind` (or DS) plugin, not TypeScript, React, or dry. Stretch architecture fitness is not this plugin.
