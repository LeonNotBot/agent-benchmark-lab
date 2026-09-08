#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""调用 LenovoSpeechWavSTT.dll 对音频做 ASR + 翻译（zh2en / en2zh）。

用 ctypes 直接加载 Windows DLL，回调里逐段收集"原文(RECOGNIZED) + 译文(TRANSLATED)"，
打印并把结果写成 [recognized][n] / [translated][n] 格式的 .wav.txt —— 该格式可直接
喂给 translation_evaluation_toolkit 的 run_eval.py 做对齐与评分。

用法:
  python transcribe_wav.py wav\\CTS-CN-F2F-2019-11-15-3.wav
  python transcribe_wav.py 会议.wav en2zh
  python transcribe_wav.py 会议.wav zh2en 10.110.146.234:18444
  python transcribe_wav.py 会议.wav zh2en --out output/meeting.wav.txt
"""

import argparse
import ctypes
import os
import sys
from pathlib import Path

DLL_DIR = Path(__file__).resolve().parent / "bin"
DEFAULT_URL = "https://10.110.146.234:18444/translate_file?stream=1&direction=zh2en"

STATUS_RECOGNIZED = 0
STATUS_TRANSLATED = 1
STATUS_FINISHED = 2
STATUS_ERROR = 3
STATUS_NAMES = {
    STATUS_RECOGNIZED: "RECOGNIZED",
    STATUS_TRANSLATED: "TRANSLATED",
    STATUS_FINISHED: "FINISHED",
    STATUS_ERROR: "ERROR",
}


def load_dll() -> ctypes.CDLL:
    """加载 DLL；把 bin 目录加入 DLL 搜索路径以防依赖同目录的库。"""
    dll_file = DLL_DIR / "LenovoSpeechWavSTT.dll"
    if not dll_file.exists():
        raise FileNotFoundError(f"DLL 不存在: {dll_file}")
    try:
        # Python 3.8+ 允许显式指定 DLL 搜索目录；DLL 若依赖同目录文件会用到
        os.add_dll_directory(str(DLL_DIR))
    except (AttributeError, OSError):
        pass
    return ctypes.CDLL(str(dll_file))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="通过 LenovoSpeechWavSTT.dll 调用 L20 服务：WAV → 中文识别 + 英文翻译。"
    )
    parser.add_argument("wav", help="本地音频文件路径（wav/mp3/flac/ogg，UTF-8）")
    parser.add_argument(
        "direction", nargs="?", default="zh2en", choices=["zh2en", "en2zh"],
        help="翻译方向，默认 zh2en",
    )
    parser.add_argument(
        "endpoint", nargs="?", default="10.110.146.234:18444",
        help="L20 服务地址 host:port",
    )
    parser.add_argument(
        "--url", default=None,
        help="完整请求 URL（含 https:// 与 query），覆盖默认拼接逻辑",
    )
    parser.add_argument(
        "--out", default=None,
        help="输出 .wav.txt 路径；缺省为 wav 同目录的 <名字>.wav.txt",
    )
    parser.add_argument(
        "--print-only", action="store_true",
        help="只打印结果，不写文件",
    )
    args = parser.parse_args()

    wav_path = Path(args.wav).resolve()
    if not wav_path.exists():
        print(f"[ERROR] 音频文件不存在: {wav_path}")
        return 1

    # 构造请求 URL：--url 优先，否则按 direction/endpoint 拼默认格式
    if args.url:
        url_bytes = args.url.encode("utf-8")
    else:
        url_bytes = (
            f"https://{args.endpoint}/translate_file?stream=1&direction={args.direction}"
        ).encode("utf-8")

    # ---- 加载 DLL 并设置函数签名 ----
    try:
        stt = load_dll()
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] 加载 DLL 失败: {exc}")
        return 1

    CALLBACK = ctypes.CFUNCTYPE(
        None, ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p
    )
    stt.STT_TranscribeWav.argtypes = [
        ctypes.c_char_p, ctypes.c_char_p, CALLBACK, ctypes.c_void_p,
    ]
    stt.STT_TranscribeWav.restype = ctypes.c_int

    # ---- 回调收集结果（同步触发，调用返回时已收齐）----
    segments: dict[int, dict[str, str]] = {}

    def on_event(status: int, text, data_id: int, _userdata) -> None:
        text_str = "" if text is None else text.decode("utf-8", errors="replace")
        if status == STATUS_RECOGNIZED:
            segments.setdefault(data_id, {"recognized": "", "translated": ""})[
                "recognized"
            ] = text_str
        elif status == STATUS_TRANSLATED:
            segments.setdefault(data_id, {"recognized": "", "translated": ""})[
                "translated"
            ] = text_str
        elif status == STATUS_FINISHED:
            print("[INFO] 处理完成（FINISHED）")
        elif status == STATUS_ERROR:
            print(f"[ERROR] 服务端错误: {text_str}")

    cb = CALLBACK(on_event)  # 必须持有引用，防被垃圾回收

    print(f"[INFO] 音频文件: {wav_path}")
    print(f"[INFO] 请求 URL: {url_bytes.decode()}")
    print("[INFO] 正在转写……（文件越长耗时越久）")

    rc = stt.STT_TranscribeWav(
        str(wav_path).encode("utf-8"), url_bytes, cb, None,
    )
    print(f"[INFO] STT_TranscribeWav 返回值: {rc}")

    if rc != 0:
        print("[ERROR] 调用失败（-1=参数非法或请求失败，具体原因看上面回调）")
        return 1

    if not segments:
        print("[WARN] 没有任何识别/译文片段返回。")
        return 0

    # ---- 按段落号排序打印 ----
    print("\n========== 转写 + 翻译结果 ==========")
    for seg in sorted(segments):
        rec = segments[seg]["recognized"]
        trans = segments[seg]["translated"]
        print(f"[recognized][{seg}] {rec}")
        print(f"[translated][{seg}] {trans}")
        print()

    if not args.print_only:
        out_path = Path(args.out) if args.out else Path(str(wav_path) + ".txt")
        out_path = out_path.resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as f:
            for seg in sorted(segments):
                f.write(f"[recognized][{seg}] {segments[seg]['recognized']}\n")
                f.write(f"[translated][{seg}] {segments[seg]['translated']}\n")
        print(f"[OK] 结果已写入: {out_path}")
        print("[HINT] 该文件可直接作为 run_eval.py 的 --vendor 输入。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] {exc}")
        raise
