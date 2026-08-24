"use strict";
const { patchFile } = require("./util.cjs");

// feishu.js: 语音消息(msgType='audio')原实现把 opus 音频下载为 voice.opus 文件
// 附件 + 占位文本 '(audio)'，前端/AI 无法解析二进制 opus，等于收到语音却读不出
// 内容。这里改为下载后转写成文字作为消息文本，不再把 opus 当文件塞给 AI。
//
// 飞书 ASR(file_recognize) 只接受 pcm，而 IM 语音下载下来是 opus(ogg 容器)，
// 故必须先在进程内用 WASM 解码器(ogg-opus-decoder)把 opus 解成 PCM Float32
// (48kHz)，再降采样到 16kHz、转 16-bit PCM、base64，最后以 format='pcm' 调
// file_recognize。ogg-opus-decoder 是纯 WASM 无 native 编译，已加入运行时复制清单。
function patchFeishuVoice(file) {
  const audioOld = `            else if (msgType === 'audio') {
                const fileKey = parsedContent.file_key;
                if (fileKey) {
                    try {
                        const file = await this.downloadFile(message.message_id, fileKey, 'voice.opus');
                        files.push(file);
                        text = '(audio)';
                    }
                    catch (e) {
                        console.error('[feishu] Failed to download audio:', e.message);
                        return;
                    }
                }
            }`;
  const audioNew = `            else if (msgType === 'audio') {
                const fileKey = parsedContent.file_key;
                if (fileKey) {
                    try {
                        const file = await this.downloadFile(message.message_id, fileKey, 'voice.opus');
                        const recognized = await this.recognizeAudio(file.data);
                        text = recognized || '(语音消息，未能识别内容)';
                    }
                    catch (e) {
                        console.error('[feishu] voice recognize failed:', (e && e.message) || e);
                        text = '(语音消息，未能识别内容)';
                    }
                }
            }`;

  patchFile(file, "recognizeAudio", [
    [audioOld, audioNew],
    stopPair(),
  ], "feishu.js");
}

// 在 stop() 前注入 recognizeAudio：opus(ogg) -> PCM(16k/16-bit) -> 飞书 ASR。
// 复用 adapter 已有的 tokenManager 与 openApiUrl，风格与 downloadFile 一致。
function stopPair() {
  const stopOld = `    async stop() {
        // WSClient doesn't expose a clean close method in current SDK version;
        // setting to null allows GC to collect.
        this.wsClient = null;
        this.client = null;
    }`;
  const stopNew = `    async recognizeAudio(audioData) {
        const buf = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData);
        // 1. opus(ogg 容器) -> PCM Float32 48kHz（纯 WASM 解码，无 native 依赖）
        const { OggOpusDecoder } = await import('ogg-opus-decoder');
        const decoder = new OggOpusDecoder();
        await decoder.ready;
        let pcm16;
        try {
            const decoded = await decoder.decodeFile(new Uint8Array(buf));
            const f32 = decoded.channelData[0] || new Float32Array(0);
            const srcRate = decoded.sampleRate || 48000;
            // 2. 降采样到 16kHz 并转 16-bit PCM（飞书 ASR 仅支持 pcm/16k_auto）
            const ratio = srcRate / 16000;
            const outLen = Math.floor(f32.length / ratio);
            pcm16 = Buffer.alloc(outLen * 2);
            for (let i = 0; i < outLen; i++) {
                let s = f32[Math.floor(i * ratio)] || 0;
                s = s < -1 ? -1 : s > 1 ? 1 : s;
                pcm16.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, i * 2);
            }
        }
        finally {
            decoder.free();
        }
        if (!pcm16 || pcm16.length === 0)
            return '';
        // 3. 调飞书 file_recognize（一次性识别，≤60s）。
        // speech_to_text 是 AI 能力接口，网关 QPS 阈值很低，单条也可能撞
        // 99991400(request trigger frequency limit)。对该限流码做指数退避重试。
        const token = await this.client.tokenManager.getTenantAccessToken();
        const speechB64 = pcm16.toString('base64');
        const maxAttempts = 4;
        let lastErr = '';
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const resp = await fetch(this.openApiUrl('/open-apis/speech_to_text/v1/speech/file_recognize'), {
                method: 'POST',
                headers: {
                    Authorization: \`Bearer \${token}\`,
                    'Content-Type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({
                    speech: { speech: speechB64 },
                    config: { file_id: \`\${Date.now()}\`, format: 'pcm', engine_type: '16k_auto' },
                }),
            });
            const bodyText = await resp.text();
            let json;
            try { json = JSON.parse(bodyText); } catch { json = null; }
            // 限流(99991400)：退避后重试（500ms/1s/2s）。
            if (json && json.code === 99991400 && attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
                lastErr = \`code \${json.code}: \${json.msg}\`;
                continue;
            }
            if (!resp.ok)
                throw new Error(\`HTTP \${resp.status}: \${bodyText.slice(0, 200)}\`);
            if (!json)
                throw new Error(\`bad JSON: \${bodyText.slice(0, 200)}\`);
            if (json.code !== 0)
                throw new Error(\`code \${json.code}: \${json.msg}\`);
            return (json.data?.recognition_text || '').trim();
        }
        throw new Error(\`限流重试仍失败: \${lastErr}\`);
    }
    async stop() {
        // WSClient doesn't expose a clean close method in current SDK version;
        // setting to null allows GC to collect.
        this.wsClient = null;
        this.client = null;
    }`;
  return [stopOld, stopNew];
}

module.exports = { patchFeishuVoice };