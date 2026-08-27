#!/usr/bin/env bash
# Compile the standalone qualety binary. Requires bun; run pnpm build first.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <outfile>" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required on PATH" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/packages/qualety/node_modules/@qualety"
for pkg in typescript react dry python; do
  ln -sfn "$ROOT/packages/$pkg" "$ROOT/packages/qualety/node_modules/@qualety/$pkg"
done
args=(build --compile --define STANDALONE=true)
if [[ -n "${QUALETY_COMPILE_TARGET:-}" ]]; then
  args+=(--target "$QUALETY_COMPILE_TARGET")
fi
args+=("$ROOT/packages/qualety/src/cli.ts" --outfile "$1")
bun "${args[@]}"
