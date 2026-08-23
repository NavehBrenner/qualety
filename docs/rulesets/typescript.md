# TypeScript plugin catalog

Honest catalog for **`@qualety/typescript`** (`Plugin.name: "ts"`).  
This is the implementation list for this plugin. [typescript-baseline.md](./typescript-baseline.md) and [typescript-nice-to-have.md](./typescript-nice-to-have.md) are research inventories, **not** an implementation backlog.

Core has no built-in rule bag. Rules exist only on this plugin’s `rules` map. Installing the plugin does **not** enable them. `configs.recommended` sets `ts/public-exports-tested`, `ts/zod-boundary`, and `ts/no-double-validation` to `"error"` for users who opt into that preset.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `ts/no-double-validation` | After a successful schema parse, do not re-parse the same input or rebuild the check with a hand type-guard on the original value. `defineRule` / `requires: ["typescript"]` | `error` |
| `ts/public-exports-tested` | Every public value export in included non-test sources is referenced from a test path (static R5-lite; not coverage). `defineRule` / `requires: ["typescript"]` | `error` |
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

### `ts/no-double-validation`

Same function body, same input binding:

- After `schema.safeParse(x)` / `schema.parse(x)`, flag a second `.parse` / `.safeParse` on `x`.
- Flag a hand type-guard on the original unparsed value after a parse exists (`isRecord(raw)`, `typeof raw === "object"`, custom `isPlugin`-style `isX` calls) instead of using `.data` / parse return.
- **Not flagged:** later checks on different data; `instanceof` / ts-morph guards after `getArtifact`.
- **Known miss:** interprocedural dual gates.

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
