#!/usr/bin/env python3
"""OCRBench v2 端到端评测 - 完全对齐 VLMEvalKit 工作流

一条命令完成：下载TSV → 解码图片 → 推理 → 评分 → 输出

用法:
  export OPENROUTER_API_KEY=sk-or-...
  python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct
  python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct --resume

对齐 VLMEvalKit:
  - 数据流: TSV base64 → 落盘jpg → 读jpg编码 → API
  - 图片编码: 完整复刻 encode_image_to_base64 (含max_file_size循环缩小)
  - API参数: timeout=600, retry=3, 带random sleep
  - 断点: checkpoint.pkl 自动续跑
  - 评分: 自动调用 get_score.py
"""
import argparse
import base64
import hashlib
import io
import json
import os
import pickle
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.request import urlretrieve

import pandas as pd
import requests
from PIL import Image
from tqdm import tqdm

BASE_DIR = Path(__file__).resolve().parent
API_URL = "https://openrouter.ai/api/v1/chat/completions"
MIN_EDGE = 100  # VLMEvalKit VLMEVAL_MIN_IMAGE_EDGE 默认值

# VLMEvalKit OCRBench_v2 数据集配置
DATASET_URL = "https://huggingface.co/datasets/QYWH/ocrbench_v2/resolve/main/OCRBench_v2.tsv?download=true"
DATASET_MD5 = "65d04fe07b4d4ee33e73fc8e7d4d46b0"


def md5_file(path):
    """计算文件MD5，与VLMEvalKit的md5()函数一致"""
    hash_md5 = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def check_or_download_tsv():
    """检查/下载OCRBench_v2.tsv，对齐VLMEvalKit的prepare_tsv逻辑

    返回: tsv文件路径
    """
    data_dir = BASE_DIR / "data"
    data_dir.mkdir(exist_ok=True)
    tsv_path = data_dir / "OCRBench_v2.tsv"

    if tsv_path.exists():
        print(f"检测到 {tsv_path}")
        current_md5 = md5_file(tsv_path)
        if current_md5 == DATASET_MD5:
            print(f"  MD5校验通过: {current_md5}")
            return tsv_path
        else:
            print(f"  [警告] MD5不匹配（期望 {DATASET_MD5}，实际 {current_md5}），重新下载...")
            tsv_path.unlink()

    print(f"下载 OCRBench_v2.tsv ...")
    print(f"   URL: {DATASET_URL}")
    urlretrieve(DATASET_URL, tsv_path)

    downloaded_md5 = md5_file(tsv_path)
    if downloaded_md5 != DATASET_MD5:
        raise ValueError(f"下载文件MD5校验失败: 期望 {DATASET_MD5}, 实际 {downloaded_md5}")

    print(f"下载完成，MD5校验通过")
    return tsv_path



def resize_image_by_factor(img, factor):
    """等比缩放图片，完全复刻VLMEvalKit vlm.py:resize_image_by_factor"""
    w, h = img.size
    new_w, new_h = int(w * factor), int(h * factor)
    return img.resize((new_w, new_h))


def encode_image_to_base64_vlm(img, max_file_size=1e9):
    """完全复刻VLMEvalKit的encode_image_to_base64逻辑

    参数:
        img: PIL.Image对象
        max_file_size: base64字符串长度上限（默认1e9，即1GB）

    返回:
        base64字符串（不含data:image前缀）
    """
    # 1. 模式转换（与VLMEvalKit一致）
    if img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")

    # 2. target_size=-1，不主动缩放（VLMEvalKit默认）

    # 3. 短边放大到MIN_EDGE（VLMEvalKit的VLMEVAL_MIN_IMAGE_EDGE）
    min_edge = int(os.environ.get("VLMEVAL_MIN_IMAGE_EDGE", MIN_EDGE))
    if min(img.size) < min_edge:
        factor = min_edge / min(img.size)
        img = resize_image_by_factor(img, factor)

    # 4. JPEG编码
    img_buffer = io.BytesIO()
    img.save(img_buffer, format="JPEG")
    image_data = img_buffer.getvalue()
    ret = base64.b64encode(image_data).decode("utf-8")

    # 5. 循环缩小直到满足max_file_size（VLMEvalKit核心逻辑）
    max_size = float(os.environ.get("VLMEVAL_MAX_IMAGE_SIZE", max_file_size))
    factor = min(1, (max_size / len(ret)) ** 0.5)
    while len(ret) > max_size:
        image_new = resize_image_by_factor(img, factor)
        img_buffer = io.BytesIO()
        image_new.save(img_buffer, format="JPEG")
        image_data = img_buffer.getvalue()
        ret = base64.b64encode(image_data).decode("utf-8")
        factor *= min(1, (max_size / len(ret)) ** 0.5)

    return ret



def prepare_images_from_tsv(tsv_path):
    """从TSV base64解码图片落盘，对齐VLMEvalKit的LOCALIZE流程

    返回: 图片目录路径
    """
    image_dir = BASE_DIR / "data" / "images" / "OCRBench_v2"
    image_dir.mkdir(parents=True, exist_ok=True)

    # 快速检查：如果已有10000张jpg，跳过解码
    existing = list(image_dir.glob("*.jpg"))
    if len(existing) >= 10000:
        print(f"图片目录已存在 {len(existing)} 张，跳过解码")
        return image_dir

    print(f"从TSV解码图片到 {image_dir} ...")
    df = pd.read_csv(tsv_path, sep="\t", usecols=["index", "image"])

    for idx, b64 in tqdm(zip(df["index"], df["image"]), total=len(df), desc="解码图片"):
        img_path = image_dir / f"{idx}.jpg"
        if img_path.exists():
            continue

        # 解码逻辑与VLMEvalKit的decode_base64_to_image_file一致
        image_data = base64.b64decode(b64)
        img = Image.open(io.BytesIO(image_data))

        # 模式转换（VLMEvalKit逻辑）
        if img.mode in ("I;16", "I;16L", "I;16B", "I;16N"):
            img = img.convert("I")
        elif img.mode not in ("1", "L", "I", "RGB"):
            img = img.convert("RGB")
        if img.mode == "I":
            img = img.convert("I;16")

        img.save(img_path)

    print(f"图片解码完成，共 {len(list(image_dir.glob('*.jpg')))} 张")
    return image_dir



import threading
from collections import Counter

ERROR_STATS = Counter()  # 各类请求错误的累计次数（每次重试都算）
_STATS_LOCK = threading.Lock()


def record_error(kind, msg):
    """记录一次请求错误；每类错误第一次出现时立即在终端提示。"""
    with _STATS_LOCK:
        ERROR_STATS[kind] += 1
        first = ERROR_STATS[kind] == 1
    if first:
        hint = "（上游限流，会自动重试；频繁出现请降低 --workers）" if kind == "429" else ""
        tqdm.write(f"[警告] 首次出现 {kind}{hint}: {msg[:150]}")


def call_openrouter_api(session, api_key, model, image_base64, question, max_tokens=16384):
    """调用OpenRouter API，完全对齐VLMEvalKit的BaseAPI.generate逻辑

    包含:
    - 前置random sleep 0~0.5s
    - retry=3，每次重试前sleep 0~2s
    - timeout=600
    """
    # 前置sleep（VLMEvalKit base.py:242）
    time.sleep(random.random() * 0.5)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
                    {"type": "text", "text": question},
                ],
            }
        ],
        "max_tokens": max_tokens,
        "temperature": 0.0,
    }

    last_err = None
    for attempt in range(3):  # retry=3
        try:
            r = session.post(API_URL, headers=headers, json=payload, timeout=600)
            if r.status_code == 200:
                body = r.json()
                if body.get("choices"):
                    content = body["choices"][0]["message"]["content"] or ""
                    if content.strip():  # VLMEvalKit 空答案也算失败并重试
                        return content
                    kind, last_err = "空答案", "empty content"
                else:  # OpenRouter 有时 HTTP 200 但正文是上游错误（含 429）
                    code = str((body.get("error") or {}).get("code", "no-choices"))
                    kind = "429" if code == "429" else f"上游错误 {code}"
                    last_err = str(body.get("error"))[:200]
            else:
                kind = "429" if r.status_code == 429 else f"HTTP {r.status_code}"
                last_err = r.text[:200]
        except Exception as e:
            kind, last_err = type(e).__name__, str(e)[:200]
        record_error(kind, last_err)
        # 每次失败后 sleep，与 VLMEvalKit base.py 一致：random * wait * 2，LMDeployAPI wait=5
        time.sleep(random.random() * 5 * 2)

    # 3次全失败，返回VLMEvalKit的FAIL_MSG
    return f"Failed to obtain answer via API. {last_err}"



class InferenceEngine:
    """推理引擎，对齐VLMEvalKit的infer_data_job_api流程"""

    def __init__(self, model, api_key, workers, checkpoint_path, resume=False):
        self.model = model
        self.api_key = api_key
        self.workers = workers
        self.checkpoint_path = checkpoint_path
        self.results = {}
        self.session = requests.Session()

        if resume and checkpoint_path.exists():
            self.results = pickle.load(open(checkpoint_path, "rb"))
            # 过滤失败的（VLMEvalKit inference.py:83逻辑），None/空答案也视为失败，续跑时重新请求
            self.results = {k: v for k, v in self.results.items()
                            if isinstance(v, str) and v.strip() and "Failed" not in v}
            print(f"从断点恢复 {len(self.results)} 条结果")

    def process_one(self, row, image_dir):
        """处理单条样本，返回预测结果"""
        idx = int(row["index"])
        if str(idx) in self.results:
            return None  # 已完成

        img_path = image_dir / f"{idx}.jpg"
        if not img_path.exists():
            return {str(idx): f"Failed: image not found {img_path}"}

        try:
            # 读图 → 编码（完全对齐VLMEvalKit）
            img = Image.open(img_path)
            b64 = encode_image_to_base64_vlm(img)

            # API调用（对齐VLMEvalKit retry+sleep逻辑）
            prediction = call_openrouter_api(
                self.session, self.api_key, self.model, b64, row["question"]
            )

            return {str(idx): prediction}
        except Exception as e:
            return {str(idx): f"Failed: {type(e).__name__}: {str(e)}"}

    def run(self, df, image_dir):
        """批量推理，返回结果列表"""
        todo = [row for _, row in df.iterrows() if str(int(row["index"])) not in self.results]
        print(f"开始推理：待处理 {len(todo)} 条，已完成 {len(self.results)} 条")

        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            futures = {pool.submit(self.process_one, row, image_dir): row for row in todo}
            # 输出经过 tee 管道时 tqdm 拿不到终端宽度，行太长会折行，\r 只能回到最后一行开头，
            # 于是每次刷新都在屏幕上留下一截。这里直接从 /dev/tty 读宽度，并留 2 列余量。
            try:
                with open("/dev/tty") as tty:
                    width = os.get_terminal_size(tty.fileno()).columns - 2
            except OSError:
                width = 100
            bar = tqdm(as_completed(futures), total=len(futures), desc="推理进度", ncols=width)
            n_fail = 0
            for future in bar:
                result = future.result()
                if result:
                    self.results.update(result)
                    n_fail += any("Failed" in str(v) for v in result.values())
                    # 进度条右侧实时显示：429 次数 / 最终失败条数
                    # 左边按"请求次数"计（含重试后成功的），右边按"样本条数"计
                    with _STATS_LOCK:
                        total_err = sum(ERROR_STATS.values())
                        top = " ".join(f"{k}×{v}" for k, v in ERROR_STATS.most_common(2))
                    # 只显示总数和最多的 2 类，完整分类在推理结束后打印
                    bar.set_postfix_str(f"失败{n_fail}条 | 请求错误{total_err}次 {top}".rstrip())
                    # 自动保存checkpoint（VLMEvalKit track_progress_rich逻辑）
                    if len(self.results) % 20 == 0:
                        pickle.dump(self.results, open(self.checkpoint_path, "wb"))

        # 最终保存
        pickle.dump(self.results, open(self.checkpoint_path, "wb"))
        print(f"推理完成，共 {len(self.results)} 条")
        if ERROR_STATS:
            print("[警告] 本次请求错误统计（含重试后成功的）:")
            for kind, n in ERROR_STATS.most_common():
                print(f"   {kind}: {n} 次")
            n_fail = sum("Failed" in str(v) for v in self.results.values())
            if n_fail:
                print(f"   重试 3 次仍失败 {n_fail} 条，加 --resume 再跑一次只补这些")

        # 转换为评分格式
        return self.build_predictions_list(df)

    def build_predictions_list(self, df):
        """构建评分所需的JSON格式，对齐VLMEvalKit image_vqa.py:4062逻辑"""
        import ast
        predictions = []
        for _, row in df.iterrows():
            idx = str(int(row["index"]))
            pred = self.results.get(idx) or ""  # None 按空答案计（得 0 分），避免评分时报错

            result_entry = {
                "type": row["category"],
                "question": row["question"],
                "predict": pred,
                "answers": ast.literal_eval(row["answer"]),
                "bbox": ast.literal_eval(row["bbox"]) if row["bbox"] != "without bbox" else "without bbox",
                "content": ast.literal_eval(row["content"]) if row["content"] != "without content" else "without content",
            }

            # 只在非 'without eval' 时添加 eval 字段（对齐VLMEvalKit）
            evals = row.get("eval", "without eval")
            if evals != "without eval":
                result_entry["eval"] = evals

            predictions.append(result_entry)
        return predictions



def run_evaluation(predictions_json, output_dir):
    """运行评分，调用官方 eval.py:process_predictions"""
    import sys
    sys.path.insert(0, str(BASE_DIR / "eval_scripts"))

    try:
        # eval.py 需要 input_path 和 output_path
        scored_json = output_dir / "predictions_scored.json"

        # 直接调用 eval.py 的 process_predictions
        from eval import process_predictions
        process_predictions(str(predictions_json), str(scored_json))

        # 读取带分数的结果
        with open(scored_json, encoding="utf-8") as f:
            res_data_list = json.load(f)

        # 聚合分数：类型→大类映射与官方 get_score.py 完全一致（eval.py 写入的字段是 score）
        groups = {
            "en_text_recognition": ["text recognition en", "fine-grained text recognition en", "full-page OCR en"],
            "en_text_detection": ["text grounding en", "VQA with position en"],
            "en_text_spotting": ["text spotting en"],
            "en_relationship_extraction": ["key information extraction en", "key information mapping en"],
            "en_element_parsing": ["document parsing en", "chart parsing en", "table parsing en", "formula recognition en"],
            "en_mathematical_calculation": ["math QA en", "text counting en"],
            "en_visual_text_understanding": ["document classification en", "cognition VQA en", "diagram QA en"],
            "en_knowledge_reasoning": ["reasoning VQA en", "science QA en", "APP agent en", "ASCII art classification en"],
            "cn_text_recognition": ["full-page OCR cn"],
            "cn_relationship_extraction": ["key information extraction cn", "handwritten answer extraction cn"],
            "cn_element_parsing": ["document parsing cn", "table parsing cn", "formula recognition cn"],
            "cn_visual_text_understanding": ["cognition VQA cn"],
            "cn_knowledge_reasoning": ["reasoning VQA cn", "text translation cn"],
        }
        type2group = {t: g for g, ts in groups.items() for t in ts}
        buckets = {g: [] for g in groups}
        for item in res_data_list:
            if "ignore" in item:  # 与 get_score.py 一致：ignore 的样本不计分
                continue
            if item["type"] not in type2group:
                raise ValueError(f"Unknown task type: {item['type']}")
            buckets[type2group[item["type"]]].append(item["score"])

        final_scores = {g: sum(v) / len(v) for g, v in buckets.items() if v}
        en = [v for k, v in final_scores.items() if k.startswith("en_")]
        cn = [v for k, v in final_scores.items() if k.startswith("cn_")]
        final_scores["English Overall Score"] = sum(en) / len(en)
        final_scores["Chinese Overall Score"] = sum(cn) / len(cn)
        return final_scores
    except Exception:
        # 不再吞异常返回 {}：预测文件已保存，修好后加 --resume 即可只重新评分
        print(f"[错误] 评分失败。预测结果已保存在 {predictions_json}，修复后加 --resume 重跑会直接复用推理结果")
        raise


def print_summary(scores, fail_count, total, elapsed):
    """打印结果摘要，对齐VLMEvalKit的输出格式"""
    print("\n" + "="*70)
    print("评测完成")
    print("="*70)
    print(f"推理: {total - fail_count}/{total} 成功, {fail_count} 失败")
    print(f"耗时: {elapsed:.1f}s")
    # 与 VLMEvalKit run.py 一致：完整精度、原始顺序，json.dumps(indent=4)
    print("\nEvaluation Results:")
    print(json.dumps(scores, indent=4))
    print("="*70)



def main():
    parser = argparse.ArgumentParser(
        description="OCRBench v2 端到端评测 - 对齐 VLMEvalKit 工作流",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  export OPENROUTER_API_KEY=sk-or-...
  python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct
  python run_ocrbench_v2.py --model qwen/qwen2.5-vl-72b-instruct --resume --workers 2
        """,
    )
    parser.add_argument("--model", required=True, help="OpenRouter模型ID")
    parser.add_argument("--workers", type=int, default=4, help="并发数（默认4）")
    parser.add_argument("--resume", action="store_true", help="从断点续跑")
    args = parser.parse_args()

    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("请设置环境变量: export OPENROUTER_API_KEY=sk-or-...")

    # 输出目录（对齐VLMEvalKit）
    model_sanitized = args.model.replace("/", "_").replace(":", "_")
    model_base_dir = BASE_DIR / "outputs" / model_sanitized

    # --resume: 复用最新的 timestamp 目录
    if args.resume and model_base_dir.exists():
        existing_runs = sorted([d for d in model_base_dir.iterdir() if d.is_dir()], reverse=True)
        if existing_runs:
            output_dir = existing_runs[0]
            print(f"复用已有目录: {output_dir}")
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_dir = model_base_dir / timestamp
            output_dir.mkdir(parents=True, exist_ok=True)
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = model_base_dir / timestamp
        output_dir.mkdir(parents=True, exist_ok=True)

    print(f"OCRBench v2 评测启动")
    print(f"   模型: {args.model}")
    print(f"   并发: {args.workers}")
    print(f"   输出: {output_dir}")
    print()

    start_time = time.time()

    # 1. 下载/校验TSV
    tsv_path = check_or_download_tsv()

    # 2. 解码图片落盘
    image_dir = prepare_images_from_tsv(tsv_path)

    # 3. 加载TSV数据
    print(f"加载数据集...")
    df = pd.read_csv(tsv_path, sep="\t", keep_default_na=False)
    print(f"共 {len(df)} 条样本")

    # 4. 推理
    checkpoint_path = output_dir / f"{model_sanitized}_OCRBench_v2_checkpoint.pkl"
    engine = InferenceEngine(args.model, api_key, args.workers, checkpoint_path, args.resume)
    predictions = engine.run(df, image_dir)

    # 5. 保存预测结果
    pred_json = output_dir / f"{model_sanitized}_OCRBench_v2.json"
    with open(pred_json, "w", encoding="utf-8") as f:
        json.dump(predictions, f, ensure_ascii=False, indent=2)
    print(f"预测结果已保存: {pred_json}")

    # 6. 评分
    print(f"\n开始评分...")
    scores = run_evaluation(pred_json, output_dir)

    # 7. 保存分数
    score_json = output_dir / f"{model_sanitized}_OCRBench_v2_score.json"
    with open(score_json, "w", encoding="utf-8") as f:
        json.dump(scores, f, ensure_ascii=False, indent=2)

    # 8. 输出摘要
    elapsed = time.time() - start_time
    fail_count = sum(1 for p in predictions if not p.get("predict") or "Failed" in p["predict"])
    print_summary(scores, fail_count, len(predictions), elapsed)

    print(f"\n所有结果已保存到: {output_dir}")


if __name__ == "__main__":
    main()

