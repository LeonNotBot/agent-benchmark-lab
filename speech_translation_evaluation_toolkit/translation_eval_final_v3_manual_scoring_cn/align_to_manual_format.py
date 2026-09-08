#!/usr/bin/env python3
"""
精简版对齐脚本：复用 run_eval.py 的中文对齐算法，直接输出路径B格式
只需要 pandas 和 sentence-transformers，跳过 matplotlib/openpyxl
"""

import sys
from pathlib import Path
import pandas as pd
from typing import List, Tuple
import re

# ========== 从 run_eval.py 复制的核心对齐函数 ==========

def normalize_text(text: object) -> str:
    """标准化文本"""
    if pd.isna(text):
        return ""
    return str(text).strip()


def normalize_zh_for_alignment(text: object, remove_fillers: bool = False) -> str:
    """标准化中文用于对齐"""
    text = normalize_text(text)
    text = re.sub(r'\s+', '', text)  # 移除所有空白
    if remove_fillers:
        # 移除语气词
        text = re.sub(r'[啊呀哦呢吧嘛哈唉嗯]', '', text)
    return text


def _stable_bitset(text: str, n: int, buckets: int) -> int:
    """字符级 n-gram 位集特征"""
    bits = 0
    for i in range(len(text) - n + 1):
        gram = text[i:i+n]
        h = hash(gram) % buckets
        bits |= (1 << h)
    return bits


def _bit_dice(a: int, b: int) -> float:
    """位集 Dice 系数"""
    if a == 0 and b == 0:
        return 1.0
    inter = bin(a & b).count('1')
    return 2.0 * inter / (bin(a).count('1') + bin(b).count('1'))


def _zh_features(text: object) -> tuple:
    """提取中文特征"""
    norm = normalize_zh_for_alignment(text, remove_fillers=False)
    norm_no_filler = normalize_zh_for_alignment(text, remove_fillers=True)
    length = len(norm)
    length_no_filler = len(norm_no_filler)
    uni = _stable_bitset(norm, 1, 64)
    bi = _stable_bitset(norm, 2, 64)
    tri = _stable_bitset(norm, 3, 64)
    return (length, length_no_filler, norm, norm_no_filler, uni, bi, tri)


def _feature_similarity(ref_feat: tuple, cand_feat: tuple) -> float:
    """计算特征相似度"""
    r_len, r_len_nf, r_norm, r_norm_nf, r_uni, r_bi, r_tri = ref_feat
    c_len, c_len_nf, c_norm, c_norm_nf, c_uni, c_bi, c_tri = cand_feat

    if r_len == 0 and c_len == 0:
        return 1.0
    if r_len == 0 or c_len == 0:
        return 0.0

    uni_sim = _bit_dice(r_uni, c_uni)
    bi_sim = _bit_dice(r_bi, c_bi)
    tri_sim = _bit_dice(r_tri, c_tri)

    len_ratio = min(c_len_nf, r_len_nf) / max(c_len_nf, r_len_nf) if max(c_len_nf, r_len_nf) > 0 else 0.0

    return 0.3 * uni_sim + 0.3 * bi_sim + 0.2 * tri_sim + 0.2 * len_ratio


def chinese_alignment_similarity(reference_zh: str, candidate_zh: str) -> float:
    """中文对齐相似度"""
    return _feature_similarity(_zh_features(reference_zh), _zh_features(candidate_zh))


def resolve_max_group(n_vendor: int, n_ref: int, requested: int) -> int:
    """确定最大组大小"""
    if requested <= 0:
        requested = max(12, int(1.5 * n_vendor / n_ref))
    return min(requested, n_vendor)


def _candidate_feature_table(vendor_zh: List[str], max_group: int) -> List[List[tuple]]:
    """预计算候选特征表"""
    n = len(vendor_zh)
    table = []
    for start in range(n):
        row = []
        for length in range(1, min(max_group, n - start) + 1):
            joined = ''.join(vendor_zh[start:start+length])
            feat = _zh_features(joined)
            row.append(feat)
        table.append(row)
    return table


def _joined_vendor_zh(vendor_zh: List[str], start: int, end: int) -> str:
    """连接供应商中文片段"""
    return ''.join(vendor_zh[start:end])


def monotonic_full_coverage_chinese_align(
    reference_zh: List[str],
    vendor_zh: List[str],
    max_group_size: int = 0
) -> List[Tuple[int, int]]:
    """
    单调全覆盖中文对齐算法
    返回: [(vendor_start, vendor_end), ...] 每个元素对应一个参考单元
    """
    n_ref = len(reference_zh)
    n_vendor = len(vendor_zh)

    if n_vendor == 0:
        return [(0, 0)] * n_ref

    max_group = resolve_max_group(n_vendor, n_ref, max_group_size)
    feat_table = _candidate_feature_table(vendor_zh, max_group)
    ref_features = [_zh_features(r) for r in reference_zh]

    # DP: dp[i][j] = (最优相似度和, 回溯路径)
    # i: 参考单元索引, j: 供应商片段索引
    INF = float('-inf')
    dp = [[INF] * (n_vendor + 1) for _ in range(n_ref + 1)]
    parent = [[None] * (n_vendor + 1) for _ in range(n_ref + 1)]

    dp[0][0] = 0.0

    for i in range(n_ref):
        for j in range(n_vendor + 1):
            if dp[i][j] == INF:
                continue

            # 尝试将 vendor[j:k] 对齐到 ref[i]
            for length in range(1, min(max_group, n_vendor - j) + 1):
                k = j + length
                sim = _feature_similarity(ref_features[i], feat_table[j][length - 1])
                new_score = dp[i][j] + sim

                if new_score > dp[i + 1][k]:
                    dp[i + 1][k] = new_score
                    parent[i + 1][k] = (i, j, length)

    # 回溯路径
    if dp[n_ref][n_vendor] == INF:
        # 无法完全覆盖，使用贪心回退
        return _greedy_fallback_align(reference_zh, vendor_zh, ref_features, feat_table, max_group)

    alignments = []
    i, j = n_ref, n_vendor
    while i > 0:
        pi, pj, length = parent[i][j]
        alignments.append((pj, pj + length))
        i, j = pi, pj

    alignments.reverse()
    return alignments


def _greedy_fallback_align(
    reference_zh: List[str],
    vendor_zh: List[str],
    ref_features: List[tuple],
    feat_table: List[List[tuple]],
    max_group: int
) -> List[Tuple[int, int]]:
    """贪心回退对齐"""
    n_ref = len(reference_zh)
    n_vendor = len(vendor_zh)
    alignments = []
    j = 0

    for i in range(n_ref):
        if j >= n_vendor:
            alignments.append((n_vendor, n_vendor))  # 缺失
            continue

        # 找最佳匹配
        best_sim = -1.0
        best_len = 1
        for length in range(1, min(max_group, n_vendor - j) + 1):
            sim = _feature_similarity(ref_features[i], feat_table[j][length - 1])
            if sim > best_sim:
                best_sim = sim
                best_len = length

        alignments.append((j, j + best_len))
        j += best_len

    return alignments


# ========== 主对齐逻辑 ==========

def read_vendor_segments(txt_path: Path) -> pd.DataFrame:
    """读取供应商 tag 格式文件"""
    segments = []
    with open(txt_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 解析 [recognized][n] 和 [translated][n] (支持浮点 ID 如 1.1)
    recognized_pattern = r'\[recognized\]\[([0-9.]+)\]\s*(.*?)(?=\[|$)'
    translated_pattern = r'\[translated\]\[([0-9.]+)\]\s*(.*?)(?=\[|$)'

    recognized_matches = re.findall(recognized_pattern, content, re.DOTALL)
    translated_matches = re.findall(translated_pattern, content, re.DOTALL)

    recognized_dict = {idx: text.strip() for idx, text in recognized_matches}
    translated_dict = {idx: text.strip() for idx, text in translated_matches}

    all_ids = sorted(set(recognized_dict.keys()) | set(translated_dict.keys()),
                     key=lambda x: tuple(map(float, x.split('.'))) if '.' in x else (float(x), 0))

    for seg_id in all_ids:
        segments.append({
            'vendor_segment_id': seg_id,
            'vendor_recognized_zh': recognized_dict.get(seg_id, ''),
            'vendor_en': translated_dict.get(seg_id, '')
        })

    return pd.DataFrame(segments)


def read_reference(path: Path) -> pd.DataFrame:
    """读取参考标答"""
    if path.suffix == '.csv':
        df = pd.read_csv(path, encoding='utf-8-sig')
    elif path.suffix in ['.xlsx', '.xls', '.ods']:
        df = pd.read_excel(path, engine='odf' if path.suffix == '.ods' else None)
    else:
        raise ValueError(f"不支持的文件格式: {path.suffix}")

    # 规范化列名（精确匹配优先，避免 reference_policy_cn 等干扰列误匹配）
    col_map = {}
    used_targets = set()

    # 已知的标准列名（优先精确匹配）
    exact_zh_cols = ['zh_ref_group', 'zh_ref_sentence', 'reference_zh', 'zh_ref']
    exact_en_cols = ['en_ref_sentence', 'en_ref_group', 'reference_en', 'en_ref']
    exact_id_cols = ['eval_unit_id']
    exact_metric_cols = ['metric_include']

    cols_lower = {col: col.lower().strip() for col in df.columns}

    # 第一轮：精确匹配
    for col, lower in cols_lower.items():
        if lower in exact_id_cols and 'eval_unit_id' not in used_targets:
            col_map[col] = 'eval_unit_id'
            used_targets.add('eval_unit_id')
        elif lower in exact_zh_cols and 'reference_zh' not in used_targets:
            col_map[col] = 'reference_zh'
            used_targets.add('reference_zh')
        elif lower in exact_en_cols and 'reference_en' not in used_targets:
            col_map[col] = 'reference_en'
            used_targets.add('reference_en')
        elif lower in exact_metric_cols and 'metric_include' not in used_targets:
            col_map[col] = 'metric_include'
            used_targets.add('metric_include')

    # 第二轮：模糊匹配（仅对尚未匹配到的目标，且排除 policy/note 等干扰列）
    for col, lower in cols_lower.items():
        if col in col_map:
            continue
        # 跳过明显的干扰列
        if 'policy' in lower or 'note' in lower or '备注' in lower or '政策' in lower:
            continue
        if 'eval_unit_id' not in used_targets and ('eval_unit' in lower or lower == 'unit'):
            col_map[col] = 'eval_unit_id'
            used_targets.add('eval_unit_id')
        elif 'reference_zh' not in used_targets and 'zh_ref' in lower:
            col_map[col] = 'reference_zh'
            used_targets.add('reference_zh')
        elif 'reference_en' not in used_targets and 'en_ref' in lower:
            col_map[col] = 'reference_en'
            used_targets.add('reference_en')

    df = df.rename(columns=col_map)

    # 必需列检查
    if 'reference_zh' not in df.columns or 'reference_en' not in df.columns:
        raise ValueError(f"参考文件缺少必需列。找到的列: {df.columns.tolist()}")

    # 只保留需要的列，避免重复列名问题
    keep_cols = ['eval_unit_id', 'reference_zh', 'reference_en', 'metric_include']
    keep_cols = [c for c in keep_cols if c in df.columns]
    df = df[keep_cols].copy()

    return df


def align_and_convert(vendor_txt: Path, reference_file: Path, output_csv: Path):
    """执行对齐并转换为路径B格式"""

    print(f"读取供应商文件: {vendor_txt}")
    vendor_df = read_vendor_segments(vendor_txt)
    print(f"  包含 {len(vendor_df)} 个片段")

    print(f"\n读取参考文件: {reference_file}")
    ref_df = read_reference(reference_file)
    print(f"  包含 {len(ref_df)} 个参考单元")

    # 提取文本列表
    reference_zh = ref_df['reference_zh'].apply(normalize_zh_for_alignment).tolist()
    vendor_zh = vendor_df['vendor_recognized_zh'].apply(normalize_zh_for_alignment).tolist()

    print(f"\n执行中文对齐...")
    alignments = monotonic_full_coverage_chinese_align(reference_zh, vendor_zh)

    print(f"  对齐完成: {len(alignments)} 个单元")

    # 构建输出 DataFrame
    output_rows = []

    for i, (v_start, v_end) in enumerate(alignments):
        ref_row = ref_df.iloc[i]

        # 合并供应商片段
        if v_start >= v_end or v_start >= len(vendor_df):
            # 缺失译文
            vendor_zh_aligned = ""
            vendor_en_aligned = ""
            vendor_indices = ""
            confidence = "待对齐"
            status = "待检查"
            note = "供应商缺失此单元"
        else:
            vendor_slice = vendor_df.iloc[v_start:v_end]
            vendor_zh_aligned = ''.join(vendor_slice['vendor_recognized_zh'].tolist())
            vendor_en_aligned = ' '.join(vendor_slice['vendor_en'].tolist())

            # 索引格式
            if v_end - v_start == 1:
                vendor_indices = str(vendor_slice.iloc[0]['vendor_segment_id'])
            else:
                ids = vendor_slice['vendor_segment_id'].tolist()
                vendor_indices = f"{ids[0]}-{ids[-1]}"

            # 计算对齐置信度
            sim = chinese_alignment_similarity(
                ref_row['reference_zh'],
                vendor_zh_aligned
            )

            if sim >= 0.85:
                confidence = "高"
                status = "通过"
            elif sim >= 0.70:
                confidence = "中"
                status = "通过"
            else:
                confidence = "低"
                status = "待检查"

            note = f"自动对齐 (相似度={sim:.3f})"

        output_rows.append({
            'eval_unit_id': ref_row.get('eval_unit_id', f'U{i+1:03d}'),
            'reference_zh': ref_row['reference_zh'],
            'vendor_zh_aligned': vendor_zh_aligned,
            'reference_en': ref_row['reference_en'],
            'vendor_en_aligned': vendor_en_aligned,
            'vendor_micro_spans': '',  # 留空供人工细分
            'vendor_original_indices': vendor_indices,
            'metric_include': ref_row.get('metric_include', 'yes'),
            'initial_confidence': confidence,
            'human_status': status,
            'alignment_note': note
        })

    output_df = pd.DataFrame(output_rows)
    output_df.to_csv(output_csv, index=False, encoding='utf-8-sig')

    print(f"\n已生成路径B格式文件: {output_csv}")
    print(f"  共 {len(output_df)} 个单元")

    # 统计
    high_conf = (output_df['initial_confidence'] == '高').sum()
    mid_conf = (output_df['initial_confidence'] == '中').sum()
    low_conf = (output_df['initial_confidence'] == '低').sum()
    need_check = (output_df['human_status'] == '待检查').sum()

    print(f"\n置信度分布:")
    print(f"  高置信度: {high_conf} ({high_conf/len(output_df)*100:.1f}%)")
    print(f"  中置信度: {mid_conf} ({mid_conf/len(output_df)*100:.1f}%)")
    print(f"  低置信度/待对齐: {low_conf} ({low_conf/len(output_df)*100:.1f}%)")
    print(f"\n需要人工复核: {need_check} 个单元")

    if need_check > 0:
        print(f"\n下一步:")
        print(f"  1. 打开 {output_csv}")
        print(f"  2. 检查 human_status='待检查' 的 {need_check} 行")
        print(f"  3. 修正 vendor_zh_aligned 和 vendor_en_aligned")
        print(f"  4. 更新 human_status 为 '通过' 或 '已修正'")
        print(f"  5. 保存为 *_corrected.csv 用于评分")


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("用法: python align_to_manual_format.py <供应商TXT> <参考ODS/CSV> <输出CSV>")
        print("\n示例:")
        print("  python align_to_manual_format.py \\")
        print("    input/zaure/S_R003S01C01_15min_azure.txt \\")
        print("    input/zaure/S_R003S01C01_15min_eval_units_merged_reference.ods \\")
        print("    input/zaure/S_R003S01C01_15min_manual_alignment_scoring_input.csv")
        sys.exit(1)

    vendor_txt = Path(sys.argv[1])
    reference_file = Path(sys.argv[2])
    output_csv = Path(sys.argv[3])

    if not vendor_txt.exists():
        print(f"错误: 文件不存在: {vendor_txt}")
        sys.exit(1)
    if not reference_file.exists():
        print(f"错误: 文件不存在: {reference_file}")
        sys.exit(1)

    align_and_convert(vendor_txt, reference_file, output_csv)
