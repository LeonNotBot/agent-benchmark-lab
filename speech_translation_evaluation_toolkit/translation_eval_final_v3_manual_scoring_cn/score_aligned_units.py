#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""对人工确认后的对齐表直接评分；不执行自动对齐，输出中文指标和三级质量统计。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sentence_transformers import SentenceTransformer

from run_eval import (
    normalize_text,
    compute_metrics,
    tokenize_words,
    classify_errors,
    build_error_summary,
)

优秀阈值 = 0.90
中等阈值 = 0.70

中文列名 = {
    "eval_unit_id": "评测单元",
    "metric_include_bool": "是否参与评分",
    "reference_zh": "标答中文",
    "vendor_recognized_zh": "供应商识别中文",
    "reference_en": "英文标答",
    "vendor_en": "供应商英文",
    "vendor_segment_indices": "供应商原始索引",
    "vendor_micro_indices": "供应商微片段",
    "alignment_method": "对齐方式",
    "alignment_score": "对齐置信度",
    "alignment_warning": "对齐备注",
    "human_status": "人工确认状态",
    "sentence_bert_cosine": "Sentence-BERT余弦相似度",
    "bertscore_precision": "BERTScore精确率",
    "bertscore_recall": "BERTScore召回率",
    "bertscore_f1": "BERTScore F1",
    "semantic_average": "综合语义分",
    "quality_grade": "质量等级",
    "reference_char_count": "标答字符数",
    "vendor_char_count": "供应商字符数",
    "vendor_missing": "供应商译文缺失",
    "reference_word_count": "标答词数",
    "vendor_word_count": "供应商词数",
    "length_ratio": "译文长度比",
    "error_types": "错误类型",
    "error_reasons": "错误原因",
}


def read_aligned_file(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        df = pd.read_csv(path, encoding="utf-8-sig")
    elif suffix in {".xlsx", ".xls"}:
        df = pd.read_excel(path)
    elif suffix == ".ods":
        df = pd.read_excel(path, engine="odf")
    else:
        raise ValueError(f"不支持的输入格式：{suffix}")

    required = {
        "eval_unit_id",
        "reference_zh",
        "vendor_zh_aligned",
        "reference_en",
        "vendor_en_aligned",
        "vendor_micro_spans",
        "vendor_original_indices",
        "metric_include",
    }
    missing = required - set(df.columns)
    if missing:
        raise ValueError("人工对齐表缺少列：" + ", ".join(sorted(missing)))

    for col in [
        "reference_zh",
        "vendor_zh_aligned",
        "reference_en",
        "vendor_en_aligned",
        "vendor_micro_spans",
        "vendor_original_indices",
        "human_status",
        "alignment_note",
    ]:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].map(normalize_text)

    df["metric_include_bool"] = (
        df["metric_include"]
        .astype(str)
        .str.strip()
        .str.lower()
        .isin({"yes", "y", "true", "1", "是"})
    )
    return df


def 计算质量等级(score: float | None, include: bool = True) -> str:
    if not include or score is None or pd.isna(score):
        return "不参与评分"
    if float(score) >= 优秀阈值:
        return "优秀"
    if float(score) >= 中等阈值:
        return "中等"
    return "不及格"


def 转换中文列(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.rename(columns={k: v for k, v in 中文列名.items() if k in frame.columns})


def 保存中文评测报告(
    result: pd.DataFrame,
    summary: dict,
    error_summary: pd.DataFrame,
    out_path: Path,
) -> None:
    scored = result[result["metric_include_bool"]].copy()
    low = scored.sort_values("semantic_average").head(20)
    high = scored.sort_values("semantic_average", ascending=False).head(20)
    failed = scored[scored["quality_grade"] == "不及格"].sort_values("semantic_average")
    medium = scored[scored["quality_grade"] == "中等"].sort_values(
        "semantic_average", ascending=False
    )
    excellent = scored[scored["quality_grade"] == "优秀"].sort_values(
        "semantic_average", ascending=False
    )

    review_cols = [
        "eval_unit_id",
        "quality_grade",
        "reference_zh",
        "vendor_recognized_zh",
        "reference_en",
        "vendor_en",
        "vendor_segment_indices",
        "sentence_bert_cosine",
        "bertscore_f1",
        "semantic_average",
        "error_types",
        "error_reasons",
    ]
    review_cols = [c for c in review_cols if c in scored.columns]
    review = scored.sort_values("semantic_average").head(30)[review_cols]

    summary_rows = [
        ["一、运行信息", ""],
        ["人工对齐文件", summary["人工对齐文件"]],
        ["对齐方式", summary["对齐方式"]],
        ["是否执行自动对齐", summary["是否执行自动对齐"]],
        ["Sentence-BERT模型", summary["Sentence-BERT模型"]],
        ["BERTScore模型", summary["BERTScore模型"]],
        ["计算设备", summary["计算设备"]],
        ["", ""],
        ["二、单元统计", ""],
        ["全部评测单元数", summary["全部评测单元数"]],
        ["实际评分单元数", summary["实际评分单元数"]],
        ["排除评分单元数", summary["排除评分单元数"]],
        ["排除评分单元", summary["排除评分单元"]],
        ["", ""],
        ["三、核心语义指标", ""],
        ["Sentence-BERT余弦相似度平均值", summary["Sentence-BERT余弦相似度平均值"]],
        ["BERTScore精确率平均值", summary["BERTScore精确率平均值"]],
        ["BERTScore召回率平均值", summary["BERTScore召回率平均值"]],
        ["BERTScore F1平均值", summary["BERTScore F1平均值"]],
        ["综合语义平均分", summary["综合语义平均分"]],
        ["", ""],
        ["四、质量等级标准", ""],
        ["优秀", "综合语义分 ≥ 0.90"],
        ["中等", "0.70 ≤ 综合语义分 < 0.90"],
        ["不及格", "综合语义分 < 0.70"],
        ["", ""],
        ["五、质量等级分布", ""],
        ["优秀单元数", summary["优秀单元数"]],
        ["优秀单元占比", summary["优秀单元占比"]],
        ["中等单元数", summary["中等单元数"]],
        ["中等单元占比", summary["中等单元占比"]],
        ["不及格单元数", summary["不及格单元数"]],
        ["不及格单元占比", summary["不及格单元占比"]],
        ["", ""],
        ["六、错误概览", ""],
        ["最常见错误类型", summary["最常见错误类型"]],
        ["最常见错误数量", summary["最常见错误数量"]],
    ]
    summary_df = pd.DataFrame(summary_rows, columns=["指标", "结果"])

    grade_df = pd.DataFrame(
        [
            ["优秀", summary["优秀单元数"], summary["优秀单元占比"]],
            ["中等", summary["中等单元数"], summary["中等单元占比"]],
            ["不及格", summary["不及格单元数"], summary["不及格单元占比"]],
        ],
        columns=["质量等级", "数量", "占比"],
    )

    display_frames = {
        "逐单元评测": 转换中文列(result),
        "错误类型统计": error_summary,
        "重点复核案例": 转换中文列(review),
        "不及格单元": 转换中文列(failed),
        "中等单元": 转换中文列(medium),
        "优秀单元": 转换中文列(excellent),
        "最低20条": 转换中文列(low),
        "最高20条": 转换中文列(high),
    }

    with pd.ExcelWriter(out_path, engine="xlsxwriter") as writer:
        summary_df.to_excel(writer, sheet_name="汇总", index=False, startrow=0, startcol=0)
        grade_df.to_excel(writer, sheet_name="汇总", index=False, startrow=1, startcol=3)

        for sheet_name, frame in display_frames.items():
            frame.to_excel(writer, sheet_name=sheet_name, index=False)

        workbook = writer.book
        header = workbook.add_format(
            {
                "bold": True,
                "bg_color": "#1F4E78",
                "font_color": "#FFFFFF",
                "border": 1,
                "align": "center",
                "valign": "vcenter",
            }
        )
        section = workbook.add_format(
            {
                "bold": True,
                "bg_color": "#D9EAF7",
                "font_color": "#1F1F1F",
                "border": 1,
            }
        )
        wrap = workbook.add_format({"text_wrap": True, "valign": "top"})
        score_fmt = workbook.add_format({"num_format": "0.0000"})
        percent_fmt = workbook.add_format({"num_format": "0.00%"})
        green = workbook.add_format({"bg_color": "#C6EFCE", "font_color": "#006100"})
        yellow = workbook.add_format({"bg_color": "#FFEB9C", "font_color": "#9C6500"})
        red = workbook.add_format({"bg_color": "#FFC7CE", "font_color": "#9C0006"})
        center = workbook.add_format({"align": "center", "valign": "vcenter"})

        # 汇总页
        summary_ws = writer.sheets["汇总"]
        summary_ws.freeze_panes(1, 0)
        summary_ws.set_column("A:A", 36)
        summary_ws.set_column("B:B", 55)
        summary_ws.set_column("D:D", 14)
        summary_ws.set_column("E:E", 12)
        summary_ws.set_column("F:F", 14)
        summary_ws.write(0, 0, "指标", header)
        summary_ws.write(0, 1, "结果", header)
        summary_ws.write(1, 3, "质量等级", header)
        summary_ws.write(1, 4, "数量", header)
        summary_ws.write(1, 5, "占比", header)

        for row_idx, (label, value) in enumerate(summary_rows, start=1):
            if label.startswith(("一、", "二、", "三、", "四、", "五、", "六、")):
                summary_ws.write(row_idx, 0, label, section)
                summary_ws.write(row_idx, 1, "", section)
            elif "占比" in label and isinstance(value, (int, float)):
                summary_ws.write_number(row_idx, 1, float(value), percent_fmt)
            elif isinstance(value, float):
                summary_ws.write_number(row_idx, 1, value, score_fmt)

        for row_idx in range(2, 5):
            summary_ws.write_number(
                row_idx,
                5,
                float(grade_df.iloc[row_idx - 2]["占比"]),
                percent_fmt,
            )

        chart = workbook.add_chart({"type": "column"})
        chart.add_series(
            {
                "name": "单元数量",
                "categories": "=汇总!$D$3:$D$5",
                "values": "=汇总!$E$3:$E$5",
                "data_labels": {"value": True},
                "points": [
                    {"fill": {"color": "#70AD47"}},
                    {"fill": {"color": "#FFD966"}},
                    {"fill": {"color": "#F4B183"}},
                ],
            }
        )
        chart.set_title({"name": "质量等级分布"})
        chart.set_y_axis({"name": "单元数量", "major_unit": 1})
        chart.set_legend({"none": True})
        chart.set_style(10)
        summary_ws.insert_chart("H2", chart, {"x_scale": 1.25, "y_scale": 1.15})

        # 明细类工作表
        for sheet_name, frame in display_frames.items():
            ws = writer.sheets[sheet_name]
            ws.freeze_panes(1, 1)
            if len(frame.columns):
                ws.autofilter(0, 0, len(frame), len(frame.columns) - 1)

            for col_idx, col in enumerate(frame.columns):
                ws.write(0, col_idx, col, header)
                width = 15
                fmt = None
                if col in {
                    "标答中文",
                    "供应商识别中文",
                    "英文标答",
                    "供应商英文",
                    "对齐备注",
                    "错误类型",
                    "错误原因",
                }:
                    width, fmt = 46, wrap
                elif col in {
                    "Sentence-BERT余弦相似度",
                    "BERTScore精确率",
                    "BERTScore召回率",
                    "BERTScore F1",
                    "综合语义分",
                    "译文长度比",
                }:
                    width, fmt = 19, score_fmt
                elif col in {"质量等级", "评测单元", "是否参与评分", "人工确认状态"}:
                    width, fmt = 15, center
                elif col in {"供应商原始索引", "供应商微片段"}:
                    width = 18
                ws.set_column(col_idx, col_idx, width, fmt)

            if "综合语义分" in frame.columns and len(frame):
                score_col = frame.columns.get_loc("综合语义分")
                ws.conditional_format(
                    1,
                    score_col,
                    len(frame),
                    score_col,
                    {
                        "type": "cell",
                        "criteria": ">=",
                        "value": 优秀阈值,
                        "format": green,
                    },
                )
                ws.conditional_format(
                    1,
                    score_col,
                    len(frame),
                    score_col,
                    {
                        "type": "cell",
                        "criteria": "between",
                        "minimum": 中等阈值,
                        "maximum": 优秀阈值 - 0.000001,
                        "format": yellow,
                    },
                )
                ws.conditional_format(
                    1,
                    score_col,
                    len(frame),
                    score_col,
                    {
                        "type": "cell",
                        "criteria": "<",
                        "value": 中等阈值,
                        "format": red,
                    },
                )

            if "质量等级" in frame.columns and len(frame):
                grade_col = frame.columns.get_loc("质量等级")
                ws.conditional_format(
                    1,
                    grade_col,
                    len(frame),
                    grade_col,
                    {
                        "type": "text",
                        "criteria": "containing",
                        "value": "优秀",
                        "format": green,
                    },
                )
                ws.conditional_format(
                    1,
                    grade_col,
                    len(frame),
                    grade_col,
                    {
                        "type": "text",
                        "criteria": "containing",
                        "value": "中等",
                        "format": yellow,
                    },
                )
                ws.conditional_format(
                    1,
                    grade_col,
                    len(frame),
                    grade_col,
                    {
                        "type": "text",
                        "criteria": "containing",
                        "value": "不及格",
                        "format": red,
                    },
                )

        err_ws = writer.sheets["错误类型统计"]
        err_ws.set_column(0, 0, 28)
        err_ws.set_column(1, 2, 14)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="直接对人工确认后的中英文对齐表计算 BERTScore 和 Sentence-BERT。"
    )
    parser.add_argument("--aligned-file", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--sentence-model",
        default="sentence-transformers/all-mpnet-base-v2",
    )
    parser.add_argument(
        "--bert-model",
        default="microsoft/deberta-xlarge-mnli",
    )
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="只检查输入结构与排除单元，不加载模型、不计算分数。",
    )
    args = parser.parse_args()

    if not args.aligned_file.exists():
        raise FileNotFoundError(args.aligned_file)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    df = read_aligned_file(args.aligned_file)
    score_mask = df["metric_include_bool"] & df["reference_en"].str.strip().ne("")

    if args.validate_only:
        print("========== 人工对齐输入检查 ==========")
        print(f"人工对齐文件: {args.aligned_file}")
        print(f"全部评测单元数: {len(df)}")
        print(f"实际评分单元数: {int(score_mask.sum())}")
        print(f"排除评分单元数: {int((~score_mask).sum())}")
        excluded = df.loc[~score_mask, "eval_unit_id"].tolist()
        print("排除评分单元: " + (", ".join(excluded) if excluded else "无"))
        print("等级标准: 优秀≥0.90；中等0.70至<0.90；不及格<0.70")
        print("[OK] 输入结构有效；评分阶段不会执行自动对齐。")
        return 0

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"

    result = pd.DataFrame(
        {
            "eval_unit_id": df["eval_unit_id"],
            "metric_include_bool": df["metric_include_bool"],
            "reference_zh": df["reference_zh"],
            "vendor_recognized_zh": df["vendor_zh_aligned"],
            "reference_en": df["reference_en"],
            "vendor_en": df["vendor_en_aligned"],
            "vendor_segment_indices": df["vendor_original_indices"],
            "vendor_micro_indices": df["vendor_micro_spans"],
            "alignment_method": "人工确认",
            "alignment_score": 1.0,
            "alignment_warning": df["alignment_note"],
            "human_status": df["human_status"],
        }
    )

    scoring_refs = result.loc[score_mask, "reference_en"].tolist()
    scoring_cands = result.loc[score_mask, "vendor_en"].tolist()
    metric_candidates = [x if x else "[NO_TRANSLATION]" for x in scoring_cands]

    print(f"[INFO] 计算设备：{device}")
    print("[INFO] 使用人工确认边界；不再执行自动对齐。")
    print(f"[INFO] 评分单元：{int(score_mask.sum())}/{len(result)}")
    print(f"[INFO] 加载 Sentence-BERT：{args.sentence_model}")

    sentence_model = SentenceTransformer(args.sentence_model, device=device)
    cosine, bp, br, bf1 = compute_metrics(
        scoring_refs,
        metric_candidates,
        sentence_model,
        args.bert_model,
        args.batch_size,
        device,
    )

    empty_mask = np.array([not bool(x.strip()) for x in scoring_cands])
    cosine[empty_mask] = 0.0
    bp[empty_mask] = 0.0
    br[empty_mask] = 0.0
    bf1[empty_mask] = 0.0

    for col in [
        "sentence_bert_cosine",
        "bertscore_precision",
        "bertscore_recall",
        "bertscore_f1",
        "semantic_average",
    ]:
        result[col] = np.nan

    result.loc[score_mask, "sentence_bert_cosine"] = cosine
    result.loc[score_mask, "bertscore_precision"] = bp
    result.loc[score_mask, "bertscore_recall"] = br
    result.loc[score_mask, "bertscore_f1"] = bf1
    result.loc[score_mask, "semantic_average"] = (cosine + bf1) / 2.0

    result["quality_grade"] = [
        计算质量等级(score, bool(include))
        for score, include in zip(
            result["semantic_average"],
            result["metric_include_bool"],
        )
    ]

    result["reference_char_count"] = result["reference_en"].str.len()
    result["vendor_char_count"] = result["vendor_en"].str.len()
    result["vendor_missing"] = result["vendor_en"].str.strip().eq("")
    result["reference_word_count"] = result["reference_en"].map(
        lambda x: len(tokenize_words(str(x)))
    )
    result["vendor_word_count"] = result["vendor_en"].map(
        lambda x: len(tokenize_words(str(x)))
    )
    result["length_ratio"] = (
        result["vendor_word_count"]
        / result["reference_word_count"].replace(0, np.nan)
    ).fillna(0.0)

    result["error_types"] = "不参与评分"
    result["error_reasons"] = "metric_include=no"
    if score_mask.any():
        diagnoses = result.loc[score_mask].apply(classify_errors, axis=1)
        result.loc[score_mask, "error_types"] = [x[0] for x in diagnoses]
        result.loc[score_mask, "error_reasons"] = [x[1] for x in diagnoses]

    scored = result.loc[score_mask].copy()
    error_summary = build_error_summary(scored)

    grade_counts = scored["quality_grade"].value_counts()
    total_scored = int(len(scored))
    excellent_count = int(grade_counts.get("优秀", 0))
    medium_count = int(grade_counts.get("中等", 0))
    fail_count = int(grade_counts.get("不及格", 0))

    summary = {
        "人工对齐文件": str(args.aligned_file),
        "对齐方式": "人工确认",
        "是否执行自动对齐": "否",
        "Sentence-BERT模型": args.sentence_model,
        "BERTScore模型": args.bert_model,
        "计算设备": device,
        "全部评测单元数": int(len(result)),
        "实际评分单元数": total_scored,
        "排除评分单元数": int((~score_mask).sum()),
        "排除评分单元": ",".join(
            result.loc[~score_mask, "eval_unit_id"].tolist()
        )
        or "无",
        "Sentence-BERT余弦相似度平均值": float(
            scored["sentence_bert_cosine"].mean()
        ),
        "BERTScore精确率平均值": float(scored["bertscore_precision"].mean()),
        "BERTScore召回率平均值": float(scored["bertscore_recall"].mean()),
        "BERTScore F1平均值": float(scored["bertscore_f1"].mean()),
        "综合语义平均分": float(scored["semantic_average"].mean()),
        "优秀单元数": excellent_count,
        "优秀单元占比": excellent_count / total_scored if total_scored else 0.0,
        "中等单元数": medium_count,
        "中等单元占比": medium_count / total_scored if total_scored else 0.0,
        "不及格单元数": fail_count,
        "不及格单元占比": fail_count / total_scored if total_scored else 0.0,
        "最常见错误类型": (
            str(error_summary.iloc[0]["错误类型"])
            if not error_summary.empty
            else ""
        ),
        "最常见错误数量": (
            int(error_summary.iloc[0]["数量"])
            if not error_summary.empty
            else 0
        ),
    }

    stem = args.aligned_file.stem.replace(
        "_manual_alignment_scoring_input_corrected", "_manual"
    )
    detail_path = args.output_dir / f"{stem}_semantic_metrics.csv"
    low_path = args.output_dir / f"{stem}_lowest_20.csv"
    summary_path = args.output_dir / f"{stem}_summary.json"
    preview_path = args.output_dir / f"{stem}_alignment_preview.txt"
    diagnostics_path = args.output_dir / f"{stem}_alignment_diagnostics.csv"
    excel_path = args.output_dir / f"{stem}_evaluation.xlsx"
    error_path = args.output_dir / f"{stem}_error_type_summary.csv"
    review_path = args.output_dir / f"{stem}_review_cases_top30.csv"

    # 所有主要导出列使用中文名称。
    转换中文列(result).to_csv(detail_path, index=False, encoding="utf-8-sig")
    转换中文列(scored.sort_values("semantic_average").head(20)).to_csv(
        low_path,
        index=False,
        encoding="utf-8-sig",
    )
    error_summary.to_csv(error_path, index=False, encoding="utf-8-sig")

    转换中文列(
        result[
            [
                "eval_unit_id",
                "metric_include_bool",
                "quality_grade",
                "vendor_segment_indices",
                "vendor_micro_indices",
                "reference_zh",
                "vendor_recognized_zh",
                "alignment_method",
                "alignment_warning",
                "human_status",
            ]
        ]
    ).to_csv(diagnostics_path, index=False, encoding="utf-8-sig")

    review_cols = [
        "eval_unit_id",
        "quality_grade",
        "reference_zh",
        "vendor_recognized_zh",
        "reference_en",
        "vendor_en",
        "vendor_segment_indices",
        "sentence_bert_cosine",
        "bertscore_f1",
        "semantic_average",
        "error_types",
        "error_reasons",
    ]
    转换中文列(
        scored.sort_values("semantic_average").head(30)[review_cols]
    ).to_csv(review_path, index=False, encoding="utf-8-sig")

    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with preview_path.open("w", encoding="utf-8") as f:
        for _, row in result.iterrows():
            f.write("=" * 100 + "\n")
            f.write(f"评测单元：{row['eval_unit_id']}\n")
            f.write(
                f"是否参与评分：{'是' if row['metric_include_bool'] else '否'}\n"
            )
            f.write(f"质量等级：{row['quality_grade']}\n")
            f.write(f"供应商原始索引：{row['vendor_segment_indices']}\n")
            f.write(f"供应商微片段：{row['vendor_micro_indices']}\n")
            f.write("对齐方式：人工确认，不执行自动重新对齐\n")
            f.write(f"标答中文：{row['reference_zh']}\n")
            f.write(f"供应商识别中文：{row['vendor_recognized_zh']}\n")
            f.write(f"英文标答：{row['reference_en']}\n")
            f.write(f"供应商英文：{row['vendor_en']}\n")
            if row["metric_include_bool"]:
                f.write(
                    "评分指标："
                    f"Sentence-BERT余弦相似度={row['sentence_bert_cosine']:.4f}，"
                    f"BERTScore F1={row['bertscore_f1']:.4f}，"
                    f"综合语义分={row['semantic_average']:.4f}\n"
                )
            else:
                f.write("评分指标：不参与评分\n")

    保存中文评测报告(result, summary, error_summary, excel_path)

    print("\n========== 中文汇总 ==========")
    print(f"人工对齐文件：{summary['人工对齐文件']}")
    print(f"对齐方式：{summary['对齐方式']}")
    print(f"是否执行自动对齐：{summary['是否执行自动对齐']}")
    print(f"计算设备：{summary['计算设备']}")
    print(f"全部评测单元数：{summary['全部评测单元数']}")
    print(f"实际评分单元数：{summary['实际评分单元数']}")
    print(f"排除评分单元数：{summary['排除评分单元数']}")
    print(
        "Sentence-BERT余弦相似度平均值："
        f"{summary['Sentence-BERT余弦相似度平均值']:.6f}"
    )
    print(
        f"BERTScore F1平均值：{summary['BERTScore F1平均值']:.6f}"
    )
    print(f"综合语义平均分：{summary['综合语义平均分']:.6f}")
    print("\n========== 质量等级分布 ==========")
    print(
        f"优秀（≥0.90）：{excellent_count} 个，"
        f"占比 {summary['优秀单元占比']:.2%}"
    )
    print(
        f"中等（0.70至<0.90）：{medium_count} 个，"
        f"占比 {summary['中等单元占比']:.2%}"
    )
    print(
        f"不及格（<0.70）：{fail_count} 个，"
        f"占比 {summary['不及格单元占比']:.2%}"
    )
    print(
        f"最常见错误类型：{summary['最常见错误类型']} "
        f"（{summary['最常见错误数量']} 个）"
    )

    print("\n[OK] 输出文件：")
    for path in [
        detail_path,
        low_path,
        summary_path,
        preview_path,
        diagnostics_path,
        excel_path,
        error_path,
        review_path,
    ]:
        print(path)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise
