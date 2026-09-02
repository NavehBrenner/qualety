# ML plugin catalog

Honest catalog for **`@qualety/ml`** (`Plugin.name: "ml"`).  
This is the implementation list for this plugin. Plugins stay **authored in TypeScript** while checking Python.

The plugin **provides nothing**. Rules `requires: ["python"]` and consume `context.getArtifact("python")`. The consumer must list **`@qualety/python`** (or another provider of `"python"`) in `plugins[]` when enabling ml rules that need it. Missing provider → fail-closed exit 2. Loading the plugin via `plugins[]` applies `configs.recommended` below. Overlay user `config.rules` to `"off"` or retune. Installing the package without `plugins[]` enables nothing. No `ruff` / `biome` section.

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
