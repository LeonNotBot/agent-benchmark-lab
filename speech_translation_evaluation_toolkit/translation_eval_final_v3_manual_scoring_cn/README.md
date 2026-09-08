# Translation Eval V3

用于同时评测三段或更多段供应商英文翻译，指标仍为：

- Sentence-BERT Cosine Similarity
- BERTScore Precision / Recall / F1

## V3 修复的核心问题

旧版根据供应商英文与英文标答的相似度，在最多 5 个连续片段中挑选匹配，并允许跳过供应商片段。这会把翻错、残缺或相似度低的供应商输出排除在评分外，导致漏对齐和分数虚高。

V3 改为：

1. 同时读取 `[recognized][n]` 中文和 `[translated][n]` 英文。
2. 默认用 `zh_ref_group / zh_ref_clean / zh_ref` 与供应商 recognized 中文确定边界。
3. 对齐时保留全部参考单元，包括 `metric_include=no` 的过渡单元。
4. 所有供应商片段按原顺序连续、无重叠、无跳过地分配。
5. 合并片段数根据整段数据自动计算，不再固定为 5。
6. 英文只用于最终评分，不参与“挑选哪些供应商片段”。
7. 输出中文对齐分、供应商中文、边界风险提示和覆盖诊断。

因此像叶菜类示例会覆盖完整的 `78-89`，不会只保留相似度较高的 `85-89`。

## 安装

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 单段运行

标答支持 CSV、XLSX 和 ODS：

```bash
python3 run_eval.py \
  --vendor S_R003S01C01_15min.wav.txt \
  --reference S_R003S01C01_15min_eval_units_merged_reference.ods \
  --output-dir output/S_R003S01C01 \
  --alignment-mode auto \
  --max-group 0
```

`--alignment-mode auto` 会优先使用中文对齐。`--max-group 0` 表示根据供应商片段数和参考单元数自动计算，不是固定窗口。

## 三段批量运行

复制示例清单：

```bash
cp batch_manifest.example.csv batch_manifest.csv
```

把三行路径改为实际文件，然后运行：

```bash
bash run_batch.sh batch_manifest.csv output_batch
```

也可以直接使用：

```bash
python3 run_batch.py \
  --manifest batch_manifest.csv \
  --output-dir output_batch \
  --alignment-mode auto \
  --max-group 0
```

每段会写入独立子目录，任一段失败不会被静默忽略，批处理最后会返回失败清单。

## 主要输出

- `*_semantic_metrics.csv`：全部参考单元及评分结果
- `*_alignment_preview.txt`：中英文对齐预览
- `*_alignment_diagnostics.csv`：边界、片段数、中文相似度、风险提示
- `*_evaluation.xlsx`：完整 Excel 报告
- `*_summary.json`：汇总和覆盖诊断
- `*_error_type_summary.csv`
- `*_review_cases_top30.csv`
- `plots/`

## 必查诊断字段

正常情况下：

```text
alignment_full_coverage = true
alignment_unassigned_segments = 0
alignment_overlap_segments = 0
```

`alignment_warning` 出现“中文边界相似度较低”时，需要人工复核该单元，但程序不会通过跳过错误译文来抬高分数。
