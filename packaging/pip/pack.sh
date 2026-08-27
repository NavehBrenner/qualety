#!/usr/bin/env bash
# Build a platform wheel that ships the sibling standalone binary. Tag-CI only.
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <version> <binary> <platform-tag> <outdir>" >&2
  exit 1
fi

version=$1
binary=$2
plat=$3
outdir=$4

if [[ ! -f "$binary" ]]; then
  echo "error: binary not found: $binary" >&2
  exit 1
fi
if ! python3 -c "import build, wheel" 2>/dev/null; then
  echo "error: python packages build and wheel are required" >&2
  exit 1
fi

src_root="$(cd "$(dirname "$0")" && pwd)"
binary="$(cd "$(dirname "$binary")" && pwd)/$(basename "$binary")"
mkdir -p "$outdir"
outdir="$(cd "$outdir" && pwd)"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -a "$src_root/pyproject.toml" "$src_root/src" "$work/"
python3 - "$work/pyproject.toml" "$version" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = 'version = "0.0.0"'
if old not in text:
    raise SystemExit("0.0.0 version pin not found")
path.write_text(text.replace(old, f'version = "{sys.argv[2]}"', 1))
PY
if [[ "$binary" == *.exe ]]; then
  dest="$work/src/qualety/qualety.exe"
else
  dest="$work/src/qualety/qualety"
fi
cp "$binary" "$dest"
chmod +x "$dest"

python3 -m build --wheel --outdir "$work/dist" "$work"
shopt -s nullglob
wheels=("$work/dist"/*.whl)
if [[ ${#wheels[@]} -ne 1 ]]; then
  echo "expected one wheel, got ${#wheels[@]}" >&2
  exit 1
fi
python3 -m wheel tags --python-tag py3 --abi-tag none --platform-tag "$plat" --remove "${wheels[0]}"
mv "$work/dist"/*.whl "$outdir/"
