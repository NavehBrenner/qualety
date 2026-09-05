# ML plugin catalog

Honest catalog for **`@qualety/ml`** (`Plugin.name: "ml"`).  
This is the implementation list for this plugin. Plugins stay **authored in TypeScript** while checking Python.

The plugin **provides nothing**. Rules `requires: ["python"]` and consume `context.getArtifact("python")`. `ml/no-inplace-artifact-clobber` also `requires: ["git-worktree"]` (default core provider). AST walk helpers are imported from `@qualety/python/walk` (not cloned). The consumer must list **`@qualety/python`** (or another provider of `"python"`) in `plugins[]` when enabling ml rules that need it. Missing provider → fail-closed exit 2. Loading the plugin via `plugins[]` applies `configs.recommended` below. Overlay user `config.rules` to `"off"` or retune. Installing the package without `plugins[]` enables nothing. No `ruff` / `biome` section. Not plugin-kit — consumer ML/run output durability, not plugin-authoring hygiene.

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
| `ml/artifact-hash-recorded` | Every Gate C model-artifact write with a recoverable path must record a path/bytes-bound content hash in the metadata writer payload. `defineRule` / `requires: ["python"]` | `error` |
| `ml/no-inplace-artifact-clobber` | Git-aware in-place clobber of Gate C / run-output writes against tracked or dirty worktree paths. `defineRule` / `requires: ["python", "git-worktree"]` | `error` |
| `ml/pack-padded-sequence-before-rnn` | Pack padded sequences before RNN/LSTM/GRU when `h_n` is consumed. `defineRule` / `requires: ["python"]` | `error` |
| `ml/train-mode-restored` | Restore `.train()` after mid-epoch `.eval()` before the next `.backward()`. `defineRule` / `requires: ["python"]` | `error` |
| `ml/optimizer-zero-grad` | Training `.backward()` + optimizer `.step()` must `zero_grad`. `defineRule` / `requires: ["python"]` | `error` |
| `ml/tensor-to-device-result-ignored` | Bare `tensor.to` / `.cuda` / dtype Expr does not mutate; result ignored. `defineRule` / `requires: ["python"]` | `error` |
| `ml/no-network-in-tests` | Test modules must not download weights (`pretrained` / `from_pretrained` / hub). `defineRule` / `requires: ["python"]` | `error` |
| `ml/no-cuda-hardcoded` | No literal CUDA device hardcoding that breaks CPU-only envs. `defineRule` / `requires: ["python"]` | `error` |

**Training module** (shared, local file evidence only): a non-skipped `.py` whose AST shows a `.backward` attribute call or a `DataLoader(...)` construction. No reachable-from-CLI analysis.

Shared skip (unless a rule tightens): `.pyi`, `test_*.py` / `*_test.py`, path segment `tests` / `__tests__` / `fixtures`, `conftest.py`, `__pycache__`. `ml/determinism-test-required` reads test paths on purpose. `ml/no-network-in-tests` targets test modules on purpose. Underapproximate — silence when uncertain. Concrete suggestion (not `NO_SUGGESTION`). Messaging does not say “in this file”.

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

Three provenance rules share **Gate B ∨ Gate C** (local file evidence only). `ml/artifact-hash-recorded` is **Gate C only**. `ml/no-inplace-artifact-clobber` is Gate C / run-output durability (git-aware). No wall-clock / iteration / “long loop” gate.

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
     }],
     "ml/artifact-hash-recorded": ["error", { "writerName": "save_metadata" }]
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

### `ml/artifact-hash-recorded`

Gate C only (`torch.save` / `joblib.dump`; `state_dict` only as those writes). Gate B training entry alone does not require an artifact hash. `writerName` default `"save_metadata"` (same resolution as provenance). `entryPoints` is accepted so overlays match provenance grain; this rule ignores it.

Require a **bound** path, not a bare hash key:

1. Save site has a statically recoverable destination (string constant, `os.path.join` / `pathlib.Path` / `joinpath` / `/` of constants, or a name bound to one of those in the same scope/module). Unrecoverable → silence.
2. A `hashlib.{sha256,sha1,md5}` digest (optional `.hexdigest()` / `.digest()`) is bound to that path (read via `open` / `Path.read_bytes` / `read_text`) or to the same local object name passed into the save (strict). Same-package modules may split save / hash helper / writer via bare-name `ImportFrom` (same underapprox as `resolveWriter`). Outside package / unresolvable import → silence.
3. That digest (or a name holding it) reaches the writer payload as the value of an allowlisted key (`artifact_hash`, `model_hash`, `weights_hash`, `content_hash`, `file_hash`, `sha256`, `sha1`, `md5`, `digest`) or as a payload value. Bare key presence, hash of a different path, or an unrelated name is not a pass.

**Report when:** Gate C hits, path recoverable, writer resolves, bound hash→payload link proven absent.

**Quiet:** no Gate C; path unrecoverable; writer unresolved (other rule owns); binding present; any underapprox failure.

**Suggestion:** hash the saved artifact (e.g. `hashlib.sha256(Path(path).read_bytes()).hexdigest()`) and record it in `save_metadata` (or configured writer) under an allowlisted key such as `artifact_hash`.

### `ml/no-inplace-artifact-clobber`

Gate C / run-output durability. `requires: ["python", "git-worktree"]`. Recommended `error`. No `writerName` / `entryPoints`. Not a plugin-kit rule.

In scope (underapprox): `torch.save(...)` / `joblib.dump(...)`; `state_dict` only as those same-function writes; `Path.write_bytes` / `open(..., "w"|"wb")` only when the dest literal looks like an artifact/run output (`checkpoint`, `artifact`, `weights`, `output`, `model.pt`, `.ckpt`, `.safetensors`, …) **or** the write sits in a function that already has a Gate C save. Unrelated `open("train.log")` → silence.

Dest recovery is `stringConstant` only. Unrecoverable (name, f-string, join of vars) → silence. Path keys are posix-relative to the git toplevel.

**Report when** `git-worktree.available` and dest is recoverable and present in worktree entries as tracked, dirty, or already-untracked, and the write is a direct in-place clobber of that same path (no atomic replace).

**Quiet:** git unavailable; dest unrecoverable; not an artifact save; same-function `os.replace` / `Path.replace` onto the final name; path not in `entries` (first-time write); underapprox failure.

**Suggestion:** write to a staging path and `os.replace` onto the final name (or write under a unique run directory); do not clobber a tracked or dirty artifact path in place.

## Torch correctness

Function-scoped unless noted. Same shared skip as above except `ml/no-network-in-tests`. Underapproximate — silence when proof fails.

### `ml/pack-padded-sequence-before-rnn`

RNN/LSTM/GRU call (`lastAttr` `rnn`/`lstm`/`gru`, or `.forward` whose chain contains those) whose **second return** is consumed (`out, h = …` and `h` loaded, LSTM `(h_n, c_n)` unpack, or result `[1]`) with no `pack_padded_sequence` / `pack_sequence` call before it in the same function.

**Quiet:** output-only / `_` unused; pack proven in-function before the RNN; cannot prove RNN or `h_n` use.

**Suggestion:** `pack_padded_sequence` (or `pack_sequence`) before the RNN when consuming `h_n`.

### `ml/train-mode-restored`

In a function that contains `.backward(`: `.eval()` then a later `.backward(` with no `.train()` between.

**Quiet:** no `.eval()`; `.train()` restored before next backward; inference-only (no backward); cannot prove ordering. Serve eval is not this rule.

**Suggestion:** call `model.train()` after the validation/eval pass before the next training step.

### `ml/optimizer-zero-grad`

Same function has `.backward(` and an optimizer `.step(` (`optimizer` / `opt` / `optim` recv) and **no** `.zero_grad(` anywhere in that function. Presence of `zero_grad` (including under `step % k`) quiets.

**Quiet:** missing backward or step; `zero_grad` present; cannot prove optimizer step.

**Suggestion:** call `optimizer.zero_grad()` before each accumulation window (or once per step if not accumulating).

### `ml/tensor-to-device-result-ignored`

`Expr` whose value is `.to` / `.cuda` / `.cpu` / `.float` / `.half` / `.double` / `.bfloat16`. For `.to`, require a device/dtype arg. Recv `model` / `self` / `net` / `module` quiets `.to`/`.cuda` (module in-place). Assigned / returned / Call-arg is not an `Expr` stmt.

**Quiet:** result used; proven module in-place `.to`/`.cuda`; cannot prove a cast.

**Suggestion:** assign the result (`x = x.to(device)`), or use in-place only on modules.

### `ml/no-network-in-tests`

Test paths only. `pretrained=True`; `weights=` string/True/attr that is not `None`/`False`; `from_pretrained` / `hf_hub_download`; `torch.hub.load`. Keyword proof only for pretrained/weights.

**Quiet:** non-test paths; `pretrained=False` / `weights=None`; cannot prove download.

**Suggestion:** build encoders/models with `pretrained=False` / `weights=None` in tests; use fixtures or local tiny weights.

### `ml/no-cuda-hardcoded`

`.cuda()` method; `device="cuda"` / `"cuda:N"` keyword; `.to("cuda")` / `torch.device("cuda")` string constant (`^cuda(?::\d+)?$`). Overlap with `ml/tf32-must-be-explicit` on `.cuda()` is intended.

**Quiet:** device from variable/arg; `"cpu"` literals; cannot prove the string is cuda.

**Suggestion:** take `device` from config/arg; use `torch.device("cuda" if torch.cuda.is_available() else "cpu")` or equivalent resolved device.
