OCRBench v2 评测（OpenRouter API）

1. 安装依赖
   pip install -r requirements.txt

2. 设置 API Key
   export OPENROUTER_API_KEY=sk-or-...

3. 必须在本目录下运行（spotting 评分使用相对路径 ./eval_scripts/spotting_eval/）
   cd <本目录>
   python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct
   python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct --resume --workers 2

首次运行会自动下载 OCRBench_v2.tsv 到 data/（带 MD5 校验），并解码图片到 data/images/。

输出：outputs/<model>/<时间戳>/
  <model>_OCRBench_v2.json             预测结果
  predictions_scored.json              逐条评分
  <model>_OCRBench_v2_score.json       分数汇总
  <model>_OCRBench_v2_checkpoint.pkl   断点（--resume 使用）
