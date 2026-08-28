# DRY plugin catalog

Honest catalog for **`@qualety/dry`** (`Plugin.name: "dry"`).  
This is the implementation list for this plugin. Loading the plugin via `plugins[]` applies `configs.recommended` (`dry/no-duplicate-code`, `dry/no-duplicate-python`, and `dry/no-semantic-duplicate` at `"error"`). Overlay user `config.rules` to `"off"` or retune.

The plugin **provides** artifact `"dupehound"` (structural fingerprints via [dupehound](https://github.com/Rafaelpta/dupehound)) and `"code-embeddings"` (check-time MiniLM vectors) on the same provider map as the default registry and other plugins. Core only orchestrates `requires` → build once → `getArtifact`. We do **not** re-own dupehound’s whole-function winnowing / Jaccard. Fragment clones are a ts-morph window hash on this plugin, not a second catalog id. TypeScript interface/type-shape matching is **not** this plugin. Embeddings here are **not** `qualety index`.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `dry/no-duplicate-code` | No duplicate logical code (whole functions or repeated fragments) in included non-test TypeScript sources | `error` |
| `dry/no-duplicate-python` | No duplicate logical functions in included non-test Python sources (whole-function only) | `error` |
| `dry/no-semantic-duplicate` | No semantic near-duplicate functions, methods, or classes in included non-test TypeScript and Python sources | `error` |

Behavior is locked in [SPECS.md](../SPECS.md) §3 R4 and Semantic DRY. Summary:

- **Rule:** `defineRule` with `requires: ["dupehound", "typescript"]`. Uses `getCwd`, `getFiles`, `getArtifact` (`DupehoundIndex` / `ParsedProject` via `ArtifactMap`, no cast), `report`. The **rule** does not spawn CLIs; `provides.dupehound.build` may. Dry does not `provides.typescript`.
- **Engine:** hybrid, one `ruleId`. **Arm F** = dupehound whole-function path (`dupehound scan --json --exclude-tests`, pin **v0.1.2**). **Arm W** = ts-morph consecutive-statement windows (≥ 3 non-blank lines; exact structural hash, hole local bindings, keep property names and literals). Merged reporting. Do not re-own dupehound winnowing.
- **Report gate:** report a cluster only if `joint_loc >= 20` OR `repetitions >= 4` (`joint_loc` = window non-blank lines × member count). 3×3 quiet; 3×4 report; 13×2 report. Arm F uses min member line span (`endLine − startLine + 1`).
- **Skip:** `.d.ts`, `*.test.*` / `*.spec.*`, path segment `__tests__` or `fixtures`; honor workspace include/exclude via sources. Arm F also keeps dupehound generated defaults. Do **not** add `**/*.test.*` to the global default exclude — `ts/public-exports-tested` needs tests in the TypeScript artifact.
- **Violation:** non-representative member (first by `(file, startLine)` is the representative). Message names hosts / locations / that it is duplicate logical code; concrete suggestion to reuse or extract the representative. Never `NO_SUGGESTION`. Arm W uses real columns; Arm F is best-effort lines, column 1.
- **Severity:** `"error"` when enabled via recommended; config may set `"warn"` (label only; violations still fail the run).
- **Fail closed:** missing provider / missing or unrunnable dupehound, timeout, or invalid JSON → exit 2 with a message that names the rule and how to install. Empty clusters after skips → exit 0.
- **Install:** put `dupehound` on `PATH`, or set `QUALETY_DUPEHOUND`. No network inside `qualety check`. Optional repo helper: `scripts/install-dupehound.sh` (writes `.tools/dupehound`).
- **Python twin:** `dry/no-duplicate-python` is Arm F only (same dupehound pin, gate, and suggestion shape). It does not `requires` `python`. Members must be `.py` (not `.pyi`). Skip `test_*.py` / `*_test.py` / `*.test.py` / `*.spec.py` and path segments `tests` / `__tests__` / `fixtures` / `__pycache__`. Fragment windows are TypeScript-only; they are **not** this plugin’s Python surface yet. Arm F of `dry/no-duplicate-code` keeps only `.ts` / `.tsx` / `.mts` / `.cts` so Python never reports under the TS id.

### `dry/no-semantic-duplicate`

- **Rule:** `defineRule` with `requires: ["code-embeddings", "typescript", "python"]`. Reads only `getArtifact("code-embeddings")`. Does not `requires` `dupehound`. Needs `@qualety/python` in `plugins[]` even for TS-only trees (empty `.py` set is a no-op).
- **Chunks:** functions, methods, and classes. Min-size: skip if non-blank lines < 5 or whitespace tokens < 20. Same skip family as structural dry (plus Python `conftest.py` / `.pyi`).
- **Artifact:** `"code-embeddings"` (dry `provides`). Builds after `python` / `typescript` **and other required ids**; dispose pipeline after embed. Normalize: trim, collapse blank-line runs; keep identifiers and comments.
- **Model:** module id `minilm-l6-local`, revision `onnx-quantized-1`, 384-d quantized ONNX (Xenova all-MiniLM-L6-v2 via `@huggingface/transformers`, `allowRemoteModels: false`). Weights: `.tools/minilm-l6/` (`scripts/install-minilm.sh`) or `QUALETY_EMBEDDINGS_MODEL`. Test stub: `QUALETY_EMBEDDINGS_MODULE`.
- **Cache:** `$XDG_CACHE_HOME/qualety/code-embeddings/` (default `~/.cache/qualety/code-embeddings/`). Override `QUALETY_EMBEDDINGS_CACHE`. Key `modelId/revision/sha256(normalized)`. Corrupt entries re-embed.
- **Report:** cosine threshold **0.90** by default (`COSINE_THRESHOLD`). Optional `{ threshold }` (`number`, `> 0` and `≤ 1`) via `["error", { threshold }]`. Omit options → 0.90. One violation per cluster ≥ 2. Primary = first by `(path, name)`; siblings named as `path:line`. Must not say “in this file”. Concrete suggestion to extract a shared helper or reuse a sibling. Never `NO_SUGGESTION`. Independent of structural dry.
- **Fail closed:** model load failure with ≥1 embeddable chunk → exit 2 naming `dry/no-semantic-duplicate` and `code-embeddings`. Zero embeddable chunks → success (do not load the model). Per-chunk vector miss → omit that chunk.

## Not planned in this plugin

- Hosted embedding APIs / a second shipped embedder module
- Type-shape / interface clone detection (later provider or language rule; not dupehound flags)
- `qualety query --similar` / MCP `query_similar` / `qualety index`
- Auto-merge / codemod of duplicates
- Incremental `dupehound check --diff` (later CLI `--diff` work)
- Reimplementing dupehound’s whole-function winnowing / Jaccard
- Sliding-window / whole-file embedding chunks
