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
- 自动下载 OCRBench_v2.tsv（~160MB，含 2,000+ 样本）
- 解码 base64 图片到本地（加快后续读取）
- 并发推理（默认 4 worker）
- 自动评分（调用 eval.py）
- 生成结果报告

## 完整工作流

### 第一次运行（全量评测）

```bash
python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct
```

**耗时**：取决于 API 响应速度，通常 2-4 小时

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
  "cn_text_recognition": 0.578,
  ...
  "English Overall Score": 0.513,
  "Chinese Overall Score": 0.503
}
```

### 4. `*_checkpoint.pkl` - 断点文件

二进制文件，包含所有已完成的样本结果。`--resume` 时自动加载。

## 支持的题型（16 类）

| 题型类别 | 中文 | 英文 |
|---------|------|------|
| **文本识别** | text recognition cn | text recognition en |
| **文本检测** | text detection cn | text detection en |
| **文本定位** | text spotting cn | text spotting en |
| **文档解析** | document parsing cn | - |
| **表格解析** | table parsing cn | table parsing en |
| **手写识别** | handwritten answer extraction cn | - |
| **关系抽取** | relationship extraction cn | relationship extraction en |
| **元素定位** | element parsing cn | element parsing en |
| **视觉理解** | visual text understanding cn | visual text understanding en |
| **数学计算** | math QA cn | math QA en |
| **知识推理** | knowledge reasoning cn | knowledge reasoning en |
| **推理 VQA** | reasoning VQA cn | reasoning VQA en |
| **文本翻译** | text translation cn | - |
| **文本计数** | text counting cn | text counting en |
| **数学表达式** | math expression cn | math expression en |

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
```bash
# 自动重试 3 次，每次间隔 5-20 秒
# 如果仍失败，用 --resume 从断点续跑
python run_ocrbench_v2.py --model xxx --resume
```

### Q3: 显存或内存不足

**原因**：并发数过高或模型太大

**解决**：
```bash
# 降低并发数
python run_ocrbench_v2.py --model xxx --workers 1

# 或改用更小的模型
python run_ocrbench_v2.py --model qwen/qwen2.5-vl-7b-instruct
```

### Q4: 怎样修改为本地模型？

在 `run_ocrbench_v2.py` 中修改 API 配置：

```python
# 行 19
API_URL = "http://localhost:8000/v1/chat/completions"  # 改成你的本地端口

# 行 48，改成本地认证方式
API_KEY = os.getenv("OPENROUTER_API_KEY", "local")  # 可以改成任意 key
```

然后运行：
```bash
python run_ocrbench_v2.py --model qwen:vl-72b-instruct
```

### Q5: 能只评测某几个题型吗？

**方法 1**：修改 checkpoint 后重跑
- 删除 checkpoint.pkl
- 改 predictions.json，只保留想要的题型
- 用 `--resume` 重新评分

**方法 2**：修改代码
在 `run_ocrbench_v2.py` 第 487 行附近，过滤 dataframe：
```python
df = df[df['type'].isin(['text recognition en', 'text recognition cn'])]
```

### Q6: 怎样导入自己的预测结果？

1. 按格式制造 JSON（参考 `predictions_scored.json` 格式）
2. 放到 `outputs/<model>/<时间戳>/` 目录
3. 调用评分函数：

```python
from eval_scripts.eval import process_predictions
process_predictions("pred.json", "scored.json")
```

### Q7: 断点文件怎样手动操作？

```python
import pickle
checkpoint = pickle.load(open("checkpoint.pkl", "rb"))
print(f"已完成 {len(checkpoint)} 条")

# 删除某条结果（重新推理）
del checkpoint["123"]

pickle.dump(checkpoint, open("checkpoint.pkl", "wb"))
```

## 性能指标

| 指标 | 说明 |
|------|------|
| **样本数** | 2,088 条 |
| **平均推理耗时** | 1.5-2.5 分钟/条（取决于 API） |
| **总耗时** | 2-4 小时（全量）|
| **磁盘占用** | ~500 MB（data/ 文件夹） |
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

## 贡献 & 反馈

- 发现 bug：检查 eval_scripts/ 评分逻辑
- 改进建议：修改 run_ocrbench_v2.py 的推理或输出部分
- 数据集问题：参考官方 [OCRBench 主页](https://github.com/QYWH/OCRBench)

---

**更新时间**: 2024-11-09  
**对齐版本**: VLMEvalKit OCRBench v2
