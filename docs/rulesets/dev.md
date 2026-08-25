# Dev plugin catalog

Honest catalog for **`@qualety/dev`** (`Plugin.name: "dev"`).

This is a **monorepo-only dogfood plugin**. It is **not** a consumer ruleset. The package is `"private": true` and is not published. Do not add it to an application just to get architecture gates — those checks encode how *this* repository is built.

Installing the plugin does **not** enable its rules. There is no `configs.recommended`.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `dev/concrete-suggestion` | In-repo product rules must not report the `NO_SUGGESTION` sentinel | n/a (not a consumer preset) |
| `dev/core-provider-boundaries` | Core must not own dupehound / `QUALETY_DUPEHOUND`; `ts-morph` only in the default TypeScript provider module | n/a (not a consumer preset) |
| `dev/docs-export-honesty` | Public `qualety` exports ↔ `docs/api.md`; plugin `rules` keys ↔ Implemented tables | n/a (not a consumer preset) |
| `dev/no-fs-in-rules` | Product rule modules must not import `node:fs`; provider `build` may | n/a (not a consumer preset) |

### `dev/core-provider-boundaries`

Scope: `packages/qualety/**` only.

- **Dupehound:** flag import/require specifiers containing `dupehound`; `spawn`/`exec`/`execFile` (and sync twins) whose args mention `dupehound`; identifier or string `QUALETY_DUPEHOUND`; other string literals naming that binary. Suggestion names `@qualety/dry`.
- **ts-morph:** flag `ts-morph` / `ts-morph/…` imports unless the file exports `createTypeScriptProvider`. Do not inspect `package.json` (ts-morph stays a core dependency). Do not flag other packages.

### `dev/docs-export-honesty`

Requires `typescript` and `workspace-docs` (markdown/text only; the rule does not use `node:fs`).

- **Arm A:** `docs/api.md` `## Exports` table ↔ names on `packages/qualety/src/index.ts` (value + type), both directions.
- **Arm B:** Implemented tables in `docs/rulesets/{typescript,react,dry,dev}.md` ↔ `plugin.name` + `rules` keys, both directions. Stop at the next `## `. Skip Backlog / Not planned / research inventories.

### `dev/no-fs-in-rules`

Scope: `packages/{typescript,react,dry,dev}/**`, skip tests. Flag `node:fs` / `fs` imports on the rule-side module graph (files reachable from plugin `rules` entries). Exempt files reachable from `provides.*.build`.

Known miss: dynamic specifier concat; non-`fs` IO (`node:child_process` in a rule → `plugin-kit/no-spawn-in-create`).

### `dev/concrete-suggestion`

Same product-plugin scope, skip tests. Flag `report({ suggestion })` when the value is the imported `NO_SUGGESTION` identifier or the exact sentinel string.
