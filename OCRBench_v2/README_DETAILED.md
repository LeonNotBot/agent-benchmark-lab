# OCRBench v2 最小可运行包

一条命令完成 OCR 模型的端到端评测：**下载数据 → 推理 → 评分 → 生成报告**

## 快速开始（3 分钟）

```bash
# 1. 解包
tar xzf ocrbench_v2_minimal.tar.gz
cd ocrbench_v2_minimal

# 2. 安装依赖
pip install -r requirements.txt

# 3. 设置 API Key（OpenRouter）
export OPENROUTER_API_KEY=sk-or-...

# 4. 运行评测
python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct
```

✅ 首次运行会：
- 自动下载 OCRBench_v2.tsv（~1.4GB，含 10,000 样本）
- 解码 base64 图片到本地（加快后续读取）
- 并发推理（默认 4 worker）
- 自动评分（调用 eval.py）
- 生成结果报告

## 完整工作流

### 第一次运行（全量评测）

```bash
python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct
```

**输出目录**：`outputs/qwen_qwen2.5-vl-72b-instruct/<时间戳>/`
```
outputs/qwen_qwen2.5-vl-72b-instruct/20261109_143000/
├── qwen_qwen2.5-vl-72b-instruct_OCRBench_v2.json      (原始预测)
├── predictions_scored.json                              (逐条评分)
├── qwen_qwen2.5-vl-72b-instruct_OCRBench_v2_score.json (最终分数)
└── qwen_qwen2.5-vl-72b-instruct_OCRBench_v2_checkpoint.pkl (断点)
```

### 从断点续跑（中断恢复）

如果推理中途被中断（网络问题、超时等），使用 `--resume`：

```bash
python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct --resume
```

✅ 会自动：
- 检测最新的输出目录
- 加载已有的 checkpoint.pkl
- 跳过已完成的样本
- 继续处理剩余样本

### 调整并发数

默认 4 个 worker，根据 API 限流调整：

```bash
# 并发数改为 2（降低 API 压力）
python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct --workers 2

# 并发数改为 8（加速）
python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct --workers 8
```

## 输出文件说明

### 1. `*_OCRBench_v2.json` - 原始预测

```json
[
  {
    "index": 0,
    "type": "text recognition en",
    "image_path": "...",
    "question": "Recognize all text in the image",
    "predict": "model output here",
    "answers": ["ground truth"]
  }
]
```

### 2. `predictions_scored.json` - 逐条评分

```json
[
  {
    "type": "text recognition en",
    "question": "...",
    "predict": "...",
    "answers": ["..."],
    "score": 0.85,  // 单条样本分数 (0-1)
    "bbox": [...],
    "content": [...]
  }
]
```

### 3. `*_OCRBench_v2_score.json` - 最终报告

```json
{
  "en_text_recognition": 0.609,
  "en_text_detection": 0.125,
  "en_text_spotting": 0.500,
  "en_relationship_extraction": 0.922,
  "en_element_parsing": 0.341,
  "en_mathematical_calculation": 0.940,
  "en_visual_text_understanding": 0.667,
  "en_knowledge_reasoning": 0.500,
  "cn_text_recognition": 0.578,
  "cn_relationship_extraction": 0.650,
  "cn_element_parsing": 0.366,
  "cn_visual_text_understanding": 0.500,
  "cn_knowledge_reasoning": 0.420,
  "English Overall Score": 0.513,
  "Chinese Overall Score": 0.503
}
```

### 4. `*_checkpoint.pkl` - 断点文件

二进制文件，包含所有已完成的样本结果。`--resume` 时自动加载。

## 支持的题型（30 类）

### 英文题型（21 类）
- text recognition en
- fine-grained text recognition en
- full-page OCR en
- text grounding en
- VQA with position en
- text spotting en
- key information extraction en
- key information mapping en
- document parsing en
- chart parsing en
- table parsing en
- formula recognition en
- math QA en
- text counting en
- document classification en
- cognition VQA en
- diagram QA en
- reasoning VQA en
- science QA en
- APP agent en
- ASCII art classification en

### 中文题型（9 类）
- full-page OCR cn
- key information extraction cn
- handwritten answer extraction cn
- document parsing cn
- table parsing cn
- formula recognition cn
- cognition VQA cn
- reasoning VQA cn
- text translation cn

## 常见问题

### Q1: 出现 "MD5 校验失败"

**原因**：数据集下载不完整或损坏

**解决**：
```bash
rm -rf data/OCRBench_v2.tsv
python run_ocrbench_v2.py --model xxx  # 重新下载
```

### Q2: API 超时或连接失败

**原因**：OpenRouter 服务不稳定、网络问题

**解决**：
- 脚本已内置自动重试机制（每个请求重试 3 次）
- 每次重试前会随机等待 0-10 秒
- 如果仍失败，用 `--resume` 从断点续跑

```bash
python run_ocrbench_v2.py --model xxx --resume
```

### Q3: 怎样修改为本地模型？

在 `run_ocrbench_v2.py` 中修改 API 配置：

```python
# 第 38 行
API_URL = "http://localhost:8000/v1/chat/completions"  # 改成你的本地端口

# 第 453 行（API key 获取）
api_key = os.getenv("OPENROUTER_API_KEY", "local")  # 可以改成任意值或去掉校验
```

然后运行：
```bash
python run_ocrbench_v2.py --model qwen:vl-72b-instruct
```

### Q4: 能只评测某几个题型吗？

**方法 1**：修改已有预测文件
- 编辑 `*_OCRBench_v2.json`，只保留想要的题型
- 删除对应的 checkpoint.pkl
- 用 `--resume` 重新评分

**方法 2**：修改代码
在 `run_ocrbench_v2.py` 第 492 行加载 TSV 后，过滤 dataframe：
```python
df = pd.read_csv(tsv_path, sep="\t", keep_default_na=False)
# 添加这行：只保留特定题型
df = df[df['category'].isin(['Text Recognition', 'Text Detection'])]
```

### Q5: 怎样导入自己的预测结果？

如果你已经用其他方式跑完了推理，只需要评分：

1. 按格式制造 JSON（参考输出文件格式）
2. 直接调用评分函数：

```python
import sys
sys.path.insert(0, './eval_scripts')
from eval import process_predictions

process_predictions("my_predictions.json", "scored_output.json")
```

### Q6: 断点文件怎样手动操作？

```python
import pickle

# 加载断点
checkpoint = pickle.load(open("checkpoint.pkl", "rb"))
print(f"已完成 {len(checkpoint)} 条")

# 查看某条结果
print(checkpoint["123"])  # index 为 123 的样本

# 删除某条结果（重新推理）
del checkpoint["123"]

# 保存修改
pickle.dump(checkpoint, open("checkpoint.pkl", "wb"))
```

### Q7: 推理参数怎样调整？

脚本使用的 API 参数（对齐 VLMEvalKit）：
- `temperature`: 0.0（确定性输出）
- `max_tokens`: 16384
- `timeout`: 600 秒
- `retry`: 3 次，每次间隔 0-10 秒

修改 `run_ocrbench_v2.py` 第 185-260 行的 `call_openrouter_api` 函数。

## 性能指标

| 指标 | 说明 |
|------|------|
| **样本数** | 10,000 条 |
| **任务类型** | 30 种（21 英文 + 9 中文）|
| **TSV 文件大小** | ~1.4 GB |
| **图片数量** | 10,000 张 JPG |
| **磁盘占用** | ~2 GB（data/ 文件夹） |
| **评分耗时** | ~5 分钟（全流程） |

## 目录结构

```
ocrbench_v2_minimal/
├── run_ocrbench_v2.py           # 主程序
├── requirements.txt              # 依赖
├── README.txt                    # 简明说明
├── README_DETAILED.md            # 详细说明（本文件）
├── .gitignore                    # Git 忽略规则
├── eval_scripts/                 # 评分引擎（勿删）
│   ├── eval.py                   # 主评分器
│   ├── vqa_metric.py             # VQA 评分逻辑
│   ├── IoUscore_metric.py        # IoU 评分（目标检测）
│   ├── TEDS_metric.py            # 表格评分
│   ├── page_ocr_metric.py        # 整页 OCR 评分
│   ├── spotting_metric.py        # 文本定位评分
│   ├── parallel.py               # 并行工具
│   ├── get_score.py              # 得分汇总
│   └── spotting_eval/            # 定位评测子模块
│       ├── script.py
│       ├── rrc_evaluation_funcs_1_1.py
│       └── readme.txt
├── data/                         # 数据目录（运行时创建）
│   ├── OCRBench_v2.tsv           # 数据集（自动下载）
│   └── images/OCRBench_v2/       # 解码图片（自动生成）
└── outputs/                      # 输出目录（运行时创建）
    └── <model_name>/
        └── <时间戳>/
            ├── *.json            # 预测和分数
            └── *.pkl             # 断点
```

## 依赖说明

- **Python**: 3.8+
- **推理 API**: OpenRouter（兼容 OpenAI 接口的任何服务都可以）
- **图像处理**: Pillow, numpy
- **评分库**: distance, apted, lxml, zss, Levenshtein, editdistance, nltk, jieba
- **工具**: pandas, requests, tqdm

完整依赖见 `requirements.txt`

## 技术细节

### 重试机制（对齐 VLMEvalKit）
- 每个请求前随机等待 0-0.5 秒（防止瞬时峰值）
- 失败后重试 3 次
- 每次重试前随机等待 0-10 秒
- 超时时间：600 秒

### 图片编码
- 完全复刻 VLMEvalKit 的 `encode_image_to_base64` 逻辑
- 如果 base64 超过 1GB，自动等比缩小图片
- 最小边不低于 100 像素（MIN_EDGE）

### 评分逻辑
- 30 种任务类型映射到 13 个评分维度
- 8 个英文维度 + 5 个中文维度
- 各维度平均后得到英文/中文总分
- 与 VLMEvalKit 的 `get_score.py` 完全对齐

## 贡献 & 反馈

- 发现 bug：检查 eval_scripts/ 评分逻辑
- 改进建议：修改 run_ocrbench_v2.py 的推理或输出部分
- 数据集问题：参考官方 [OCRBench GitHub](https://github.com/Yuliang-Liu/MultimodalOCR)

---

**更新时间**: 2024-11-09  
**对齐版本**: VLMEvalKit OCRBench v2
