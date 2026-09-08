# 语音翻译评测工具集

用于评测语音翻译模型质量的工具集，支持多模型对比、语义相似度评分、错误类型分析。

## 功能特性

- **音频转文字**：支持 Azure、深思考 SDK、Lenovo L20 三种语音识别+翻译服务
- **自动对齐**：将模型输出与标准答案按语义对齐
- **语义评分**：基于 Sentence-BERT 和 BERTScore 计算翻译质量
- **多模型对比**：生成综合评测报告，对比不同模型表现

## 项目结构

```
speech_translation_evaluation_toolkit/
├── wav_2_txt/                        # 音频转文字工具集
│   └── scripts/
│       ├── azure_speech_translate.py  # Azure 转写
│       ├── stt_translate_batch.py     # 深思考 SDK 批量转写
│       ├── transcribe_wav.py          # Lenovo L20 转写
│       └── bin/                       # Lenovo SDK DLL
│
└── translation_eval_final_v3_manual_scoring_cn/
    ├── input/                         # 输入数据目录
    ├── output_manual/                 # 评测结果输出
    ├── output/                        # 报告输出
    ├── run_eval.py                    # 核心评测脚本（自动对齐）
    ├── score_aligned_units.py         # 评分脚本（人工对齐后）
    ├── align_to_manual_format.py      # 对齐脚本
    ├── run_batch.py                   # 批量执行
    └── generate_deliverable_report.py # 报告生成
```

## 环境安装

```bash
pip install -r requirements.txt
```

## 快速开始

### 1. 音频转文字

```bash
cd wav_2_txt

# Azure 转写
python scripts/azure_speech_translate.py wav/audio.wav zh2en --out output/azure/audio.wav.txt
```

### 2. 对齐到标答

```bash
cd translation_eval_final_v3_manual_scoring_cn

python align_to_manual_format.py \
  "输入.wav.txt" \
  "标答.ods" \
  "对齐输出.csv"
```

### 3. 评分

```bash
python score_aligned_units.py \
  --input "对齐输出.csv" \
  --output_dir "output_manual/模型名/音频名" \
  --alignment_mode manual
```

### 4. 生成报告

```bash
python generate_deliverable_report.py
```

## 评测指标

| 指标 | 说明 | 取值范围 |
|------|------|---------|
| Sentence-BERT 余弦相似度 | 基于语义向量的相似度 | 0-1 |
| BERTScore F1 | Token 级精确率+召回率 | 0-1 |
| 综合语义平均分 | 上述两项的平均值 | 0-1 |

## 质量等级

| 等级 | 综合语义分 |
|------|-----------|
| 优秀 | ≥ 0.90 |
| 中等 | 0.70 - 0.89 |
| 不及格 | < 0.70 |

## 注意事项

- 音频文件、评测数据、评测结果不纳入版本控制（见 `.gitignore`）
- 使用 Azure/深思考/Lenovo 服务需配置对应的密钥或内网访问权限
- 模型密钥请勿硬编码提交，建议通过环境变量配置
