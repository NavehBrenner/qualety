# Contributing as an agent

> **Status: draft — pending review.**  
> Process guidance only. May change during the project lifecycle. Not a code style guide.

## Principles

1. **Essence over ceremony** — agent instructions stay about *what* we build and *how* we slice work. Structural code quality is the product’s job.
2. **SPECS first** — Locked decisions in [SPECS.md](./SPECS.md) beat informal chat or outdated drafts.
3. **Small PRs** — one rule, one engine capability, or one documentation theme per PR.
4. **Fixtures required** — every rule ships with valid and invalid examples and assertions on violation ids/messages.

## Suggested loop

```text
read SPECS locked decisions
  → implement against plugin/CLI contract
  → add fixtures + tests
  → run check (when available) on repo / examples
  → open PR with detailed squash-commit body (SPECS refs in Why)
```

## Issues

When filing an issue (human or agent):

- State the problem or gap in product terms (rule, engine, docs).
- Link SPECS/VISION/ruleset sections if relevant.
- Avoid turning issues into full designs unless requested; prefer a crisp problem statement.

*(Dedicated `file-issue` skill may be added later.)*

## Pull requests

- Title: imperative, specific (`feat(typescript): add public-exports-tested rule`).
- Do not invent import-lint / cycle / path-ban rules or re-scaffold the engine. Add rules to an existing plugin (or create a new plugin) per SPECS locked #7.
- Do not mix unrelated refactors with rule additions.
- Update SPECS or ruleset docs when behavior or public contract changes.

The PR **body is** the squash commit body (GitHub squash uses title + body). Thin one-liners or a one-paragraph “rationale” are **not** enough. Write for a human reading the squash commit months later — enough context without opening the diff. Do **not** put OpenCode trigger tokens in the PR body. Same checklist as [AGENTS.md](../AGENTS.md#working-through-github-oc):

- First line (or a GitHub closing trailer): load-bearing `Closes #<issue>`. CI reads it to attach the PR to Linear and to request review. Nothing else about Linear or reviewers is your job.
- Body **must** explain in long form (not a single sentence):
  - **What** changed (product surface, packages, rules, engine, CI, docs)
  - **Why** (issue goal, SPECS locks honoured, problem being solved)
  - **How** (approach in plain language: key mechanisms, not a file dump only)
  - **Files / areas** touched (grouped; call out load-bearing paths)
  - **Tests / fixtures** added or updated
  - **How to verify** (exact commands)
  - **Out of scope / deliberately not done**
  - **Follow-ups** only if real (no fake roadmap)

*(Dedicated `open-pr` skill may be added later.)*

## What not to put in agent docs

- Exhaustive ESLint/Biome rule lists
- Formatting preferences
- Framework tutorials unrelated to this repo’s engine

Those belong in product rulesets or external tools, not in contribution prose.
