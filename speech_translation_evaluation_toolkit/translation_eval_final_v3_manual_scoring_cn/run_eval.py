#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
供应商英文翻译 vs 英文标答：连续覆盖式语义评测脚本（V3）

核心原则：
1. 同时读取供应商 [recognized][n] 中文和 [translated][n] 英文。
2. 默认使用“参考中文 vs 供应商识别中文”确定评测单元边界，不用英文译文挑选片段。
3. 先对全部参考单元（包括 metric_include=no）进行顺序对齐，再只对可评分单元计算指标。
4. 供应商片段必须连续、无重叠、无跳过地覆盖到参考单元，避免把翻错的片段排除在评分外。
5. 每个单元的合并长度采用数据自适应上限，不再固定为 5 段。

输出会额外包含：供应商中文、对齐方法、中文对齐分、对齐风险提示和覆盖诊断。
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import List, Tuple

import numpy as np
import pandas as pd
import torch
import matplotlib.pyplot as plt
from bert_score import score as bertscore
from sentence_transformers import SentenceTransformer


TAG_RE = re.compile(
    r"^\[(recognized|translated)\]\[(\d+)\]\s*(.*?)(?=^\[(?:recognized|translated|finished)\]|\Z)",
    re.MULTILINE | re.DOTALL,
)


def normalize_text(text: object) -> str:
    """清理空白，不改变原句语义。"""
    if text is None or (isinstance(text, float) and math.isnan(text)):
        return ""
    text = str(text).replace("\ufeff", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def read_vendor_segments(txt_path: Path) -> pd.DataFrame:
    """按索引配对 recognized/translated；即使英文为空也保留该供应商片段。"""
    content = txt_path.read_text(encoding="utf-8", errors="replace")
    by_index: dict[int, dict[str, object]] = {}
    for match in TAG_RE.finditer(content):
        tag = match.group(1)
        idx = int(match.group(2))
        text = normalize_text(match.group(3))
        row = by_index.setdefault(
            idx,
            {"vendor_index": idx, "vendor_recognized_zh": "", "vendor_text": ""},
        )
        if tag == "recognized":
            row["vendor_recognized_zh"] = text
        else:
            row["vendor_text"] = text

    if not by_index:
        raise ValueError(
            f"未在 {txt_path} 中找到 [recognized][n] 或 [translated][n] 内容。"
        )

    df = pd.DataFrame([by_index[i] for i in sorted(by_index)])
    return df.reset_index(drop=True)


def _split_text_into_chunks(text: str, count: int, language: str) -> List[str]:
    """按标点附近切成指定数量的连续块；不改写文本内容。"""
    text = normalize_text(text)
    if count <= 1 or not text:
        return [text] + [""] * max(0, count - 1)

    if language == "zh":
        boundary_chars = set("，。！？；、,:,.!?;")
        candidates = [i + 1 for i, ch in enumerate(text) if ch in boundary_chars]
    else:
        boundary_chars = set(",.;:!?")
        candidates = [i + 1 for i, ch in enumerate(text) if ch in boundary_chars]
        candidates += [i + 1 for i, ch in enumerate(text) if ch.isspace()]
    candidates = sorted(set(x for x in candidates if 0 < x < len(text)))

    cuts = [0]
    previous = 0
    for part_no in range(1, count):
        target = round(len(text) * part_no / count)
        min_pos = previous + 1
        max_pos = len(text) - (count - part_no)
        valid = [x for x in candidates if min_pos <= x <= max_pos]
        cut = min(valid, key=lambda x: abs(x - target)) if valid else max(min_pos, min(target, max_pos))
        cuts.append(cut)
        previous = cut
    cuts.append(len(text))
    chunks = [normalize_text(text[cuts[i]:cuts[i + 1]]) for i in range(count)]
    return chunks


def explode_vendor_segments(
    raw_df: pd.DataFrame,
    zh_chars_per_chunk: int = 40,
    en_words_per_chunk: int = 18,
    max_chunks_per_segment: int = 8,
) -> pd.DataFrame:
    """
    将异常长的单个供应商索引拆成有序微片段，解决一个供应商段跨多个参考 Unit 的情况。
    短片段保持原样；每个微片段仍保留原始 vendor_index。
    """
    rows = []
    for _, row in raw_df.iterrows():
        zh = normalize_text(row.get("vendor_recognized_zh", ""))
        en = normalize_text(row.get("vendor_text", ""))
        zh_len = len(re.sub(r'[^\u4e00-\u9fffA-Za-z0-9]', '', unicodedata.normalize('NFKC', zh)))
        en_words = len(re.findall(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?", en))
        chunks = max(
            1,
            math.ceil(zh_len / max(zh_chars_per_chunk, 1)) if zh_len else 1,
            math.ceil(en_words / max(en_words_per_chunk, 1)) if en_words else 1,
        )
        chunks = min(max_chunks_per_segment, chunks)
        zh_parts = _split_text_into_chunks(zh, chunks, "zh")
        en_parts = _split_text_into_chunks(en, chunks, "en")
        for sub_idx in range(chunks):
            rows.append({
                "vendor_index": int(row["vendor_index"]),
                "vendor_sub_index": sub_idx + 1,
                "vendor_sub_count": chunks,
                "vendor_micro_id": (
                    str(int(row["vendor_index"]))
                    if chunks == 1
                    else f"{int(row['vendor_index'])}.{sub_idx + 1}"
                ),
                "vendor_recognized_zh": zh_parts[sub_idx],
                "vendor_text": en_parts[sub_idx],
            })
    return pd.DataFrame(rows).reset_index(drop=True)


def _read_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path, encoding="utf-8-sig")
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    if suffix == ".ods":
        return pd.read_excel(path, engine="odf")
    raise ValueError(f"不支持的标答格式：{suffix}；支持 CSV/XLSX/ODS。")


def read_reference(path: Path) -> Tuple[pd.DataFrame, str, str | None]:
    """读取全部参考单元；metric_include=no 只是不评分，仍参与边界对齐。"""
    df = _read_table(path)

    if "en_ref_sentence" in df.columns:
        ref_col = "en_ref_sentence"
    elif "en_ref_final_balanced" in df.columns:
        ref_col = "en_ref_final_balanced"
    else:
        candidates = [c for c in df.columns if "en_ref" in c.lower()]
        raise ValueError(
            "未找到英文标答列。期望 en_ref_sentence 或 en_ref_final_balanced；"
            f"当前可能相关列：{candidates}"
        )

    zh_col = None
    for candidate in ["zh_ref_group", "zh_ref_clean", "zh_ref"]:
        if candidate in df.columns:
            zh_col = candidate
            break

    if "metric_include" in df.columns:
        include = (
            df["metric_include"].astype(str).str.strip().str.lower()
            .isin({"yes", "y", "true", "1", "是"})
        )
    else:
        include = pd.Series(True, index=df.index)

    df = df.copy()
    df[ref_col] = df[ref_col].map(normalize_text)
    if zh_col:
        df[zh_col] = df[zh_col].map(normalize_text)
    df["metric_include_bool"] = include.astype(bool)

    keep = df[ref_col].ne("")
    if zh_col:
        keep = keep | df[zh_col].ne("")
    df = df.loc[keep].reset_index(drop=True)

    if df.empty:
        raise ValueError("标答中没有可用于对齐或评分的内容。")

    if "eval_unit_id" not in df.columns:
        df["eval_unit_id"] = [f"R{i+1:04d}" for i in range(len(df))]

    return df, ref_col, zh_col


def encode_texts(
    model: SentenceTransformer,
    texts: List[str],
    batch_size: int,
) -> np.ndarray:
    return model.encode(
        texts,
        batch_size=batch_size,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=True,
    )


_FILLERS_RE = re.compile(
    r"就是说|然后|这个|那个|的话|是吧|啊|呀|呃|嗯|哦|其实|主要|包括|还有|咱们|我们"
)


def normalize_zh_for_alignment(text: object, remove_fillers: bool = False) -> str:
    text = unicodedata.normalize("NFKC", normalize_text(text)).lower()
    text = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", text)
    if remove_fillers:
        text = _FILLERS_RE.sub("", text)
    return text


def _stable_bitset(text: str, n: int, buckets: int) -> int:
    """把字符 n-gram 映射为紧凑 bitset，用于快速近似 Dice 相似度。"""
    import zlib
    if not text:
        return 0
    grams = [text] if len(text) < n else (text[i:i+n] for i in range(len(text)-n+1))
    bits = 0
    for gram in grams:
        slot = zlib.crc32(gram.encode("utf-8")) % buckets
        bits |= 1 << slot
    return bits


def _bit_dice(a: int, b: int) -> float:
    if a == 0 and b == 0:
        return 1.0
    if a == 0 or b == 0:
        return 0.0
    return 2.0 * (a & b).bit_count() / (a.bit_count() + b.bit_count())


def _zh_features(text: object) -> tuple[int, int, int, int, int, int, int]:
    raw = normalize_zh_for_alignment(text, remove_fillers=False)
    core = normalize_zh_for_alignment(text, remove_fillers=True) or raw
    head = core[:14]
    tail = core[-14:]
    return (
        _stable_bitset(core, 1, 1024),
        _stable_bitset(core, 2, 4096),
        len(core),
        _stable_bitset(head, 2, 512),
        _stable_bitset(tail, 2, 512),
        len(head),
        len(tail),
    )


def _feature_similarity(
    reference: tuple[int, int, int, int, int, int, int],
    candidate: tuple[int, int, int, int, int, int, int],
) -> float:
    r_uni, r_bi, r_len, r_head, r_tail, _, _ = reference
    c_uni, c_bi, c_len, c_head, c_tail, _, _ = candidate
    if r_len == 0 or c_len == 0:
        return 0.0
    uni = _bit_dice(r_uni, c_uni)
    bi = _bit_dice(r_bi, c_bi)
    head = _bit_dice(r_head, c_head)
    tail = _bit_dice(r_tail, c_tail)
    ratio = (c_len + 1) / (r_len + 1)
    length_score = math.exp(-abs(math.log(ratio)))
    return 0.24 * uni + 0.52 * bi + 0.14 * length_score + 0.05 * head + 0.05 * tail


def chinese_alignment_similarity(reference_zh: str, candidate_zh: str) -> float:
    """面向 ASR 错字的快速中文字符级相似度，不依赖供应商英文质量。"""
    return _feature_similarity(_zh_features(reference_zh), _zh_features(candidate_zh))


def resolve_max_group(n_vendor: int, n_ref: int, requested: int) -> int:
    """0 表示数据自适应；不再使用固定 5 段窗口。"""
    if requested > 0:
        if requested * max(n_ref, 1) < n_vendor:
            raise ValueError(
                f"--max-group={requested} 太小，无法覆盖 {n_vendor} 个供应商片段/"
                f"{n_ref} 个参考单元。请使用 0（自动）或更大值。"
            )
        return requested
    average = n_vendor / max(n_ref, 1)
    return min(n_vendor, max(16, int(math.ceil(average * 4.0)) + 4))


def _candidate_feature_table(
    parts: List[str],
    max_group: int,
) -> dict[Tuple[int, int], tuple[int, int, int, int, int, int, int]]:
    table: dict[Tuple[int, int], tuple[int, int, int, int, int, int, int]] = {}
    normalized = [normalize_text(x) for x in parts]
    n = len(parts)
    for start in range(n):
        joined: List[str] = []
        for end in range(start, min(n, start + max_group)):
            if normalized[end]:
                joined.append(normalized[end])
            table[(start, end + 1)] = _zh_features("".join(joined))
    return table


_FORWARD_TRANSITION_RE = re.compile(
    r"^(然后|然后就是说|然后的话|接下来|下面|再就是|另外|其次|最后|首先|第二|第三|"
    r"那么|那现在|好那|好然后|接着|就是说)$"
)


def _is_forward_transition_only(text: str) -> bool:
    normalized = normalize_zh_for_alignment(text, remove_fillers=False)
    return bool(_FORWARD_TRANSITION_RE.fullmatch(normalized))


def _joined_vendor_zh(vendor_zh: List[str], start: int, end: int) -> str:
    return "".join(normalize_text(x) for x in vendor_zh[start:end] if normalize_text(x))


def rebalance_transition_boundaries(
    alignments: List[Tuple[int, int]],
    ref_zh: List[str],
    vendor_zh: List[str],
    max_group: int,
) -> Tuple[List[Tuple[int, int]], List[float]]:
    """把位于前一单元末尾的纯过渡语移到下一语义单元。"""
    adjusted = [list(pair) for pair in alignments]
    for i in range(len(adjusted) - 1):
        start, end = adjusted[i]
        next_start, next_end = adjusted[i + 1]
        if next_start != end:
            continue
        while end > start and _is_forward_transition_only(vendor_zh[end - 1]):
            if next_end - (end - 1) > max_group:
                break
            old_left = _joined_vendor_zh(vendor_zh, start, end)
            old_right = _joined_vendor_zh(vendor_zh, next_start, next_end)
            new_left = _joined_vendor_zh(vendor_zh, start, end - 1)
            new_right = _joined_vendor_zh(vendor_zh, end - 1, next_end)
            old_total = chinese_alignment_similarity(ref_zh[i], old_left) + chinese_alignment_similarity(ref_zh[i + 1], old_right)
            new_total = chinese_alignment_similarity(ref_zh[i], new_left) + chinese_alignment_similarity(ref_zh[i + 1], new_right)
            # 纯过渡语本身信息量低，允许极小的相似度波动，优先按语篇方向归入下一单元。
            if new_total + 0.035 < old_total:
                break
            end -= 1
            next_start -= 1
            adjusted[i] = [start, end]
            adjusted[i + 1] = [next_start, next_end]

    final = [(int(a), int(b)) for a, b in adjusted]
    scores = [
        chinese_alignment_similarity(ref_zh[i], _joined_vendor_zh(vendor_zh, start, end))
        if end > start else -0.75
        for i, (start, end) in enumerate(final)
    ]
    return final, scores


def monotonic_full_coverage_chinese_align(
    ref_zh: List[str],
    vendor_zh: List[str],
    max_group: int,
    missing_ref_penalty: float = 0.75,
) -> Tuple[List[Tuple[int, int]], List[float]]:
    """
    将全部供应商片段顺序分配给全部参考单元：连续、无重叠、无跳过。
    参考单元允许空匹配（例如供应商确实漏译），但会受到明显惩罚。
    """
    m, n = len(ref_zh), len(vendor_zh)
    candidate_features = _candidate_feature_table(vendor_zh, max_group)
    ref_features = [_zh_features(x) for x in ref_zh]
    ref_lengths = np.array([max(features[2], 1) for features in ref_features], dtype=float)
    expected = n * ref_lengths / max(ref_lengths.sum(), 1.0)

    neg_inf = -1e18
    dp = np.full((m + 1, n + 1), neg_inf, dtype=np.float64)
    back = np.full((m + 1, n + 1), -1, dtype=np.int32)
    match_score = np.full((m + 1, n + 1), np.nan, dtype=np.float64)
    dp[0, 0] = 0.0

    for i in range(1, m + 1):
        min_j = 0
        max_j = min(n, i * max_group)
        remaining_refs = m - i
        for j in range(min_j, max_j + 1):
            k_min = max(0, j - (i - 1) * max_group)
            k_max = min(max_group, j)
            best = neg_inf
            best_k = -1
            best_sim = float("nan")
            for k in range(k_min, k_max + 1):
                prev_j = j - k
                prev = dp[i - 1, prev_j]
                if prev <= neg_inf / 2:
                    continue
                if n - j > remaining_refs * max_group:
                    continue
                if k == 0:
                    sim = -missing_ref_penalty
                    size_penalty = 0.0
                else:
                    sim = _feature_similarity(
                        ref_features[i - 1], candidate_features[(prev_j, j)]
                    )
                    exp_k = max(expected[i - 1], 1.0)
                    size_penalty = 0.035 * abs(k - exp_k) / exp_k
                value = prev + sim - size_penalty
                if value > best:
                    best = value
                    best_k = k
                    best_sim = sim
            if best_k >= 0:
                dp[i, j] = best
                back[i, j] = best_k
                match_score[i, j] = best_sim

    if back[m, n] < 0:
        raise RuntimeError(
            "连续覆盖对齐失败。请提高 --max-group，或检查参考单元与供应商文件是否属于同一段音频。"
        )

    alignments: List[Tuple[int, int]] = [(0, 0)] * m
    scores: List[float] = [float("nan")] * m
    i, j = m, n
    while i > 0:
        k = int(back[i, j])
        start = j - k
        alignments[i - 1] = (start, j)
        scores[i - 1] = float(match_score[i, j])
        j = start
        i -= 1
    if j != 0:
        raise RuntimeError("对齐回溯未覆盖供应商开头片段。")
    return rebalance_transition_boundaries(
        alignments, ref_zh, vendor_zh, max_group
    )


def monotonic_full_coverage_english_align(
    ref_texts: List[str],
    vendor_texts: List[str],
    model: SentenceTransformer,
    max_group: int,
    batch_size: int = 32,
    missing_ref_penalty: float = 0.75,
) -> Tuple[List[Tuple[int, int]], List[float]]:
    """无中文可用时的英文兜底；仍强制连续、无跳过、全覆盖。"""
    m, n = len(ref_texts), len(vendor_texts)
    group_texts: List[str] = []
    group_keys: List[Tuple[int, int]] = []
    for start in range(n):
        parts: List[str] = []
        for end in range(start, min(n, start + max_group)):
            if vendor_texts[end]:
                parts.append(vendor_texts[end])
            group_keys.append((start, end + 1))
            group_texts.append(" ".join(parts) or "[NO_TRANSLATION]")

    ref_emb = encode_texts(model, [x or "[EMPTY_REFERENCE]" for x in ref_texts], batch_size)
    group_emb = encode_texts(model, group_texts, batch_size)
    group_index = {key: idx for idx, key in enumerate(group_keys)}

    neg_inf = -1e18
    dp = np.full((m + 1, n + 1), neg_inf, dtype=np.float64)
    back = np.full((m + 1, n + 1), -1, dtype=np.int32)
    chosen = np.full((m + 1, n + 1), np.nan, dtype=np.float64)
    dp[0, 0] = 0.0
    average = n / max(m, 1)

    for i in range(1, m + 1):
        for j in range(0, min(n, i * max_group) + 1):
            remaining_refs = m - i
            k_min = max(0, j - (i - 1) * max_group)
            k_max = min(max_group, j)
            best, best_k, best_sim = neg_inf, -1, float("nan")
            for k in range(k_min, k_max + 1):
                prev_j = j - k
                if dp[i - 1, prev_j] <= neg_inf / 2:
                    continue
                if n - j > remaining_refs * max_group:
                    continue
                if k == 0:
                    sim = -missing_ref_penalty
                else:
                    sim = float(np.dot(ref_emb[i - 1], group_emb[group_index[(prev_j, j)]]))
                size_penalty = 0.02 * abs(k - average) / max(average, 1.0)
                value = dp[i - 1, prev_j] + sim - size_penalty
                if value > best:
                    best, best_k, best_sim = value, k, sim
            if best_k >= 0:
                dp[i, j], back[i, j], chosen[i, j] = best, best_k, best_sim

    if back[m, n] < 0:
        raise RuntimeError("英文连续覆盖对齐失败，请提高 --max-group。")

    alignments, scores = [(0, 0)] * m, [float("nan")] * m
    i, j = m, n
    while i > 0:
        k = int(back[i, j])
        alignments[i - 1] = (j - k, j)
        scores[i - 1] = float(chosen[i, j])
        j -= k
        i -= 1
    return alignments, scores


def validate_full_coverage(alignments: List[Tuple[int, int]], n_vendor: int) -> dict:
    expected_start = 0
    overlap_count = 0
    gap_count = 0
    for start, end in alignments:
        if start < expected_start:
            overlap_count += expected_start - start
        elif start > expected_start:
            gap_count += start - expected_start
        expected_start = end
    trailing = max(0, n_vendor - expected_start)
    gap_count += trailing
    return {
        "alignment_overlap_segments": int(overlap_count),
        "alignment_unassigned_segments": int(gap_count),
        "alignment_full_coverage": bool(overlap_count == 0 and gap_count == 0 and expected_start == n_vendor),
    }


def compute_metrics(
    references: List[str],
    candidates: List[str],
    sentence_model: SentenceTransformer,
    bert_model_type: str,
    batch_size: int,
    device: str,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    ref_emb = encode_texts(sentence_model, references, batch_size)
    cand_emb = encode_texts(sentence_model, candidates, batch_size)
    cosine = np.sum(ref_emb * cand_emb, axis=1)

    p, r, f1 = bertscore(
        cands=candidates,
        refs=references,
        model_type=bert_model_type,
        batch_size=batch_size,
        device=device,
        verbose=True,
        rescale_with_baseline=False,
    )

    return (
        cosine,
        p.cpu().numpy(),
        r.cpu().numpy(),
        f1.cpu().numpy(),
    )


def weighted_mean(values: pd.Series, weights: pd.Series) -> float:
    valid = values.notna() & weights.notna() & (weights > 0)
    if not valid.any():
        return float("nan")
    return float(np.average(values[valid], weights=weights[valid]))



NEGATION_WORDS = {
    "not", "no", "never", "none", "neither", "nor", "without",
    "cannot", "can't", "won't", "isn't", "aren't", "wasn't",
    "weren't", "doesn't", "don't", "didn't", "shouldn't",
    "wouldn't", "couldn't"
}

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for",
    "with", "at", "by", "from", "as", "is", "are", "was", "were", "be",
    "been", "being", "this", "that", "these", "those", "it", "its", "we",
    "you", "they", "he", "she", "i", "our", "your", "their", "his", "her",
    "so", "then", "also", "just", "very", "can", "could", "should", "would",
    "will", "may", "might", "do", "does", "did", "have", "has", "had"
}


def tokenize_words(text: str) -> List[str]:
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?", text.lower())


def extract_numbers(text: str) -> set[str]:
    return set(re.findall(r"\b\d+(?:\.\d+)?\b", text))


def extract_capitalized_terms(text: str) -> set[str]:
    terms = set(re.findall(r"\b[A-Z][A-Za-z0-9-]{2,}\b", text))
    return {t for t in terms if t.lower() not in STOPWORDS}


def negation_present(text: str) -> bool:
    return bool(set(tokenize_words(text)) & NEGATION_WORDS)


def repeated_phrase_ratio(text: str) -> float:
    words = tokenize_words(text)
    if len(words) < 6:
        return 0.0
    bigrams = list(zip(words, words[1:]))
    return 1.0 - len(set(bigrams)) / len(bigrams) if bigrams else 0.0


def classify_errors(row: pd.Series) -> Tuple[str, str]:
    ref = str(row["reference_en"])
    cand = str(row["vendor_en"])
    cosine = float(row["sentence_bert_cosine"])
    bf1 = float(row["bertscore_f1"])

    ref_words = tokenize_words(ref)
    cand_words = tokenize_words(cand)
    ref_len = max(len(ref_words), 1)
    cand_len = len(cand_words)
    length_ratio = cand_len / ref_len

    labels, reasons = [], []

    if not cand.strip():
        return "缺失译文", "供应商未返回英文译文"

    if length_ratio < 0.58:
        labels.append("信息遗漏")
        reasons.append(f"译文长度仅为标答的 {length_ratio:.2f} 倍")
    if length_ratio > 1.75:
        labels.append("冗余/扩写")
        reasons.append(f"译文长度为标答的 {length_ratio:.2f} 倍")

    missing_numbers = extract_numbers(ref) - extract_numbers(cand)
    if missing_numbers:
        labels.append("数字遗漏/错误风险")
        reasons.append("标答数字未完整保留：" + ", ".join(sorted(missing_numbers)))

    if negation_present(ref) != negation_present(cand):
        labels.append("否定极性风险")
        reasons.append("标答与译文的否定表达不一致")

    missing_entities = extract_capitalized_terms(ref) - extract_capitalized_terms(cand)
    if missing_entities:
        labels.append("实体/术语风险")
        reasons.append("疑似实体未保留：" + ", ".join(sorted(missing_entities)))

    repeat_ratio = repeated_phrase_ratio(cand)
    if repeat_ratio >= 0.28:
        labels.append("重复表达")
        reasons.append(f"重复短语比例较高：{repeat_ratio:.2f}")

    if cosine < 0.55 and bf1 < 0.62:
        labels.append("明显语义偏离")
        reasons.append("句级语义和词级语义分均较低")
    elif cosine < 0.65:
        labels.append("句级语义偏离")
        reasons.append("Sentence-BERT Cosine 较低")
    elif bf1 < 0.65:
        labels.append("局部语义/措辞偏差")
        reasons.append("BERTScore F1 较低")

    if not labels:
        labels.append("基本一致")
        reasons.append("未触发明显风险规则")

    return "；".join(labels), "；".join(reasons)


def build_error_summary(df: pd.DataFrame) -> pd.DataFrame:
    labels = []
    for value in df["error_types"].fillna(""):
        labels.extend([x.strip() for x in value.split("；") if x.strip()])
    if not labels:
        return pd.DataFrame(columns=["错误类型", "数量", "占比"])
    counts = pd.Series(labels).value_counts()
    return pd.DataFrame({
        "错误类型": counts.index,
        "数量": counts.values,
        "占比": counts.values / len(df),
    })


def save_excel_report(
    result: pd.DataFrame,
    summary: dict,
    error_summary: pd.DataFrame,
    out_path: Path,
) -> None:
    low = result.sort_values("semantic_average").head(20)
    high = result.sort_values("semantic_average", ascending=False).head(20)
    review_cols = [
        "eval_unit_id", "reference_zh", "vendor_recognized_zh",
        "reference_en", "vendor_en", "vendor_segment_indices",
        "vendor_micro_indices", "alignment_score", "alignment_warning",
        "sentence_bert_cosine", "bertscore_f1",
        "semantic_average", "error_types", "error_reasons"
    ]
    review_cols = [c for c in review_cols if c in result.columns]
    review = result.sort_values("semantic_average").head(30)[review_cols]

    with pd.ExcelWriter(out_path, engine="xlsxwriter") as writer:
        pd.DataFrame([{"指标": k, "结果": v} for k, v in summary.items()]).to_excel(
            writer, sheet_name="汇总", index=False
        )
        result.to_excel(writer, sheet_name="逐单元评测", index=False)
        error_summary.to_excel(writer, sheet_name="错误类型统计", index=False)
        review.to_excel(writer, sheet_name="重点复核案例", index=False)
        low.to_excel(writer, sheet_name="最低20条", index=False)
        high.to_excel(writer, sheet_name="最高20条", index=False)

        workbook = writer.book
        header = workbook.add_format({"bold": True, "bg_color": "#D9EAF7", "border": 1})
        wrap = workbook.add_format({"text_wrap": True, "valign": "top"})
        score_fmt = workbook.add_format({"num_format": "0.0000"})
        green = workbook.add_format({"bg_color": "#C6EFCE"})
        yellow = workbook.add_format({"bg_color": "#FFEB9C"})
        red = workbook.add_format({"bg_color": "#FFC7CE"})

        for name, frame in {
            "逐单元评测": result,
            "重点复核案例": review,
            "最低20条": low,
            "最高20条": high,
        }.items():
            ws = writer.sheets[name]
            ws.freeze_panes(1, 0)
            ws.autofilter(0, 0, len(frame), len(frame.columns) - 1)
            for c, col in enumerate(frame.columns):
                ws.write(0, c, col, header)
                width = 14
                fmt = None
                if col in {
                    "reference_zh", "vendor_recognized_zh", "reference_en", "vendor_en",
                    "alignment_warning", "error_types", "error_reasons", "notes"
                }:
                    width, fmt = 46, wrap
                elif col in {
                    "sentence_bert_cosine", "bertscore_precision",
                    "bertscore_recall", "bertscore_f1", "semantic_average"
                }:
                    width, fmt = 16, score_fmt
                ws.set_column(c, c, width, fmt)

            if "semantic_average" in frame.columns and len(frame):
                c = frame.columns.get_loc("semantic_average")
                ws.conditional_format(1, c, len(frame), c, {
                    "type": "cell", "criteria": ">=", "value": 0.90, "format": green
                })
                ws.conditional_format(1, c, len(frame), c, {
                    "type": "cell", "criteria": "between",
                    "minimum": 0.80, "maximum": 0.899999, "format": yellow
                })
                ws.conditional_format(1, c, len(frame), c, {
                    "type": "cell", "criteria": "<", "value": 0.80, "format": red
                })

        for name in ["汇总", "错误类型统计"]:
            ws = writer.sheets[name]
            ws.freeze_panes(1, 0)
            ws.set_column(0, 0, 34)
            ws.set_column(1, 2, 18)
            frame = pd.DataFrame() if name == "汇总" else error_summary
            cols = ["指标", "结果"] if name == "汇总" else list(frame.columns)
            for c, col in enumerate(cols):
                ws.write(0, c, col, header)


def save_charts(result: pd.DataFrame, out_dir: Path, stem: str) -> None:
    plot_dir = out_dir / "plots"
    plot_dir.mkdir(exist_ok=True)
    for col, title in [
        ("sentence_bert_cosine", "Sentence-BERT Cosine"),
        ("bertscore_f1", "BERTScore F1"),
        ("semantic_average", "Combined Semantic Score"),
    ]:
        plt.figure(figsize=(8, 5))
        plt.hist(result[col].dropna(), bins=20)
        plt.xlabel("Score")
        plt.ylabel("Count")
        plt.title(title)
        plt.tight_layout()
        plt.savefig(plot_dir / f"{stem}_{col}.png", dpi=160)
        plt.close()





def main() -> int:
    parser = argparse.ArgumentParser(
        description="使用连续覆盖式对齐后，计算 BERTScore 和 Sentence-BERT Cosine。"
    )
    parser.add_argument("--vendor", required=True, type=Path, help="供应商 TXT 输出")
    parser.add_argument("--reference", required=True, type=Path, help="标答 CSV/XLSX/ODS")
    parser.add_argument("--output-dir", required=True, type=Path, help="输出目录")
    parser.add_argument(
        "--alignment-mode", choices=["auto", "chinese", "english", "row"],
        default="auto",
        help="auto 优先中文对齐；row 仅适用于已经一一对应的数据。",
    )
    parser.add_argument(
        "--sentence-model", default="sentence-transformers/all-mpnet-base-v2",
        help="Sentence-BERT 模型",
    )
    parser.add_argument(
        "--bert-model", default="microsoft/deberta-xlarge-mnli",
        help="BERTScore 模型；显存不足可改 microsoft/deberta-base-mnli",
    )
    parser.add_argument(
        "--max-group", type=int, default=0,
        help="每个参考单元最多吸收的连续供应商片段数；0=根据整段数据自动计算。",
    )
    parser.add_argument(
        "--vendor-zh-chars-per-chunk", type=int, default=40,
        help="超长供应商段按中文字符数拆分微片段的目标长度。",
    )
    parser.add_argument(
        "--vendor-en-words-per-chunk", type=int, default=18,
        help="超长供应商段按英文词数拆分微片段的目标长度。",
    )
    parser.add_argument(
        "--max-subchunks", type=int, default=8,
        help="单个供应商索引最多拆成多少个微片段。",
    )
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    args = parser.parse_args()

    if not args.vendor.exists():
        raise FileNotFoundError(f"供应商文件不存在：{args.vendor}")
    if not args.reference.exists():
        raise FileNotFoundError(f"标答文件不存在：{args.reference}")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"

    print(f"[INFO] device={device}")
    print("[INFO] 读取供应商中英文片段……")
    vendor_raw_df = read_vendor_segments(args.vendor)
    vendor_df = explode_vendor_segments(
        vendor_raw_df,
        zh_chars_per_chunk=args.vendor_zh_chars_per_chunk,
        en_words_per_chunk=args.vendor_en_words_per_chunk,
        max_chunks_per_segment=args.max_subchunks,
    )
    print(f"[INFO] 供应商原始片段数：{len(vendor_raw_df)}")
    print(f"[INFO] 对齐微片段数：{len(vendor_df)}")

    print("[INFO] 读取全部参考单元（含 metric_include=no）……")
    ref_df, ref_col, zh_col = read_reference(args.reference)
    print(f"[INFO] 英文标答列：{ref_col}")
    print(f"[INFO] 中文对齐列：{zh_col or '无'}")
    print(f"[INFO] 对齐参考单元数：{len(ref_df)}")
    print(f"[INFO] 参与评分单元数：{int(ref_df['metric_include_bool'].sum())}")

    max_group = resolve_max_group(len(vendor_df), len(ref_df), args.max_group)
    print(f"[INFO] 自适应最大合并片段数：{max_group}")

    mode = args.alignment_mode
    if mode == "auto":
        mode = "chinese" if zh_col and vendor_df["vendor_recognized_zh"].str.strip().ne("").any() else "english"
    if mode == "chinese" and not zh_col:
        raise ValueError("选择了中文对齐，但标答中没有 zh_ref_group/zh_ref_clean/zh_ref 列。")
    if mode == "chinese" and not vendor_df["vendor_recognized_zh"].str.strip().ne("").any():
        raise ValueError("选择了中文对齐，但供应商文件中没有 [recognized][n] 中文。")

    sentence_model = None
    if mode == "chinese":
        print("[INFO] 使用中文语义边界进行连续全覆盖对齐……")
        alignments, alignment_scores = monotonic_full_coverage_chinese_align(
            ref_df[zh_col].tolist(),
            vendor_df["vendor_recognized_zh"].tolist(),
            max_group=max_group,
        )
    elif mode == "english":
        print("[WARN] 中文不可用，使用英文兜底对齐；仍强制连续、无跳过、全覆盖。")
        print(f"[INFO] 加载 Sentence-BERT：{args.sentence_model}")
        sentence_model = SentenceTransformer(args.sentence_model, device=device)
        alignments, alignment_scores = monotonic_full_coverage_english_align(
            ref_df[ref_col].tolist(),
            vendor_df["vendor_text"].tolist(),
            sentence_model,
            max_group=max_group,
            batch_size=args.batch_size,
        )
    else:
        if len(ref_df) != len(vendor_df):
            raise ValueError(
                f"row 模式要求行数一致：reference={len(ref_df)}, vendor={len(vendor_df)}"
            )
        alignments = [(i, i + 1) for i in range(len(ref_df))]
        alignment_scores = [1.0] * len(ref_df)

    coverage = validate_full_coverage(alignments, len(vendor_df))
    if not coverage["alignment_full_coverage"]:
        raise RuntimeError(f"对齐未实现全覆盖：{coverage}")

    candidates, vendor_zh_groups, vendor_ranges, vendor_micro_ranges = [], [], [], []
    group_counts, micro_counts, warnings = [], [], []
    for (start, end), score in zip(alignments, alignment_scores):
        section = vendor_df.iloc[start:end]
        candidates.append(" ".join(x for x in section["vendor_text"].tolist() if x).strip())
        vendor_zh_groups.append("".join(x for x in section["vendor_recognized_zh"].tolist() if x).strip())
        indices = []
        for value in section["vendor_index"].tolist():
            if not indices or indices[-1] != value:
                indices.append(int(value))
        micro_ids = section["vendor_micro_id"].astype(str).tolist()
        if not indices:
            vendor_ranges.append("")
        elif len(indices) == 1:
            vendor_ranges.append(str(indices[0]))
        elif all(b - a == 1 for a, b in zip(indices, indices[1:])):
            vendor_ranges.append(f"{indices[0]}-{indices[-1]}")
        else:
            vendor_ranges.append(",".join(map(str, indices)))
        if not micro_ids:
            vendor_micro_ranges.append("")
        elif len(micro_ids) == 1:
            vendor_micro_ranges.append(micro_ids[0])
        else:
            vendor_micro_ranges.append(f"{micro_ids[0]}-{micro_ids[-1]}")
        group_counts.append(len(indices))
        micro_counts.append(len(micro_ids))
        unit_warnings = []
        if len(indices) == 0:
            unit_warnings.append("供应商缺失对应片段")
        if not math.isnan(score) and score < 0.35:
            unit_warnings.append("中文边界相似度较低，建议人工复核")
        if len(indices) >= max_group:
            unit_warnings.append("达到最大合并片段数，请检查边界")
        if indices and any(b - a != 1 for a, b in zip(indices, indices[1:])):
            unit_warnings.append("供应商原始索引存在缺号")
        warnings.append("；".join(unit_warnings))

    result = ref_df.copy()
    result["reference_en"] = result[ref_col]
    if zh_col:
        result["reference_zh"] = result[zh_col]
    else:
        result["reference_zh"] = ""
    result["vendor_segment_indices"] = vendor_ranges
    result["vendor_micro_indices"] = vendor_micro_ranges
    result["vendor_segment_count"] = group_counts
    result["vendor_microsegment_count"] = micro_counts
    result["vendor_recognized_zh"] = vendor_zh_groups
    result["vendor_en"] = candidates
    result["alignment_method"] = mode
    result["alignment_score"] = alignment_scores
    result["alignment_warning"] = warnings

    score_mask = result["metric_include_bool"] & result["reference_en"].str.strip().ne("")
    scoring_refs = result.loc[score_mask, "reference_en"].tolist()
    scoring_cands = result.loc[score_mask, "vendor_en"].tolist()
    metric_candidates = [c if c else "[NO_TRANSLATION]" for c in scoring_cands]

    if sentence_model is None:
        print(f"[INFO] 加载 Sentence-BERT：{args.sentence_model}")
        sentence_model = SentenceTransformer(args.sentence_model, device=device)

    print("[INFO] 只对 metric_include=yes 的单元计算语义指标……")
    cosine, bp, br, bf1 = compute_metrics(
        scoring_refs, metric_candidates, sentence_model,
        args.bert_model, args.batch_size, device,
    )
    empty_mask = np.array([not bool(c.strip()) for c in scoring_cands])
    cosine[empty_mask] = bp[empty_mask] = br[empty_mask] = bf1[empty_mask] = 0.0

    for col in [
        "sentence_bert_cosine", "bertscore_precision", "bertscore_recall",
        "bertscore_f1", "semantic_average"
    ]:
        result[col] = np.nan
    result.loc[score_mask, "sentence_bert_cosine"] = cosine
    result.loc[score_mask, "bertscore_precision"] = bp
    result.loc[score_mask, "bertscore_recall"] = br
    result.loc[score_mask, "bertscore_f1"] = bf1
    result.loc[score_mask, "semantic_average"] = (cosine + bf1) / 2.0

    result["reference_char_count"] = result["reference_en"].str.len()
    result["vendor_char_count"] = result["vendor_en"].str.len()
    result["vendor_missing"] = result["vendor_en"].str.strip().eq("")
    result["reference_word_count"] = result["reference_en"].map(lambda x: len(tokenize_words(str(x))))
    result["vendor_word_count"] = result["vendor_en"].map(lambda x: len(tokenize_words(str(x))))
    result["length_ratio"] = (
        result["vendor_word_count"] / result["reference_word_count"].replace(0, np.nan)
    ).fillna(0.0)

    result["error_types"] = "不参与评分"
    result["error_reasons"] = "metric_include=no，仅用于保持连续对齐边界"
    if score_mask.any():
        diagnoses = result.loc[score_mask].apply(classify_errors, axis=1)
        result.loc[score_mask, "error_types"] = [x[0] for x in diagnoses]
        result.loc[score_mask, "error_reasons"] = [x[1] for x in diagnoses]
    error_summary = build_error_summary(result.loc[score_mask].copy())

    scored = result.loc[score_mask].copy()
    if "duration_sec" in scored.columns:
        weights = pd.to_numeric(scored["duration_sec"], errors="coerce")
    elif {"start_sec", "end_sec"}.issubset(scored.columns):
        weights = pd.to_numeric(scored["end_sec"], errors="coerce") - pd.to_numeric(scored["start_sec"], errors="coerce")
    else:
        weights = pd.Series(np.ones(len(scored)), index=scored.index)

    source_indices = vendor_raw_df["vendor_index"].tolist()
    source_index_gaps = sum(max(0, b - a - 1) for a, b in zip(source_indices, source_indices[1:]))
    summary = {
        "vendor_file": str(args.vendor),
        "reference_file": str(args.reference),
        "reference_column": ref_col,
        "reference_chinese_column": zh_col or "",
        "alignment_method": mode,
        "adaptive_max_group": int(max_group),
        "sentence_model": args.sentence_model,
        "bert_model": args.bert_model,
        "device": device,
        "alignment_units_all": int(len(result)),
        "scored_reference_units": int(score_mask.sum()),
        "excluded_reference_units_kept_for_alignment": int((~score_mask).sum()),
        "vendor_raw_segments": int(len(vendor_raw_df)),
        "vendor_microsegments": int(len(vendor_df)),
        "vendor_source_index_gaps": int(source_index_gaps),
        **coverage,
        "low_alignment_score_units": int((result["alignment_score"] < 0.35).fillna(False).sum()),
        "missing_vendor_units": int(result.loc[score_mask, "vendor_missing"].sum()),
        "sentence_bert_cosine_mean": float(scored["sentence_bert_cosine"].mean()),
        "bertscore_precision_mean": float(scored["bertscore_precision"].mean()),
        "bertscore_recall_mean": float(scored["bertscore_recall"].mean()),
        "bertscore_f1_mean": float(scored["bertscore_f1"].mean()),
        "semantic_average_mean": float(scored["semantic_average"].mean()),
        "duration_weighted_sentence_bert_cosine": weighted_mean(scored["sentence_bert_cosine"], weights),
        "duration_weighted_bertscore_f1": weighted_mean(scored["bertscore_f1"], weights),
        "duration_weighted_semantic_average": weighted_mean(scored["semantic_average"], weights),
        "most_common_error_type": str(error_summary.iloc[0]["错误类型"]) if not error_summary.empty else "",
        "most_common_error_count": int(error_summary.iloc[0]["数量"]) if not error_summary.empty else 0,
    }

    stem = args.vendor.name[:-8] if args.vendor.name.endswith(".wav.txt") else args.vendor.stem
    detail_path = args.output_dir / f"{stem}_semantic_metrics.csv"
    low_path = args.output_dir / f"{stem}_lowest_20.csv"
    summary_path = args.output_dir / f"{stem}_summary.json"
    alignment_path = args.output_dir / f"{stem}_alignment_preview.txt"
    diagnostics_path = args.output_dir / f"{stem}_alignment_diagnostics.csv"
    excel_path = args.output_dir / f"{stem}_evaluation.xlsx"
    error_summary_path = args.output_dir / f"{stem}_error_type_summary.csv"
    review_cases_path = args.output_dir / f"{stem}_review_cases_top30.csv"

    result.to_csv(detail_path, index=False, encoding="utf-8-sig")
    scored.sort_values("semantic_average").head(20).to_csv(low_path, index=False, encoding="utf-8-sig")
    error_summary.to_csv(error_summary_path, index=False, encoding="utf-8-sig")
    review_cols = [
        "eval_unit_id", "reference_zh", "vendor_recognized_zh", "reference_en", "vendor_en",
        "vendor_segment_indices", "alignment_score", "alignment_warning",
        "sentence_bert_cosine", "bertscore_f1", "semantic_average",
        "error_types", "error_reasons",
    ]
    scored.sort_values("semantic_average").head(30)[review_cols].to_csv(
        review_cases_path, index=False, encoding="utf-8-sig"
    )
    result[[
        "eval_unit_id", "metric_include_bool", "vendor_segment_indices", "vendor_micro_indices",
        "vendor_segment_count", "vendor_microsegment_count", "reference_zh", "vendor_recognized_zh",
        "alignment_method", "alignment_score", "alignment_warning"
    ]].to_csv(diagnostics_path, index=False, encoding="utf-8-sig")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    with alignment_path.open("w", encoding="utf-8") as f:
        for _, row in result.iterrows():
            f.write("=" * 80 + "\n")
            f.write(f"Unit: {row['eval_unit_id']}\n")
            f.write(f"Metric include: {row['metric_include_bool']}\n")
            f.write(f"Vendor indices: {row['vendor_segment_indices']}\n")
            f.write(f"Vendor micro indices: {row['vendor_micro_indices']}\n")
            f.write(f"Alignment: method={row['alignment_method']}, score={row['alignment_score']:.4f}\n")
            if row["alignment_warning"]:
                f.write(f"Alignment warning: {row['alignment_warning']}\n")
            f.write(f"Reference ZH: {row['reference_zh']}\n")
            f.write(f"Vendor ZH:    {row['vendor_recognized_zh']}\n")
            f.write(f"Reference EN: {row['reference_en']}\n")
            f.write(f"Vendor EN:    {row['vendor_en']}\n")
            if row["metric_include_bool"]:
                f.write(
                    "Scores: "
                    f"Cosine={row['sentence_bert_cosine']:.4f}, "
                    f"BERTScore_F1={row['bertscore_f1']:.4f}, "
                    f"Average={row['semantic_average']:.4f}\n"
                )
            else:
                f.write("Scores: excluded from metrics\n")

    save_excel_report(result, summary, error_summary, excel_path)
    save_charts(scored, args.output_dir, stem)

    print("\n========== 汇总 ==========")
    for key, value in summary.items():
        print(f"{key}: {value:.6f}" if isinstance(value, float) else f"{key}: {value}")
    print("\n[OK] 输出文件：")
    for path in [detail_path, low_path, summary_path, alignment_path, diagnostics_path, excel_path, error_summary_path, review_cases_path]:
        print(path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise
