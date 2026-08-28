# Python plugin catalog

Honest catalog for **`@qualety/python`** (`Plugin.name: "python"`).  
This is the implementation list for this plugin. Plugins stay **authored in TypeScript** while checking Python.

The plugin **provides** artifact `"python"` (CPython `ast` via one `python3` spawn) on the same provider map as the default registry and other plugins. Core never imports Python AST types and does **not** default-provide `"python"`. Loading the plugin via `plugins[]` applies `configs.recommended` (`python/no-unnecessary-def`, `python/no-unnecessary-class`, `python/public-exports-tested`, `python/no-mutable-default`, `python/require-typed-public`, `python/no-bare-except`, `python/no-silent-except`, `python/no-open-without-with`, `python/no-sys-path-hack`, and `python/no-public-any` at `"error"`). Overlay user `config.rules` to `"off"` or retune.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `python/no-unnecessary-def` | Do not keep a local def that does not pay for its indirection: package-local ≤1-use pass-through / small-flat functions and methods. `defineRule` / `requires: ["python"]` | `error` |
| `python/no-unnecessary-class` | Do not keep a local class that does not pay for its indirection: package-local ≤1-use thin / pass-through classes. `defineRule` / `requires: ["python"]` | `error` |
| `python/public-exports-tested` | Every public name on a package `__init__` / `__all__` surface is referenced from a test path (static; not coverage). `defineRule` / `requires: ["python"]` | `error` |
| `python/no-mutable-default` | Do not use a mutable object as a function default argument. `defineRule` / `requires: ["python"]` | `error` |
| `python/require-typed-public` | Public callables must have parameter and return annotations. `defineRule` / `requires: ["python"]` | `error` |
| `python/no-bare-except` | Do not use a bare `except:` or `except BaseException`. `defineRule` / `requires: ["python"]` | `error` |
| `python/no-silent-except` | Do not swallow exceptions with a no-op except body. `defineRule` / `requires: ["python"]` | `error` |
| `python/no-open-without-with` | Do not call `open(...)` outside a `with` / `async with` in the same function. `defineRule` / `requires: ["python"]` | `error` |
| `python/no-sys-path-hack` | Do not mutate `sys.path` / `sys.path_hooks` to fix imports. `defineRule` / `requires: ["python"]` | `error` |
| `python/no-public-any` | Public callables must not annotate parameters or return type as bare `Any`. `defineRule` / `requires: ["python"]` | `error` |

Shared skip (unless a rule tightens): `.pyi`, `test_*.py` / `*_test.py`, path segment `tests` / `__tests__` / `fixtures`, `conftest.py`, `__pycache__`. Underapproximate — silence when uncertain. Concrete suggestion (not `NO_SUGGESTION`). Messaging does not say “in this file”. No framework decorator allowlists. No types/Protocol arm beyond annotation presence on `python/require-typed-public` and banning bare `Any` on `python/no-public-any`. No DRY/embeddings.

**Artifact:** empty `.py` set after filter → empty sources, do not spawn, success. Syntax error per file → omit that file. Missing / unrunnable `python3` or bad dump JSON when `.py` exist → exit 2, name the requiring rule. No `QUALETY_PYTHON` env.

### `python/no-unnecessary-def`

Do not keep a local def that does not pay for its indirection. **Underapproximate** — silence when uncertain. Multiplicity is **package-local** (nearest `pyproject.toml` walking up, stop at cwd; none → cwd is the one package), not monorepo-wide. Report when the package-local **call-site** count is **≤ 1** (0 or 1). Functions / methods only — no types arm.

**Quiet:** all defs in `__init__.py` (barrel analog). Dunder methods `/^__\w+__$/`. No `package.exports` / React port. No framework decorator allowlist (known over-flag).

**Calls:** package-local call sites only (not import-only / re-export-only; self-calls and the name node do not count). Same-module `Name`; `from … import` / `import mod` + `mod.fn` resolved to a source in that package; `self.` / `cls.` methods on the enclosing class. Underapproximate elsewhere (over-flag), same hole as TS dynamics. `from x import *` is a known miss.

**Shape:** pass-through (body is one call / `return` of one call; unwrap await / parens) **or** small + flat: ≤ 10 non-blank body lines and no nested `if` / `for` / `while` / `try` / `match`. `async def` included. Lambdas out. Zero callers are unnecessary (full YAGNI).

**Violation:** `ruleId` `python/no-unnecessary-def`; location on the def name; 0-vs-1 messages; concrete suggestion (not `NO_SUGGESTION`). Messaging does not say “in this file”.

### `python/no-unnecessary-class`

Mirror YAGNI for **classes**. Package-local. Report when **use count ≤ 1** (0 or 1) **and** at least one shape gate holds.

**Uses:** instantiation `Call` whose callee resolves to the class; `ClassDef.bases` that resolve to the class. Import-only / re-export-only do not count. The class’s own body does not count as external use. Unresolved / dynamic → not a use.

**Shape — thin / namespace bag:** class body is only function defs, simple `Assign`/`AnnAssign`, `Pass`, docstring. `__init__` absent or pass/ellipsis/docstring-only.

**Shape — pass-through class:** exactly one non-dunder instance method (not `@classmethod` / `@staticmethod`) that is pass-through or small-flat; no other non-dunder behavior.

**Quiet:** any base other than absent/`object`; metaclass present; dunder-heavy (≥2 dunders besides `__init__`). Do **not** auto-quiet `__init__.py`.

**Violation:** class name; 0-vs-1 messages; concrete inline/remove/wait-for-second-use suggestion.

### `python/public-exports-tested`

Cousin of `ts/public-exports-tested`. Public surface is **package `__init__.py` only**.

**Public names:** if `__all__` is a single `Assign`/`AnnAssign` to a list/tuple of string constants → those names, minus `_` prefix. Dynamic / augmented / unparsable `__all__` → silence the package. Else: non-`_` top-level `ImportFrom` binds or simple `Name = Name` aliases in package `__init__.py`. No `__all__` and no clear re-exports → no report. Star-import is a known miss.

**Tested:** a `test_*.py` / `*_test.py` / `tests` / `__tests__` / `conftest.py` file (same package or any test in the artifact that imports that package) references the name via resolvable import or `mod.name` attribute. Unresolved / `import *` does not satisfy. Fixture dirs are not tests. Keep tests in the Python artifact.

**Violation:** names the export on the `__all__` string or the `__init__` bind; suggestion: add a test import or stop exporting.

### `python/no-mutable-default`

Flag function/method **default argument values** that are mutable literals / constructors visible statically: `list` / `dict` / `set` literals, `list()` / `dict()` / `set()`, and same-module empty-collection factories / aliases. Include `async def`. Scope is the def (not package-local). All non-skipped defs in non-test sources.

**Quiet:** unknown calls; tuple / frozenset / immutable helpers we cannot prove mutable; pydantic/`Field` we cannot parse.

**Violation:** on the default expression; suggestion: `None` + assign inside body, or an immutable default.

### `python/require-typed-public`

Annotation presence only (not Protocol/TypedDict). **Public callable:** module-level function or class method whose name does not start with `_`, defined outside `__init__.py` in a non-skipped module, **or** listed in `__all__` / clearly re-exported from package `__init__.py`. Skip methods on `_`-prefixed classes. Nested defs, dunders, `typing.overload`, test/fixture paths: quiet. `__init__.py` def not in `__all__`: quiet.

**Require:** every parameter except `self` / `cls` has an annotation; return annotation present (including `-> None`). `*args` / `**kwargs` still require annotations on public callables. If `args` is not a clean `arguments` node → silence.

**Violation:** on the def name; suggestion: add parameter/return annotations.

### `python/no-bare-except`

Flag `except:` (type missing) and `except BaseException` / `except BaseException as …`, including a tuple/list that contains a `Name` `BaseException`. Do **not** flag plain `except Exception`. Do not chase aliases (`E = BaseException`) or attributes (`builtins.BaseException`).

**Quiet:** `except Exception`; specific types; tuples without `BaseException`; skipped paths.

**Violation:** on the handler; message names bare vs `BaseException`; suggestion: catch a specific type (or `Exception` if that is intended) and re-raise `BaseException` subclasses that must not be swallowed.

### `python/no-silent-except`

Flag `except` handlers whose **every** body statement is a no-op: `pass`, `continue`, ellipsis (`Constant.value === "Ellipsis"`), or a string constant. Does **not** inspect the exception type (stacks with bare-except). Any other statement (`return`, `raise`, a call, mixed `pass` + real stmt, …) → silence.

**Violation:** on the handler; suggestion: log and re-raise, narrow the type, or handle with a real branch / `return` / `raise`.

### `python/no-open-without-with`

Per scope (each `FunctionDef` / `AsyncFunctionDef` body, plus module body). Treat `open(...)` only when `func` is `Name` `open`. Flag an expression-statement `open(...)` or `Assign` / `AnnAssign` of `open(...)` to a `Name`.

**Quiet:** `with open(...) as f` / `async with`; immediate `return open(...)` (unwrap one `Await`); `open(...)` as an argument of another call; any other nesting; `pathlib.Path.open` / `io.open`. No cross-function escape analysis.

**Violation:** on the `Call`; suggestion: `with open(...) as …:` (or `pathlib.Path.open` in `with`).

### `python/no-sys-path-hack`

Flag import-fix mutations of `sys.path` / `sys.path_hooks`: `insert` / `append` / `extend` calls, `+=`, and assigns to the path object or a subscript (`sys.path[i] = …`). Binds: `import sys` / `import sys as s`, `from sys import path` / `path_hooks` (and aliases).

**Quiet:** reads; `sys.meta_path`; `site.addsitedir`; `PYTHONPATH`; `getattr`; unresolved / dynamic; skipped paths.

**Violation:** on the mutation node; suggestion: install editable / proper package layout; do not mutate `sys.path` at runtime.

### `python/no-public-any`

Same public callables as `python/require-typed-public` (presence vs quality). Flag explicit annotations that resolve to bare `Any` by name: `Any`, `typing.Any`, trivial same-file `X = Any` / `X = typing.Any` / `from typing import Any as X`.

**Quiet:** missing annotations; `list[Any]`, `Any | None`, `Optional[Any]`; non-trivial aliases; private / nested / dunder / overload / skipped paths / init-not-in-`__all__`.

**Violation:** on the def name; suggestion: replace `Any` with a real type, `object`, or a Protocol/TypedDict.

## Not planned in this plugin

- DRY / near-duplicate for Python
- Types / Protocol / TypedDict arm (bare `Any` on public callables is `python/no-public-any`; not a type checker)
- Python-authored plugins
- Cross-package / monorepo-wide multiplicity
- tree-sitter / libCST
- Ruff clone (import-lint / cycle / path-ban)
- Framework decorator allowlists, `setup.py` as package root, `.pyi` in default include
