# Plugin-kit catalog

Honest catalog for **`@qualety/plugin-kit`** (`Plugin.name: "plugin-kit"`).

Portable **plugin-authoring** rules. Same audience as the [create-plugin](../../skills/create-plugin/SKILL.md) and [add-rule](../../skills/add-rule/SKILL.md) skills (skills teach; this kit enforces). Not a product app catalog (`ts` / `react` / `dry`). Not monorepo architecture (`@qualety/dev`).

Installing the plugin does **not** enable its rules. `configs.recommended` sets both v0 ids to `"error"` for users who opt into that preset.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `plugin-kit/no-spawn-in-create` | No `spawn` / `exec` / `execFile` / `fork` (or Sync / `node:child_process/promises` twins) in rule `create` or same-file helpers it calls. Quiet in `provides.build`. | `error` |
| `plugin-kit/prefer-define-rule` | Prefer `defineRule` over a bare `{ meta, create }` object on a plugin `rules` map. | `error` |

### `plugin-kit/no-spawn-in-create`

Portable authoring detector (not hardcoded `packages/{typescript,react,dry}` paths).

- Find Plugin object literals (`name` plus `rules` and/or `provides`).
- Collect each rule `create` (`defineRule({ create })`, bare `{ meta, create }`, or an identifier followed to that shape).
- Flag `spawn` / `exec` / `execFile` / `fork` and Sync twins, including `child_process.spawn` / `cp.spawn`, inside `create` or same-file functions `create` calls (same-file fixpoint).
- **Quiet** in `provides.*.build` and modules only reached from build.
- Suggestion: move process work into `provides.build` (or a provider plugin); rules only consume artifacts.

Known miss: spawn in a *different* file imported by `create`; Bun / Deno spawn APIs.

### `plugin-kit/prefer-define-rule`

Tight contract check — not a repo-wide style nit.

- Only `rules` maps on Plugin objects (`name` + `rules`). Skip `configs.recommended.rules` (severity strings).
- OK: `defineRule(...)`, or an identifier that resolves in-file / via relative import to `export const x = defineRule(...)`.
- Flag: object literal `{ meta, create }` on the map, or an identifier bound to that bare object.
- Unresolved (package import, dynamic) → no report.
- Suggestion: wrap with `defineRule` and list artifact ids in `meta.requires`.

## Not in this kit

- `no-artifact-cast` / general `as` — TypeScript + Biome (repo-wide hygiene). Future fold of TS/Biome-class checks into qualety plugins is a separate architecture track.
- `no-parallel-violation-dto` — later general duplication / parallel-type story.
- Clones of engine fail-closed load checks (malformed `meta`, missing provider, `getArtifact` outside `requires`, etc.).
