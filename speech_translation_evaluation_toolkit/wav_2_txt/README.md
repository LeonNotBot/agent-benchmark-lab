# WAV 音频转文本工具集

将音频文件转写为"中文识别 + 英文翻译"的标准格式，用于后续评测。

## 目录结构

```
wav_2_txt/
├── scripts/           # 转写脚本
│   ├── transcribe_wav.py         # 联想 L20 内网服务
│   └── azure_speech_translate.py # 微软 Azure Speech
├── wav/              # 测试音频
│   └── CTS-CN-F2F-2019-11-15-3.wav
├── output/           # 转写输出
│   └── azure_test.wav.txt
└── README.md
```

## 使用方法

### 1. 微软 Azure Speech Translation

**适用场景**：公网可访问、支持多语言、高准确率

```bash
python scripts/azure_speech_translate.py wav/your_audio.wav zh2en --out output/azure_output.wav.txt
```

**参数**：
- 第一个参数：音频文件路径（支持 WAV/MP3/OGG）
- `zh2en`：中译英（或 `en2zh` 英译中）
- `--out`：输出文件路径（可选，默认为 `音频文件名.txt`）
- `--print-only`：只打印不写文件（可选）

**配置**：
- 需要 Azure 订阅密钥和区域，在脚本顶部修改：
  ```python
  SUBSCRIPTION_KEY = "你的密钥"
  REGION = "eastasia"  # 或其他区域
  ```

### 2. 联想 L20 内网服务

**适用场景**：内网环境、已部署 L20 DLL 服务

```bash
python scripts/transcribe_wav.py wav/your_audio.wav --out output/lenovo_output.wav.txt
```

**参数**：
- 第一个参数：音频文件路径
- `--out`：输出文件路径（可选，默认为 `音频文件名.txt`）

**配置**：
- 需要内网服务地址，在脚本顶部修改：
  ```python
  BASE_URL = "http://内网IP:端口"
  ```

## 输出格式

两个脚本输出格式完全一致，符合评测工具链要求：

```
[recognized][1] 今天要聊什么呀？
[translated][1] What are we talking about today?
[recognized][2] 你对电影有什么？
[translated][2] What do you like about movies?
...
```

## 下一步

输出文件可直接用于评测：

```bash
cd ../translation_evaluation_toolkit/translation_eval_final_v3_manual_scoring_cn

# 单个评测
python run_eval.py --vendor ../../wav_2_txt/output/azure_test.wav.txt \
                   --reference input/标答文件.ods \
                   --output-dir output/azure_eval

# 批量对比
python run_batch.py --manifest manifest.csv --output-dir output_batch
```

## 依赖安装

```bash
# Azure 脚本
pip install azure-cognitiveservices-speech

# 联想脚本
pip install requests
```

## 已验证样本

- **音频**：[wav/CTS-CN-F2F-2019-11-15-3.wav](wav/CTS-CN-F2F-2019-11-15-3.wav)（15 分钟会议对话）
- **Azure 输出**：[output/azure_test.wav.txt](output/azure_test.wav.txt)（48 段，已验证格式正确）
- **验证状态**：✅ 链路完整、格式标准、可直接评测
