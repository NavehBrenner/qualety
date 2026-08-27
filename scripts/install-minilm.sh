#!/usr/bin/env bash
# Download Xenova all-MiniLM-L6-v2 (quantized ONNX) into .tools/minilm-l6.
# Default `qualety check` never runs this script (no surprise network).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${QUALETY_EMBEDDINGS_MODEL:-$ROOT/.tools/minilm-l6}"
BASE="https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main"

err() {
  echo "error: $1" >&2
  exit 1
}

if [[ -f "$DEST/onnx/model_quantized.onnx" && -f "$DEST/tokenizer.json" && -f "$DEST/config.json" ]]; then
  echo "MiniLM weights already present at $DEST"
  exit 0
fi

fetch() {
  local url="$1"
  local out="$2"
  mkdir -p "$(dirname "$out")"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$out"
  else
    err "need curl or wget to download"
  fi
}

echo "Downloading Xenova/all-MiniLM-L6-v2 (quantized ONNX) to $DEST..."
fetch "$BASE/config.json" "$DEST/config.json"
fetch "$BASE/tokenizer.json" "$DEST/tokenizer.json"
fetch "$BASE/tokenizer_config.json" "$DEST/tokenizer_config.json"
fetch "$BASE/special_tokens_map.json" "$DEST/special_tokens_map.json"
fetch "$BASE/onnx/model_quantized.onnx" "$DEST/onnx/model_quantized.onnx"

echo "Installed MiniLM weights to $DEST"
echo "Use them with:"
echo "  export QUALETY_EMBEDDINGS_MODEL=\"$DEST\""
