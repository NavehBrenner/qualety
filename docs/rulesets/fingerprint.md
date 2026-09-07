# Fingerprint plugin catalog

Honest catalog for **`@qualety/fingerprint`** (`Plugin.name: "fingerprint"`).  
This is the implementation list for this plugin. Plugins stay **authored in TypeScript** while checking Python.

The plugin **provides nothing**. Rules `requires: ["python"]` and consume `context.getArtifact("python")`. AST walk helpers are imported from `@qualety/python/walk` (not cloned). The consumer must list **`@qualety/python`** (or another provider of `"python"`) in `plugins[]`. Missing provider → fail-closed exit 2. Loading the plugin via `plugins[]` applies `configs.recommended` below. Overlay user `config.rules` to `"off"` or retune. Installing the package without `plugins[]` enables nothing. No `ruff` / `biome` section. Not ML-specific and not under `@qualety/ml`.

```json
{
  "plugins": ["@qualety/python", "@qualety/fingerprint"]
}
```

Binding is **opt-in**. Options name fully-qualified callables (`module.path.fn`). There is no heuristic “find every hash-looking fn.” When a rule is **enabled** and `hashFunctions` is empty → **one setup warning** (name at least one callable or turn the rule off). No field / version / code-version findings until bound. Unresolvable defs are silent (except versioned-payload, which **fails closed** once a def is resolved).

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `fingerprint/hash-covers-every-config-field` | Every field of the bound hash fn’s config type must be read inside the fn (minus `excludeFields`). `defineRule` / `requires: ["python"]` | `error` |
| `fingerprint/versioned-hash-payload` | Bound hash fn must fold an explicit version contribution into the hash payload. `defineRule` / `requires: ["python"]` | `error` |
| `fingerprint/hash-includes-code-version` | Bound hash fn must fold an allowlisted code-version symbol into the hash payload. `defineRule` / `requires: ["python"]` | `off` |

v1 is **Python only**. Config types in scope: `dataclasses.dataclass`, `typing.TypedDict`, bare annotated config class, pydantic `BaseModel` subclasses when import-proven, and attrs `@define` / `@frozen` / `@attr.s` **when fields are annotated** (`AnnAssign`). Unannotated `attr.ib()` / `field()`, `init=False` parsing, and attrs converters are out of v1. Field list = class-body `AnnAssign` names (skip `ClassVar`, skip dunder).

A **config-only fingerprint means “same knobs,” not “same data.”** Enable `fingerprint/hash-includes-code-version` when the cache key must also pin code.

Concrete suggestion (not `NO_SUGGESTION`). Messaging does not say “in this file.”

### `fingerprint/hash-covers-every-config-field`

Options `{ hashFunctions?: string[], excludeFields?: { [TypeName]: string[] } }`. `excludeFields` is encoded as `{ type: "object", additionalProperties: true }` (engine schema subset); `create` keeps `string[]` values and ignores malformed entries.

For each **resolved** hash fn: primary config arg is param named `config`/`cfg`, else first non-`self`/`cls`. Annotation → ClassDef (unwrap `Optional` / `Union[..., None]`). Silence if the type is unproven. Fields = AnnAssign names on that class + resolvable bases (unresolvable bases do not invent fields). `excludeFields[TypeName]` subtracts. A field is covered if the config object is read as attribute / subscript / `getattr(..., "name")` / dict key, in the fn body **or same-module Name callees** (cap depth 2). Missing → one report at the hash fn def, suggestion lists missing fields.

**Quiet:** unbound after the setup warning; FQ does not resolve; config type unproven; every remaining field is read.

**Violation:** enabled + empty `hashFunctions` → setup warning. Bound + proven type + missing fields → report at fn def.

**Suggestion:** read each missing field on the config object inside the hash function (or name it in `excludeFields`).

### `fingerprint/versioned-hash-payload`

Same `hashFunctions`. Extra `versionKeys?: string[]`.

Inside a **bound resolved** fn (and same-module helpers): prove a version contribution folded into the hash input. Match: Name / attr / const matching `/(schema_)?version|_VERSION$/i` **or** `versionKeys`, appearing as an arg (or dict key/value in an arg) to `update` / `hashlib` constructors (`sha256` / `sha1` / `md5` / `blake2b` / `blake2s`) / `json.dumps` / builtin `hash`.

**Fail closed:** bound + resolved + contribution not proven → report at fn def. Unbound or unresolvable def → silence.

**Suggestion:** fold a `schema_version` / `*_VERSION` constant (or a `versionKeys` name) into the hash input.

### `fingerprint/hash-includes-code-version`

Same bind. Allowlist: `CODE_VERSION`, `GIT_SHA`, `git_sha`, plus `codeVersionNames?: string[]`. Must be read **into the hash payload** (same fold as versioned-payload). Recommended stays **off**.

**Quiet:** rule off; unbound after setup warning; FQ does not resolve; allowlisted symbol is in the payload.

**Violation:** enabled + empty `hashFunctions` → setup warning. Bound + no allowlisted code version in the payload → report at fn def.

**Suggestion:** fold `CODE_VERSION` / `GIT_SHA` / `git_sha` (or a `codeVersionNames` symbol) into the hash payload. Config-only fingerprints mean same knobs, not same data.
