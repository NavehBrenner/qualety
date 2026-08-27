# Python plugin catalog

Honest catalog for **`@qualety/python`** (`Plugin.name: "python"`).  
This is the implementation list for this plugin. Plugins stay **authored in TypeScript** while checking Python.

The plugin **provides** artifact `"python"` (CPython `ast` via one `python3` spawn) on the same provider map as the default registry and other plugins. Core never imports Python AST types and does **not** default-provide `"python"`. Installing the plugin does **not** enable its rules. `configs.recommended` sets `python/no-unnecessary-def` to `"error"` for users who opt into that preset.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `python/no-unnecessary-def` | Do not keep a local def that does not pay for its indirection: package-local ≤1-use pass-through / small-flat functions and methods. `defineRule` / `requires: ["python"]` | `error` |

### `python/no-unnecessary-def`

Do not keep a local def that does not pay for its indirection. **Underapproximate** — silence when uncertain. Multiplicity is **package-local** (nearest `pyproject.toml` walking up, stop at cwd; none → cwd is the one package), not monorepo-wide. Report when the package-local **call-site** count is **≤ 1** (0 or 1). Functions / methods only — no types arm.

**Skip:** `.pyi`, `test_*.py` / `*_test.py`, path segment `tests` / `__tests__` / `fixtures`, `conftest.py`, `__pycache__`.

**Quiet:** all defs in `__init__.py` (barrel analog). Dunder methods `/^__\w+__$/`. No `package.exports` / React port. No framework decorator allowlist (known over-flag).

**Calls:** package-local call sites only (not import-only / re-export-only; self-calls and the name node do not count). Same-module `Name`; `from … import` / `import mod` + `mod.fn` resolved to a source in that package; `self.` / `cls.` methods on the enclosing class. Underapproximate elsewhere (over-flag), same hole as TS dynamics. `from x import *` is a known miss.

**Shape:** pass-through (body is one call / `return` of one call; unwrap await / parens) **or** small + flat: ≤ 10 non-blank body lines and no nested `if` / `for` / `while` / `try` / `match`. `async def` included. Lambdas out. Zero callers are unnecessary (full YAGNI).

**Violation:** `ruleId` `python/no-unnecessary-def`; location on the def name; 0-vs-1 messages; concrete suggestion (not `NO_SUGGESTION`). Messaging does not say “in this file”.

**Artifact:** empty `.py` set after filter → empty sources, do not spawn, success. Syntax error per file → omit that file. Missing / unrunnable `python3` or bad dump JSON when `.py` exist → exit 2, name the requiring rule. No `QUALETY_PYTHON` env.

## Not planned in this plugin

- DRY / near-duplicate for Python
- Types / Protocol / TypedDict arm
- Python-authored plugins
- Cross-package / monorepo-wide multiplicity
- tree-sitter / libCST
- Ruff clone (import-lint / cycle / path-ban)
- Framework decorator allowlists, `setup.py` as package root, `.pyi` in default include
