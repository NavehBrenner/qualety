---
name: create-plugin
description: >
  Scaffold a new qualety plugin package that satisfies the Plugin contract.
  Use when creating a new plugin (rules plugin or ruleless provider). Do not
  use when adding a rule to an existing plugin (add-rule), re-scaffolding
  core, or rewriting packages/typescript, packages/react, or packages/dry.
---

# Skill: create-plugin

Supported path for a **new** plugin package. Teaches the contract; [`@qualety/plugin-kit`](../../docs/rulesets/plugin-kit.md) enforces the authoring smells.

## When to use

Scaffold a **new** plugin (e.g. `@qualety/foo` or a user-local plugin) that exports a `Plugin`.

## When not to use

- Adding a rule to an existing plugin → [add-rule](../add-rule/SKILL.md).
- Re-scaffolding core / CLI, or rewriting `packages/{typescript,react,dry}`.

## Inputs

- Plugin **name** (e.g. `foo` → `@qualety/foo`, `Plugin.name: "foo"`)
- Path: rules plugin vs ruleless provider; workspace package vs local folder

## Steps

1. Read [docs/SPECS.md](../../docs/SPECS.md) §2 (plugin contract) and locked #2 / #4 / #8. Do **not** invent a parallel API. Engine validates `pluginSchema` / `ruleSchema` at load; `defineRule` is a typed identity and does not parse. `defineRule` rejects ids not in `requires` at `tsc`.
2. Copy the shape of a real package — do **not** re-scaffold those packages or the engine:
   - **Rules plugin** — `packages/typescript` / `packages/react`: `name`, `rules`, optional `configs.recommended`.
   - **Ruleless provider** — `name` + `provides` only (no `rules`). Spawn-allowed pattern: dry’s `provides.dupehound` (`packages/dry/src/dupehound.ts`).
3. Checklist:
   - `package.json` + entry that **exports a `Plugin` object**
    - If a rule is in scope now: `defineRule` + `meta.docs.description` + optional `meta.requires`. If it takes tunables: `meta.schema` (engine validates options; omitted → `undefined`). Otherwise defer to [add-rule](../add-rule/SKILL.md)
   - No empty stub rules
   - In-repo: `packages/*` is already globbed; add `workspace:*` at the root only if root config loads the package
4. Smoke-test: load the plugin, assert `name` and (if any) rule ids.
5. Do not implement full rule logic here unless the user asked for a specific rule in the same task.

Prefer **verbose names** (`artifacts`, not `arts`; `artifactBuildContext`, not `abc`). Shorthands only if the full name would make a variable/function identifier **longer than 20 characters**. If a shorthand is used under that rule, put a **comment line immediately above the declaration** with the full verbose intended name.

## Hard bans

- Engine / CLI re-scaffold
- Import-lint / cycle / path-ban / deep-import family in product plugins (SPECS locked #7)
- Empty stub rules
- `spawn` / `fs` / `process` from rule `create` — providers own binaries via `provides.build`. Rules only consume artifacts (`getArtifact`)

## Consumer config (not a third skill)

Add the package to the consumer `qualety.config.*` `plugins[]`. Loading applies `configs.recommended` if the plugin exports one. Overlay `config.rules` to `"off"` or retune:

```ts
import { defineConfig } from "qualety";

export default defineConfig({
  plugins: ["@qualety/foo"],
  rules: {
    "foo/some-rule": "off",
  },
});
```

## Outputs

- A package that satisfies the Plugin interface
- Discoverable via `plugins: ["..."]`
- No LLM API usage in the plugin runtime

## Out of scope

- Architecture layer maps (consumer config)
- Framework runtime helpers (separate companion packages if needed)
- A third “register plugin” skill — wiring is this section
