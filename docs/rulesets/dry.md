# DRY plugin catalog

Honest catalog for **`@qualety/dry`** (`Plugin.name: "dry"`).  
This is the implementation list for this plugin. Installing the plugin does **not** enable its rules. `configs.recommended` sets `dry/no-duplicate-code` and `dry/no-duplicate-python` to `"error"` for users who opt into that preset.

The plugin **provides** artifact `"dupehound"` (structural fingerprints via [dupehound](https://github.com/Rafaelpta/dupehound)) on the same provider map as the default registry and other plugins. Core only orchestrates `requires` → build once → `getArtifact`. We do **not** re-own dupehound’s whole-function winnowing / Jaccard. Fragment clones are a ts-morph window hash on this plugin, not a second catalog id. Embeddings / Slopo-style semantic near-dupes and TypeScript interface/type-shape matching are **not** this plugin.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `dry/no-duplicate-code` | No duplicate logical code (whole functions or repeated fragments) in included non-test TypeScript sources | `error` |
| `dry/no-duplicate-python` | No duplicate logical functions in included non-test Python sources (whole-function only) | `error` |

Behavior is locked in [SPECS.md](../SPECS.md) §3 R4. Summary:

- **Rule:** `defineRule` with `requires: ["dupehound", "typescript"]`. Uses `getCwd`, `getFiles`, `getArtifact` (`DupehoundIndex` / `ParsedProject` via `ArtifactMap`, no cast), `report`. The **rule** does not spawn CLIs; `provides.dupehound.build` may. Dry does not `provides.typescript`.
- **Engine:** hybrid, one `ruleId`. **Arm F** = dupehound whole-function path (`dupehound scan --json --exclude-tests`, pin **v0.1.2**). **Arm W** = ts-morph consecutive-statement windows (≥ 3 non-blank lines; exact structural hash, hole local bindings, keep property names and literals). Merged reporting. Do not re-own dupehound winnowing.
- **Report gate:** report a cluster only if `joint_loc >= 20` OR `repetitions >= 4` (`joint_loc` = window non-blank lines × member count). 3×3 quiet; 3×4 report; 13×2 report. Arm F uses min member line span (`endLine − startLine + 1`).
- **Skip:** `.d.ts`, `*.test.*` / `*.spec.*`, path segment `__tests__` or `fixtures`; honor workspace include/exclude via sources. Arm F also keeps dupehound generated defaults. Do **not** add `**/*.test.*` to the global default exclude — `ts/public-exports-tested` needs tests in the TypeScript artifact.
- **Violation:** non-representative member (first by `(file, startLine)` is the representative). Message names hosts / locations / that it is duplicate logical code; concrete suggestion to reuse or extract the representative. Never `NO_SUGGESTION`. Arm W uses real columns; Arm F is best-effort lines, column 1.
- **Severity:** `"error"` when enabled via recommended; config may set `"warn"` (label only; violations still fail the run).
- **Fail closed:** missing provider / missing or unrunnable dupehound, timeout, or invalid JSON → exit 2 with a message that names the rule and how to install. Empty clusters after skips → exit 0.
- **Install:** put `dupehound` on `PATH`, or set `QUALETY_DUPEHOUND`. No network inside `qualety check`. Optional repo helper: `scripts/install-dupehound.sh` (writes `.tools/dupehound`).
- **Python twin:** `dry/no-duplicate-python` is Arm F only (same dupehound pin, gate, and suggestion shape). It does not `requires` `python`. Members must be `.py` (not `.pyi`). Skip `test_*.py` / `*_test.py` / `*.test.py` / `*.spec.py` and path segments `tests` / `__tests__` / `fixtures` / `__pycache__`. Fragment windows are TypeScript-only; they are **not** this plugin’s Python surface yet. Arm F of `dry/no-duplicate-code` keeps only `.ts` / `.tsx` / `.mts` / `.cts` so Python never reports under the TS id.

## Not planned in this plugin

- Embedding / vector semantic similarity
- Type-shape / interface / whole-class clone detection (later provider or language rule; not dupehound flags)
- `qualety query --similar` / MCP `query_similar`
- Auto-merge / codemod of duplicates
- Incremental `dupehound check --diff` (later CLI `--diff` work)
- Reimplementing dupehound’s whole-function winnowing / Jaccard
