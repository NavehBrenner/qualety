# ML plugin catalog

Honest catalog for **`@qualety/ml`** (`Plugin.name: "ml"`).  
This is the implementation list for this plugin. Plugins stay **authored in TypeScript** while checking Python.

The plugin **provides nothing**. Rules `requires: ["python"]` and consume `context.getArtifact("python")`. AST walk helpers are imported from `@qualety/python/walk` (not cloned). The consumer must list **`@qualety/python`** (or another provider of `"python"`) in `plugins[]` when enabling ml rules that need it. Missing provider → fail-closed exit 2. Loading the plugin via `plugins[]` applies `configs.recommended` below. Overlay user `config.rules` to `"off"` or retune. Installing the package without `plugins[]` enables nothing. No `ruff` / `biome` section.

```json
{
  "plugins": ["@qualety/python", "@qualety/ml"]
}
```

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `ml/require-global-seed` | A training module must seed framework RNGs before DataLoader or torch.nn construction. `defineRule` / `requires: ["python"]` | `error` |
| `ml/seed-must-reach-framework-rng` | A seed parameter in a training module must reach a framework RNG, not only split helpers. `defineRule` / `requires: ["python"]` | `error` |
| `ml/dataloader-worker-seeding` | `DataLoader(num_workers>0)` must set `worker_init_fn` or `generator`. `defineRule` / `requires: ["python"]` | `error` |
| `ml/tf32-must-be-explicit` | A module that moves tensors to CUDA must set both `allow_tf32` flags explicitly. `defineRule` / `requires: ["python"]` | `error` |
| `ml/determinism-test-required` | A training entry point must have a test that trains twice and asserts identical weights. `defineRule` / `requires: ["python"]` | `error` |
| `ml/deterministic-algorithms-opt-in` | Opt-in: a training module must call `use_deterministic_algorithms` or set `cudnn.deterministic`. `defineRule` / `requires: ["python"]` | `off` |
| `ml/metadata-writer-required` | Every Gate B training entry and Gate C artifact save must resolve, prove-write, and call `writerName` (default `save_metadata`). `defineRule` / `requires: ["python"]` | `error` |
| `ml/record-code-version` | Resolved metadata writer payload must include an allowlisted code-version key. `defineRule` / `requires: ["python"]` | `error` |
| `ml/run-metadata-completeness` | CLI/config dests and obvious config fields must reach the writer payload (`allowExclusions` to opt out). `defineRule` / `requires: ["python"]` | `error` |

**Training module** (shared, local file evidence only): a non-skipped `.py` whose AST shows a `.backward` attribute call or a `DataLoader(...)` construction. No reachable-from-CLI analysis.

Shared skip (unless a rule tightens): `.pyi`, `test_*.py` / `*_test.py`, path segment `tests` / `__tests__` / `fixtures`, `conftest.py`, `__pycache__`. `ml/determinism-test-required` reads test paths on purpose. Underapproximate — silence when uncertain. Concrete suggestion (not `NO_SUGGESTION`). Messaging does not say “in this file”.

### `ml/require-global-seed`

A training module must call `torch.manual_seed` (not `torch.cuda.manual_seed_all` alone). If stdlib `random` is imported, also `random.seed`. If `numpy` / `numpy.random` / `np` is imported, also `np.random.seed` / `numpy.random.seed`. Seeds must appear before the earliest `DataLoader(...)` when one exists, else before the first proven `torch.nn.*` construction. `.backward()` is not a valid “seeded before” bar.

**Quiet:** non-training; cannot prove training; required seeds present and before proven consumers.

**Violation:** first training-evidence node when seeds are missing; late seed or early consumer when order is wrong. Suggestion: call `torch.manual_seed` (and `random.seed` / `np.random.seed` as needed) before loaders/model init.

### `ml/seed-must-reach-framework-rng`

In a training module, names `seed` / `train_seed` / `split_seed` (function args, simple assigns, argparse `dest=` / `--seed` / `--train-seed` / `--split-seed`) that are **used** must flow (same-function simple) into `torch.manual_seed` / `torch.cuda.manual_seed` / `np.random.seed` / `random.seed` / `Generator(seed=…)` / `DataLoader(..., generator=…)`. Known non-sinks: `train_test_split`, `random.Random(...)`. Any use passed into an unknown Call → silence. No seed-like name → silence.

**Suggestion:** pass the seed into `torch.manual_seed` / numpy / random / loader `generator`.

### `ml/dataloader-worker-seeding`

`DataLoader(num_workers=N)` with static int `N > 0` and neither `worker_init_fn=` nor `generator=` → report. Keyword-only (no positional guessing). Not gated on training-module. Skip test/fixture paths.

**Quiet:** missing / 0 / non-static `num_workers`; either kw present; non-DataLoader.

**Suggestion:** add `worker_init_fn` and/or `generator=` seeded from the run seed.

### `ml/tf32-must-be-explicit`

CUDA-move evidence (underapprox, any object): `.cuda()`; `.to("cuda"|"cuda:N")`; `.to(device("cuda"))`; kw `device="cuda"` literal. Same file must assign both `allow_tf32` on `torch.backends.cuda.matmul` and `torch.backends.cudnn` (any bool).

**Quiet:** no CUDA move; both assigns present; cannot prove CUDA move.

**Suggestion:** set both `allow_tf32` flags explicitly next to device setup.

### `ml/determinism-test-required`

Options `{ entryPoints?: string[] }` (`additionalProperties: false`). Empty/default = heuristic only. Heuristic: module-level `def train` / `def main` in a training module, or `if __name__ == "__main__"` that calls such a name when no matching def. Neither options nor heuristic → no report.

A test file must reference the entry-point symbol **and** have ≥2 calls to a train-like name or the entry point **and** an assert involving `assertEqual` / `torch.equal` / `allclose` / `==` on tensors or `state_dict`. Perfect semantics not required. Missing test → report on entry-point def / main guard.

**Suggestion:** add a test that runs the entry point twice under a fixed seed and asserts identical weights.

### `ml/deterministic-algorithms-opt-in`

Opt-in only (recommended `off`). When enabled error/warn: a training module must call `torch.use_deterministic_algorithms(...)` or assign `torch.backends.cudnn.deterministic = True`. Speed tradeoff is documented here, not in every message.

**Quiet** when recommended off. Training without either → report.

**Suggestion:** call `torch.use_deterministic_algorithms(True)` or set `cudnn.deterministic`.

## Run provenance

Three rules share **Gate B ∨ Gate C** (local file evidence only). No wall-clock / iteration / “long loop” gate. Cross-module artifact hashing is [#127](https://github.com/NavehBrenner/qualety/issues/127). Artifact durability / in-place overwrite is [#128](https://github.com/NavehBrenner/qualety/issues/128).

**Gate B** — same grain as `ml/determinism-test-required`: module-level `def train` / `def main` in a training module, or `if __name__ == "__main__"` that calls such a name when no matching def, or optional `entryPoints`. Helpers that merely contain `.backward` are out of scope.

**Gate C** — non-skipped path with `torch.save(...)` or `joblib.dump(...)`. A `state_dict` write counts only when the write is in the same function and statically obvious. Unprovable → silence.

**Writer** — option `writerName` (string, default `"save_metadata"`) on all three rules. One name; no alias list. Prefer module-level `def`; else a statically obvious same-package bare-name import. Body must show a real write sink (`open(..., "w"|"wb"|"a")` plus write, `Path.write_*`, `json.dump`, `yaml.safe_dump`, `toml.dump`). `json.dumps` alone is not a write. Must be called from each gated entry/save path (same-module call-graph underapprox).

Optional overlay:

```json
{
  "rules": {
    "ml/metadata-writer-required": ["error", { "writerName": "save_metadata" }],
    "ml/record-code-version": ["error", { "writerName": "save_metadata" }],
    "ml/run-metadata-completeness": ["error", {
      "writerName": "save_metadata",
      "allowExclusions": ["verbose", "progress"]
    }]
  }
}
```

### `ml/metadata-writer-required`

Report when a gate hits and the writer is missing, does not write, or is not called from that entry/save path.

**Quiet:** no gate; writer present, writes, and called; cannot prove gate.

**Suggestion:** define `save_metadata` (or configured name) that writes the run record, and call it from the training entry / save path.

### `ml/record-code-version`

Allowlisted keys (case-insensitive): `git_commit`, `git_sha`, `git_rev`, `code_version`, `code_rev`, `behaviour_version`, `behavior_version`, `CODE_VERSION`, `GIT_SHA`, `GIT_COMMIT` — as payload keys, env reads of those names, or constants with those suffixes in the payload. Git CLI / `rev-parse` is not required.

Report when a gate hits, the writer resolves, payload shape is proven, and no code-version evidence is present.

**Quiet:** no gate; no resolved writer; version present; cannot prove payload shape.

**Suggestion:** record `git_commit` / `code_version` (or equivalent allowlisted key) in the metadata writer payload.

### `ml/run-metadata-completeness`

Required names (underapprox): `argparse` `add_argument` `dest=` or flag-derived dest in the same module as the entry; when a single dataclass / pydantic / attrs class is clearly constructed for the entry and fields are obvious — those fields. `allowExclusions` default `[]` (no hardcoded silent list). Consumer examples: `verbose`, `progress`, `help`.

Report when a gate hits, the writer resolves, the required set is non-empty, and a name is not excluded and not in the payload.

**Quiet:** no gate; empty required set; cannot parse arguments/fields; unresolved writer; underapprox failure.

**Suggestion:** pass the missing dest/field into the writer, or add it to `allowExclusions` if it does not affect results.
