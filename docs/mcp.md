# MCP server (draft)

> **Status: draft — pending review.**  
> Planned product surface for agents. Not implemented yet. Shape may change with the CLI.

## Goal

Expose the same engine as the CLI so coding agents can check code, list rules, and read rule docs without scraping terminal output.

## Minimal tool set

| Tool | Role |
|------|------|
| `check` | Run invariants on paths or the workspace; return structured violations |
| `check_diff` | Run on changed files only (CI/agent default) |
| `list_rules` | List enabled/available rules and severities from config |
| `get_rule_docs` | Return description + examples for one rule id |

Structural and semantic duplicates flow through `check` (`dry/no-duplicate-code`, `dry/no-semantic-duplicate`). Optional later: `query_similar`, `index` (rebuild a product vector index — not the check-time `code-embeddings` artifact).

## Design notes

- Thin wrapper over the CLI/engine — no second rule runtime.
- Structured JSON results preferred over prose.
- No generative LLM calls inside these tools.

## Non-goals

- Replacing GitHub or editor MCPs
- Owning formatter/linter MCP surfaces
