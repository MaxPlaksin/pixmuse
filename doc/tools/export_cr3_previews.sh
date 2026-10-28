#!/usr/bin/env bash
# JPEG-превью из CR3 (встроенный thumb через sips) для быстрого просмотра
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/previews"
mkdir -p "$OUT"
for f in "$ROOT"/TSV_*.cr3; do
  [ -f "$f" ] || continue
  base=$(basename "$f" .cr3)
  sips -s format jpeg "$f" --out "$OUT/${base}.jpg" >/dev/null
  echo "$OUT/${base}.jpg"
done
