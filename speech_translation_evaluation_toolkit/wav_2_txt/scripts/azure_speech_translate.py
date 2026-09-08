#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""调用 Azure Speech Translation 对音频做 ASR + 翻译（zh→en 或 en→zh）。

用 azure-cognitiveservices-speech SDK 的 translation_recognizer，一次调用同时得到：
  - result.text → 识别原文（中文）
  - result.translations["en"] → 翻译译文（英文）

支持三种输出格式：
  - tag（默认）：[recognized][n] / [translated][n]，可直接喂给 run_eval.py
  - json：带时间戳的 JSON 数组，程序友好
  - csv：表格格式，Excel 友好

用法:
  python azure_speech_translate.py wav\\CTS-CN-F2F-2019-11-15-3.wav
  python azure_speech_translate.py 会议.wav en2zh
  python azure_speech_translate.py 会议.wav zh2en --format json
  python azure_speech_translate.py 会议.wav zh2en --format csv --out output/result.csv
"""

import argparse
import csv
import json
import os
import sys
from pathlib import Path

try:
    import azure.cognitiveservices.speech as speechsdk
except ImportError:
    print("[ERROR] 请先安装 Azure Speech SDK: pip install azure-cognitiveservices-speech")
    sys.exit(1)

# 从环境变量读取 Azure 密钥
SUBSCRIPTION_KEY = os.getenv("AZURE_SPEECH_KEY")
REGION = os.getenv("AZURE_SPEECH_REGION", "eastasia")

if not SUBSCRIPTION_KEY:
    print("[ERROR] 请设置环境变量 AZURE_SPEECH_KEY")
    print("  Windows: set AZURE_SPEECH_KEY=your_key")
    print("  Linux/Mac: export AZURE_SPEECH_KEY=your_key")
    sys.exit(1)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="通过 Azure Speech Translation 调用：WAV → 识别 + 翻译（zh2en / en2zh）。"
    )
    parser.add_argument("wav", help="本地音频文件路径（wav/mp3/flac，UTF-8）")
    parser.add_argument(
        "direction", nargs="?", default="zh2en", choices=["zh2en", "en2zh"],
        help="翻译方向，默认 zh2en",
    )
    parser.add_argument(
        "--out", default=None,
        help="输出 .wav.txt 路径；缺省为 wav 同目录的 <名字>.wav.txt",
    )
    parser.add_argument(
        "--print-only", action="store_true",
        help="只打印结果，不写文件",
    )
    parser.add_argument(
        "--format", default="tag", choices=["tag", "json", "csv"],
        help="输出格式：tag=工具链格式 [recognized][n]；json=带时间戳的JSON；csv=表格格式（默认tag）",
    )
    args = parser.parse_args()

    wav_path = Path(args.wav).resolve()
    if not wav_path.exists():
        print(f"[ERROR] 音频文件不存在: {wav_path}")
        return 1

    # 根据方向配置语言对
    if args.direction == "zh2en":
        speech_lang = "zh-CN"
        target_langs = ["en"]
    else:  # en2zh
        speech_lang = "en-US"
        target_langs = ["zh-Hans"]

    print(f"[INFO] 音频文件: {wav_path}")
    print(f"[INFO] 识别语言: {speech_lang}, 翻译目标: {target_langs[0]}")
    print("[INFO] 正在连接 Azure Speech Translation 服务（eastasia）……")

    # ---- 配置 Speech Translation ----
    translation_config = speechsdk.translation.SpeechTranslationConfig(
        subscription=SUBSCRIPTION_KEY,
        region=REGION,
        speech_recognition_language=speech_lang,
        target_languages=target_langs,
    )
    audio_config = speechsdk.audio.AudioConfig(filename=str(wav_path))
    recognizer = speechsdk.translation.TranslationRecognizer(
        translation_config=translation_config,
        audio_config=audio_config,
    )

    # ---- 收集结果（连续识别模式）----
    segments = []
    segment_id = 1
    done = False
    last_segment_time = [None]  # 用列表包装以便在闭包里修改

    def on_recognized(evt):
        nonlocal segment_id
        if evt.result.reason == speechsdk.ResultReason.TranslatedSpeech:
            recognized_text = evt.result.text
            translated_text = evt.result.translations.get(target_langs[0], "")
            # offset/duration 单位为 100 纳秒，转换为秒
            start_sec = round(evt.result.offset / 1e7, 2)
            duration_sec = round(evt.result.duration / 1e7, 2)
            segments.append({
                "id": segment_id,
                "start_sec": start_sec,
                "end_sec": round(start_sec + duration_sec, 2),
                "duration_sec": duration_sec,
                "recognized": recognized_text,
                "translated": translated_text,
            })
            print(f"[{segment_id}] {recognized_text} → {translated_text}")
            segment_id += 1
            last_segment_time[0] = time.time()  # 记录最后一次识别时间
        elif evt.result.reason == speechsdk.ResultReason.NoMatch:
            print(f"[WARN] 未识别到语音: {evt.result.no_match_details}")

    def on_canceled(evt):
        nonlocal done
        print(f"[ERROR] 识别取消: {evt.cancellation_details.reason}")
        if evt.cancellation_details.error_details:
            print(f"       错误详情: {evt.cancellation_details.error_details}")
        done = True

    def on_stopped(evt):
        nonlocal done
        print("[INFO] 识别完成。")
        done = True

    recognizer.recognized.connect(on_recognized)
    recognizer.canceled.connect(on_canceled)
    recognizer.session_stopped.connect(on_stopped)

    # ---- 开始连续识别 ----
    import time
    recognizer.start_continuous_recognition()
    print("[INFO] 正在识别……（长音频需等待数分钟）")

    # 等待完成（带超时和静默检测）
    max_wait = 3600  # 总超时 60 分钟（适配长音频）
    idle_timeout = 30  # 识别静默超过 30 秒视为完成（避免会议停顿导致提前结束）
    start_time = time.time()
    last_segment_time[0] = time.time()

    while not done:
        time.sleep(0.5)
        elapsed = time.time() - start_time
        idle = time.time() - last_segment_time[0]

        # 如果已有识别结果且静默超过 idle_timeout 秒，视为完成
        if segments and idle > idle_timeout:
            print(f"[INFO] 识别静默 {idle:.1f}s，视为完成。")
            break

        # 总超时保护
        if elapsed > max_wait:
            print(f"[WARN] 超时 {max_wait}s，强制结束。")
            break

    recognizer.stop_continuous_recognition()

    if not segments:
        print("[WARN] 没有任何识别/译文片段返回。")
        return 0

    # ---- 打印并输出 ----
    print("\n========== 识别 + 翻译结果 ==========")

    # 根据格式打印
    if args.format == "json":
        print(json.dumps(segments, ensure_ascii=False, indent=2))
    elif args.format == "csv":
        print("id,start_sec,end_sec,duration_sec,recognized,translated")
        for seg in segments:
            print(f"{seg['id']},{seg['start_sec']},{seg['end_sec']},{seg['duration_sec']},\"{seg['recognized']}\",\"{seg['translated']}\"")
    else:  # tag
        for seg in segments:
            print(f"[recognized][{seg['id']}] {seg['recognized']}")
            print(f"[translated][{seg['id']}] {seg['translated']}")
            print()

    if not args.print_only:
        # 根据格式决定文件扩展名
        if args.out:
            out_path = Path(args.out)
        else:
            if args.format == "json":
                out_path = Path(str(wav_path) + ".json")
            elif args.format == "csv":
                out_path = Path(str(wav_path) + ".csv")
            else:  # tag
                out_path = Path(str(wav_path) + ".txt")

        out_path = out_path.resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # 根据格式写文件
        if args.format == "json":
            with out_path.open("w", encoding="utf-8") as f:
                json.dump(segments, f, ensure_ascii=False, indent=2)
        elif args.format == "csv":
            with out_path.open("w", encoding="utf-8", newline='') as f:
                writer = csv.DictWriter(f, fieldnames=["id", "start_sec", "end_sec", "duration_sec", "recognized", "translated"])
                writer.writeheader()
                writer.writerows(segments)
        else:  # tag
            with out_path.open("w", encoding="utf-8") as f:
                for seg in segments:
                    f.write(f"[recognized][{seg['id']}] {seg['recognized']}\n")
                    f.write(f"[translated][{seg['id']}] {seg['translated']}\n")

        print(f"[OK] 结果已写入: {out_path}")
        if args.format == "tag":
            print("[HINT] 该文件可直接作为 run_eval.py 的 --vendor 输入。")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[WARN] 用户中断。")
        sys.exit(130)
    except Exception as exc:
        print(f"[ERROR] {exc}")
        raise
