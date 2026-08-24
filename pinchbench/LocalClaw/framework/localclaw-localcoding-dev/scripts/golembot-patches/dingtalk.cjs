"use strict";
const { patchFile } = require("./util.cjs");

// dingtalk.js: Stream 模式 picture 消息给的是 downloadCode（非直接 URL），
// 需先调 messageFiles/download 换取真实 downloadUrl 再下载。新增 downloadByCode
// 辅助方法，并替换 picture / richText 两处下载逻辑；同时补 sendStatus/updateStatus/
// clearStatus（no-op，钉钉无法编辑消息）与 stop() 的 disconnect。
function patchDingtalk(file) {
  const pictureOld = `            else if (msgtype === 'picture') {
                // DingTalk picture messages include a download URL
                const picURL = data.content?.downloadCode || data.content?.picURL;
                if (picURL) {
                    try {
                        const accessToken = await this.dwClient?.getAccessToken?.();
                        const headers = {};
                        if (accessToken)
                            headers['x-acs-dingtalk-access-token'] = accessToken;
                        const resp = await fetch(picURL, { headers });
                        if (resp.ok) {
                            const buf = Buffer.from(await resp.arrayBuffer());
                            const ct = resp.headers.get('content-type') || 'image/jpeg';
                            images.push({ mimeType: ct.split(';')[0], data: buf });
                        }
                    }
                    catch (e) {
                        console.error('[dingtalk] Failed to download image:', e.message);
                    }
                }
                text = '(image)';
            }`;
  const pictureNew = `            else if (msgtype === 'picture') {
                // Stream 模式下 picture 消息给的是 downloadCode（非直接 URL），
                // 需先调 messageFiles/download 换取真实 downloadUrl 再下载。
                const code = data.content?.downloadCode;
                const directUrl = data.content?.picURL;
                try {
                    const img = await this.downloadByCode(code, directUrl, data.robotCode || data.chatbotUserId);
                    if (img)
                        images.push(img);
                }
                catch (e) {
                    console.error('[dingtalk] Failed to download image:', e.message);
                }
                text = '(image)';
            }`;

  const richOld = `                        if (section.downloadCode || section.picURL) {
                            const picURL = section.downloadCode || section.picURL;
                            try {
                                const accessToken = await this.dwClient?.getAccessToken?.();
                                const headers = {};
                                if (accessToken)
                                    headers['x-acs-dingtalk-access-token'] = accessToken;
                                const resp = await fetch(picURL, { headers });
                                if (resp.ok) {
                                    const buf = Buffer.from(await resp.arrayBuffer());
                                    const ct = resp.headers.get('content-type') || 'image/jpeg';
                                    images.push({ mimeType: ct.split(';')[0], data: buf });
                                }
                            }
                            catch (e) {
                                console.error('[dingtalk] Failed to download rich text image:', e.message);
                            }
                        }`;
  const richNew = `                        if (section.downloadCode || section.picURL) {
                            try {
                                const img = await this.downloadByCode(section.downloadCode, section.picURL, data.robotCode || data.chatbotUserId);
                                if (img)
                                    images.push(img);
                            }
                            catch (e) {
                                console.error('[dingtalk] Failed to download rich text image:', e.message);
                            }
                        }`;

  // 语音消息(msgtype='audio')：钉钉 Stream 模式在 content.recognition 提供
  // 服务端 ASR 文字。原实现落入 else 分支被静默丢弃，用户发语音后前端收不到
  // 任何内容。这里在 else 之前插入 audio 分支，取 recognition 作为文本；
  // 缺失时回退占位符，保证消息不被吞掉。
  const elseOld = `            else {
                // Unsupported message type — skip
                this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
                return;
            }`;
  const elseNew = `            else if (msgtype === 'audio') {
                // 钉钉语音：content.recognition 是服务端语音识别文字（可能为空）。
                const recognized = (data.content?.recognition || '').trim();
                text = recognized || '(语音消息，未能识别内容)';
            }
            else if (msgtype === 'file') {
                // 钉钉文件：Stream 模式给 downloadCode（非直接 URL），需先调
                // messageFiles/download 换真实 downloadUrl 再下载原始文件字节。
                const code = data.content?.downloadCode;
                const fileName = data.content?.fileName || data.content?.spaceId || 'dingtalk-file';
                try {
                    const f = await this.downloadFileByCode(code, data.robotCode || data.chatbotUserId, fileName);
                    if (f)
                        files.push(f);
                }
                catch (e) {
                    console.error('[dingtalk] Failed to download file:', e.message);
                }
                text = text || \`(file: \${fileName})\`;
            }
            else {
                // Unsupported message type — skip
                this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
                return;
            }`;

  // files 数组声明：原实现只有 images，新增 file 分支需要独立的 files 收集。
  const filesDeclOld = `            let text = '';
            const images = [];`;
  const filesDeclNew = `            let text = '';
            const images = [];
            const files = [];`;

  // 空消息判断 + channelMsg 增补 files 字段：文件消息可能无文本无图片，
  // 若不把 files 计入判断会被当空消息丢弃；channelMsg 需透传 files 给 gateway。
  const emitOld = `            if (!text && images.length === 0)
                return;`;
  const emitNew = `            if (!text && images.length === 0 && files.length === 0)
                return;`;

  const channelMsgOld = `                images: images.length > 0 ? images : undefined,
                mentioned: isGroup ? true : undefined,`;
  const channelMsgNew = `                images: images.length > 0 ? images : undefined,
                files: files.length > 0 ? files : undefined,
                mentioned: isGroup ? true : undefined,`;

  const stopOld = `    async stop() {
        this.dwClient = null;
    }`;
  const stopNew = `    async downloadByCode(downloadCode, directUrl, robotCode) {
        let url = directUrl;
        const accessToken = await this.dwClient?.getAccessToken?.();
        if (downloadCode) {
            const headers = { 'Content-Type': 'application/json' };
            if (accessToken)
                headers['x-acs-dingtalk-access-token'] = accessToken;
            const resp = await fetch('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
                method: 'POST',
                headers,
                body: JSON.stringify({ downloadCode, robotCode }),
            });
            if (!resp.ok)
                throw new Error(\`messageFiles/download HTTP \${resp.status}\`);
            const json = await resp.json();
            url = json.downloadUrl;
        }
        if (!url)
            return null;
        const imgResp = await fetch(url);
        if (!imgResp.ok)
            throw new Error(\`image fetch HTTP \${imgResp.status}\`);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const ct = imgResp.headers.get('content-type') || 'image/jpeg';
        return { mimeType: ct.split(';')[0], data: buf };
    }
    async downloadFileByCode(downloadCode, robotCode, fileName) {
        if (!downloadCode)
            return null;
        const accessToken = await this.dwClient?.getAccessToken?.();
        const headers = { 'Content-Type': 'application/json' };
        if (accessToken)
            headers['x-acs-dingtalk-access-token'] = accessToken;
        const resp = await fetch('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
            method: 'POST',
            headers,
            body: JSON.stringify({ downloadCode, robotCode }),
        });
        if (!resp.ok)
            throw new Error(\`messageFiles/download HTTP \${resp.status}\`);
        const json = await resp.json();
        const url = json.downloadUrl;
        if (!url)
            return null;
        const fileResp = await fetch(url);
        if (!fileResp.ok)
            throw new Error(\`file fetch HTTP \${fileResp.status}\`);
        // 防内存溢出：>50MB 的文件跳过（下载完再判长度，钉钉 downloadUrl 无 content-length 保证）。
        const buf = Buffer.from(await fileResp.arrayBuffer());
        if (buf.length > 50 * 1024 * 1024)
            throw new Error('file too large (>50MB)');
        const ct = fileResp.headers.get('content-type') || 'application/octet-stream';
        // 净化文件名：去掉路径分隔符，防止 index.js 落盘时路径穿越。
        const safeName = String(fileName || 'dingtalk-file').replace(/[\\\\/]/g, '_');
        return { mimeType: ct.split(';')[0], data: buf, fileName: safeName };
    }
    async sendStatus(_msg, _text) {
        return \`noop-\${Date.now()}\`;
    }
    async updateStatus(_msg, _statusId, _text) {
    }
    async clearStatus(_msg, _statusId) {
    }
    async stop() {
        if (this.dwClient) {
            try {
                this.dwClient.disconnect?.();
            }
            catch {
                // best effort: ensure the stream socket is torn down
            }
            this.dwClient = null;
        }
    }`;

  patchFile(file, "downloadFileByCode", [
    [pictureOld, pictureNew],
    [richOld, richNew],
    [filesDeclOld, filesDeclNew],
    [elseOld, elseNew],
    [emitOld, emitNew],
    [channelMsgOld, channelMsgNew],
    [stopOld, stopNew],
  ], "dingtalk.js");
}

module.exports = { patchDingtalk };
