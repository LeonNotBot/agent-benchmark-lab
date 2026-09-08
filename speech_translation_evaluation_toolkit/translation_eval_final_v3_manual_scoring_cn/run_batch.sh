#!/usr/bin/env bash
set -euo pipefail

MANIFEST="${1:-batch_manifest.csv}"
OUTPUT_DIR="${2:-output_batch}"

python3 run_batch.py \
  --manifest "$MANIFEST" \
  --output-dir "$OUTPUT_DIR" \
  --alignment-mode auto \
  --max-group 0
