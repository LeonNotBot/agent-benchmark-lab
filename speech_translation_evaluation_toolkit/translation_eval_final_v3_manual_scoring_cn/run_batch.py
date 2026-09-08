#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""按 manifest 批量运行多段翻译评测。"""

from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from pathlib import Path


def resolve_path(value: str, base: Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (base / path).resolve()


def main() -> int:
    parser = argparse.ArgumentParser(description="批量运行三段或更多段翻译评测。")
    parser.add_argument("--manifest", required=True, type=Path, help="CSV：vendor,reference[,name]")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--alignment-mode", default="auto", choices=["auto", "chinese", "english", "row"])
    parser.add_argument("--max-group", type=int, default=0)
    parser.add_argument("--vendor-zh-chars-per-chunk", type=int, default=40)
    parser.add_argument("--vendor-en-words-per-chunk", type=int, default=18)
    parser.add_argument("--max-subchunks", type=int, default=8)
    parser.add_argument("--sentence-model", default="sentence-transformers/all-mpnet-base-v2")
    parser.add_argument("--bert-model", default="microsoft/deberta-xlarge-mnli")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    args = parser.parse_args()

    manifest = args.manifest.resolve()
    if not manifest.exists():
        raise FileNotFoundError(manifest)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    with manifest.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError("manifest 为空。")
    required = {"vendor", "reference"}
    if not required.issubset(rows[0]):
        raise ValueError("manifest 必须包含 vendor 和 reference 两列。")

    script = Path(__file__).with_name("run_eval.py")
    failures = []
    for number, row in enumerate(rows, start=1):
        vendor = resolve_path(row["vendor"], manifest.parent)
        reference = resolve_path(row["reference"], manifest.parent)
        name = (row.get("name") or vendor.name.replace(".wav.txt", "")).strip()
        segment_output = args.output_dir / name
        segment_output.mkdir(parents=True, exist_ok=True)

        command = [
            sys.executable, str(script),
            "--vendor", str(vendor),
            "--reference", str(reference),
            "--output-dir", str(segment_output),
            "--alignment-mode", args.alignment_mode,
            "--max-group", str(args.max_group),
            "--vendor-zh-chars-per-chunk", str(args.vendor_zh_chars_per_chunk),
            "--vendor-en-words-per-chunk", str(args.vendor_en_words_per_chunk),
            "--max-subchunks", str(args.max_subchunks),
            "--sentence-model", args.sentence_model,
            "--bert-model", args.bert_model,
            "--batch-size", str(args.batch_size),
            "--device", args.device,
        ]
        print(f"\n[BATCH {number}/{len(rows)}] {name}")
        completed = subprocess.run(command)
        if completed.returncode != 0:
            failures.append(name)

    if failures:
        print("\n[ERROR] 以下任务失败：" + ", ".join(failures), file=sys.stderr)
        return 1
    print(f"\n[OK] 全部 {len(rows)} 段运行完成：{args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
