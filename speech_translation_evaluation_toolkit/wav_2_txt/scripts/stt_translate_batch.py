#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LenovoSpeechSDK 语音识别+翻译批量处理脚本
输入：WAV 音频文件
输出：[recognized][n] 中文 + [translated][n] 英文的 TXT 文件
"""
import argparse
import ctypes
import json
import os
import sys
import time
import threading
from pathlib import Path

SDK_DIR = r"C:\Program Files\Lenovo\Lenovo Speech\2.1.0.119"
SDK_DLL = os.path.join(SDK_DIR, "LenovoSpeechSDK.dll")

class STTTranslator:
    def __init__(self):
        os.add_dll_directory(SDK_DIR)
        self.dll = ctypes.CDLL(SDK_DLL)
        self.results = []  # [(dataID, recognized_text, translated_text), ...]
        self.events = {"connected": False, "started": False, "finished": False}
        self.lock = threading.Lock()
        self.temp_translations = {}  # dataID -> 最新的增量翻译

        # 定义回调
        self.ServiceStatusCallback = ctypes.CFUNCTYPE(None, ctypes.c_char_p)
        self.cb_connect = self.ServiceStatusCallback(self._connect_cb)
        self.cb_data = self.ServiceStatusCallback(self._data_cb)
        self.cb_start = self.ServiceStatusCallback(self._start_cb)
        self.cb_stop = self.ServiceStatusCallback(self._stop_cb)

    def log(self, msg):
        sys.stdout.buffer.write(f"{msg}\n".encode("utf-8"))
        sys.stdout.buffer.flush()

    def _connect_cb(self, jb):
        try:
            d = json.loads(jb.decode("utf-8"))
            with self.lock:
                self.events["connected"] = d.get("isConnected") and d.get("serviceStatus") == "ready"
        except: pass

    def _data_cb(self, jb):
        try:
            d = json.loads(jb.decode("utf-8"))
            dtype = d.get("dataType", "")
            data_id = d.get("dataID", "")
            data_text = d.get("data", "")

            if dtype == "recognized":
                # 中文识别完成
                self.log(f"  [中文 {data_id}] {data_text[:60]}...")
                with self.lock:
                    # 暂存中文，等待对应的翻译
                    self.temp_translations[data_id] = {"zh": data_text, "en": None}

            elif dtype == "translated":
                # 英文翻译完成（最终版本）
                self.log(f"  [英文 {data_id}] {data_text[:60]}...")
                with self.lock:
                    if data_id in self.temp_translations:
                        self.temp_translations[data_id]["en"] = data_text
                        # 配对完成，加入结果
                        zh = self.temp_translations[data_id]["zh"]
                        en = data_text
                        self.results.append((data_id, zh, en))
                    else:
                        # 中文还没到，先存翻译
                        self.temp_translations[data_id] = {"zh": None, "en": data_text}

            elif "translat" in dtype.lower() and dtype != "translated":
                # 增量翻译（incompleteSentenceTranslated 等），忽略
                pass
        except Exception as e:
            self.log(f"[data_cb error] {e}")

    def _start_cb(self, jb):
        try:
            d = json.loads(jb.decode("utf-8"))
            with self.lock:
                if d.get("status") == "succeed":
                    self.events["started"] = True
                elif d.get("errorCode", 0) != 0:
                    self.log(f"  ❌ StartSTT 失败: {json.dumps(d, ensure_ascii=False)}")
        except: pass

    def _stop_cb(self, jb):
        with self.lock:
            self.events["finished"] = True

    def connect(self):
        self.dll.Initialize.restype = ctypes.c_bool
        self.dll.Initialize()

        self.dll.ConnectService.argtypes = [ctypes.c_char_p, self.ServiceStatusCallback]
        self.dll.ConnectService.restype = ctypes.c_bool
        param = json.dumps({"appCode": "", "appName": "STTTranslate"}).encode("utf-8")
        self.dll.ConnectService(param, self.cb_connect)

        for _ in range(20):
            time.sleep(0.5)
            with self.lock:
                if self.events["connected"]:
                    return True
        return False

    def disconnect(self):
        self.dll.DisconnectService.restype = ctypes.c_bool
        self.dll.DisconnectService()

    def process_audio(self, wav_path, timeout_sec=600):
        """
        处理单个音频文件，返回 [(dataID, zh_text, en_text), ...]
        """
        self.results.clear()
        self.temp_translations.clear()
        self.events["started"] = False
        self.events["finished"] = False

        self.log(f"\n=== 处理音频: {os.path.basename(wav_path)} ===")

        # 注册数据回调
        self.dll.ReceiveSTTData.argtypes = [self.ServiceStatusCallback]
        self.dll.ReceiveSTTData.restype = ctypes.c_bool
        self.dll.ReceiveSTTData(self.cb_data)

        # 启动 STT + 翻译
        stt_param = {
            "dataCollectionMode": "FILE",
            "inputFilePath": wav_path,
            "language": "zh-CN",
            "isSaveSoundFile": False,
            "isSaveSTTData": False,
            "isTranslate": True,
            "translateParameter": {"targetLanguage": "en-US"}
        }

        self.dll.StartSTTService.argtypes = [ctypes.c_char_p, self.ServiceStatusCallback]
        self.dll.StartSTTService.restype = ctypes.c_bool
        self.dll.StartSTTService(json.dumps(stt_param).encode("utf-8"), self.cb_start)

        # 等待启动
        for _ in range(20):
            time.sleep(0.5)
            with self.lock:
                if self.events["started"]:
                    break

        if not self.events["started"]:
            self.log("  ❌ STT 未启动")
            return []

        self.log("  ✅ STT 已启动，等待结果...")

        # 等待完成
        t0 = time.time()
        while time.time() - t0 < timeout_sec:
            time.sleep(2)
            with self.lock:
                if self.events["finished"]:
                    break

        # 停止
        self.dll.StopSTTService.argtypes = [self.ServiceStatusCallback]
        self.dll.StopSTTService.restype = ctypes.c_bool
        self.dll.StopSTTService(self.cb_stop)
        time.sleep(1)

        with self.lock:
            results = sorted(self.results, key=lambda x: int(x[0]))
            self.log(f"  ✅ 完成，共 {len(results)} 对中英文本")
            return results

def main():
    parser = argparse.ArgumentParser(description="STT + 翻译批量处理")
    parser.add_argument("input", help="输入 WAV 文件或目录")
    parser.add_argument("--output-dir", default="output", help="输出目录（默认 output/）")
    parser.add_argument("--timeout", type=int, default=600, help="单文件超时秒数（默认 600）")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)

    # 收集待处理文件
    if input_path.is_file():
        wav_files = [input_path]
    elif input_path.is_dir():
        wav_files = sorted(input_path.glob("*.wav"))
    else:
        print(f"❌ 路径不存在: {input_path}")
        return 1

    if not wav_files:
        print(f"❌ 未找到 WAV 文件: {input_path}")
        return 1

    print(f"找到 {len(wav_files)} 个 WAV 文件\n")

    # 初始化 STT
    translator = STTTranslator()
    if not translator.connect():
        print("❌ 连接 LenovoSpeechSDK 失败")
        return 1
    print("✅ 已连接 LenovoSpeechSDK\n")

    # 批量处理
    for i, wav_file in enumerate(wav_files, 1):
        print(f"[{i}/{len(wav_files)}] {wav_file.name}")

        results = translator.process_audio(str(wav_file), args.timeout)

        if not results:
            print(f"  ⚠️ 未获取到结果，跳过\n")
            continue

        # 写入输出文件
        out_file = output_dir / f"{wav_file.stem}.wav.txt"
        with open(out_file, "w", encoding="utf-8") as f:
            for data_id, zh, en in results:
                idx = int(data_id) + 1  # 从 1 开始编号
                f.write(f"[recognized][{idx}] {zh}\n")
                f.write(f"[translated][{idx}] {en}\n")

        print(f"  ✅ 已保存: {out_file}\n")

    translator.disconnect()
    print("✅ 全部完成")
    return 0

if __name__ == "__main__":
    sys.exit(main())
