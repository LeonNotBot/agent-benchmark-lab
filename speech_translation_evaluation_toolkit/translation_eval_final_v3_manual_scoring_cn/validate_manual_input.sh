#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

python3 score_aligned_units.py   --aligned-file "input/S_R004S02C01_15min_manual_alignment_scoring_input_corrected.csv"   --output-dir "output_manual/S_R004S02C01"   --validate-only
