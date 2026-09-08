#!/usr/bin/env bash
set -euo pipefail

VENDOR="${1:-S_R003S01C01_15min.wav.txt}"
REFERENCE="${2:-S_R003S01C01_15min_eval_units_merged_reference.ods}"
OUTPUT_DIR="${3:-output}"

python3 run_eval.py \
  --vendor "$VENDOR" \
  --reference "$REFERENCE" \
  --output-dir "$OUTPUT_DIR" \
  --alignment-mode auto \
  --max-group 0
