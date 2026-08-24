"use strict";
// wecom.js 的两个较大替换块：handleFrame(改 async + 图片下载/图文混排) 与
// downloadWecomImage 方法、reply 后插入 status no-op。拆出以控制单文件长度。

function handleFramePairs() {
  const old = `    handleFrame(frame, onMessage, fallbackText) {
        const body = frame?.body ?? frame;
        const msgId = body.msgid || body.msgId || body.message_id;
        if (msgId) {
            if (this.seenMsgIds.has(msgId))
                return;
            this.seenMsgIds.add(msgId);
            if (this.seenMsgIds.size > WecomAdapter.MAX_SEEN) {
                const entries = [...this.seenMsgIds];
                this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
            }
        }
        const text = body.text?.content ||
            body.content?.text ||
            (typeof body.text === 'string' ? body.text : undefined) ||
            fallbackText ||
            '';
        if (!text)
            return;`;
  const next = `    async downloadWecomImage(image) {
        const url = image?.url;
        const aeskey = image?.aeskey;
        if (!url)
            return null;
        const resp = await fetch(url);
        if (!resp.ok)
            throw new Error(\`HTTP \${resp.status}\`);
        let data = Buffer.from(await resp.arrayBuffer());
        if (data.length === 0)
            return null;
        if (aeskey && this.decryptFile) {
            data = this.decryptFile(data, aeskey);
        }
        const isPng = data[0] === 0x89 && data[1] === 0x50;
        const isGif = data[0] === 0x47 && data[1] === 0x49;
        const mimeType = isPng ? 'image/png' : isGif ? 'image/gif' : 'image/jpeg';
        return { mimeType, data };
    }
    async downloadWecomFile(file) {
        const url = file?.url;
        const aeskey = file?.aeskey;
        if (!url)
            return null;
        // 优先用 SDK 的 downloadFile（内建解密 + 文件名解析）；返回 { buffer, filename }。
        let data;
        let fileName = file?.filename || file?.name;
        if (this.wsClient?.downloadFile) {
            const res = await this.wsClient.downloadFile(url, aeskey);
            data = res?.buffer;
            fileName = fileName || res?.filename;
        }
        else {
            // 回退：直连下载 + 复用 decryptFile 解密（与图片同套 AES-256-CBC）。
            const resp = await fetch(url);
            if (!resp.ok)
                throw new Error(\`HTTP \${resp.status}\`);
            data = Buffer.from(await resp.arrayBuffer());
            if (aeskey && this.decryptFile)
                data = this.decryptFile(data, aeskey);
        }
        if (!data || data.length === 0)
            return null;
        if (data.length > 50 * 1024 * 1024)
            throw new Error('file too large (>50MB)');
        // 净化文件名，防止 index.js 落盘时路径穿越。
        const safeName = String(fileName || 'wecom-file').replace(/[\\\\/]/g, '_');
        return { mimeType: 'application/octet-stream', data, fileName: safeName };
    }
    async handleFrame(frame, onMessage, fallbackText) {
        const body = frame?.body ?? frame;
        const msgId = body.msgid || body.msgId || body.message_id;
        if (msgId) {
            if (this.seenMsgIds.has(msgId))
                return;
            this.seenMsgIds.add(msgId);
            if (this.seenMsgIds.size > WecomAdapter.MAX_SEEN) {
                const entries = [...this.seenMsgIds];
                this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
            }
        }
        const images = [];
        const imageContents = [];
        if (body.image)
            imageContents.push(body.image);
        if (body.mixed?.msg_item && Array.isArray(body.mixed.msg_item)) {
            for (const item of body.mixed.msg_item) {
                if (item?.msgtype === 'image' && item.image)
                    imageContents.push(item.image);
            }
        }
        for (const ic of imageContents) {
            try {
                const img = await this.downloadWecomImage(ic);
                if (img)
                    images.push(img);
            }
            catch (e) {
                console.error('[wecom] Failed to download image:', e.message);
            }
        }
        const files = [];
        const fileContents = [];
        if (body.file)
            fileContents.push(body.file);
        if (body.mixed?.msg_item && Array.isArray(body.mixed.msg_item)) {
            for (const item of body.mixed.msg_item) {
                if (item?.msgtype === 'file' && item.file)
                    fileContents.push(item.file);
            }
        }
        for (const fc of fileContents) {
            try {
                const f = await this.downloadWecomFile(fc);
                if (f)
                    files.push(f);
            }
            catch (e) {
                console.error('[wecom] Failed to download file:', e.message);
            }
        }
        let text = body.text?.content ||
            body.content?.text ||
            (typeof body.text === 'string' ? body.text : undefined) ||
            body.voice?.content ||
            '';
        if (!text && body.mixed?.msg_item && Array.isArray(body.mixed.msg_item)) {
            text = body.mixed.msg_item
                .filter((it) => it?.msgtype === 'text' && it.text?.content)
                .map((it) => it.text.content)
                .join(' ')
                .trim();
        }
        if (!text)
            text = (images.length > 0 ? '(image)' : fallbackText) || '';
        if (!text && images.length === 0 && files.length === 0)
            return;`;
  return [[old, next]];
}

function stopPairs() {
  const channelMsgOld = `            chatType: isGroup ? 'group' : 'dm',
            text,
            messageId: msgId,
            mentioned: body.mentioned,
            raw: frame,
        };
        onMessage(channelMsg);`;
  const channelMsgNew = `            chatType: isGroup ? 'group' : 'dm',
            text,
            messageId: msgId,
            images: images.length > 0 ? images : undefined,
            files: files.length > 0 ? files : undefined,
            mentioned: body.mentioned,
            raw: frame,
        };
        onMessage(channelMsg);`;

  const replyOld = `        const streamId = \`reply-\${Date.now()}\`;
        await this.wsClient.replyStream(frame, streamId, text, true);
    }
    async send(chatId, text) {`;
  const replyNew = `        const streamId = \`reply-\${Date.now()}\`;
        await this.wsClient.replyStream(frame, streamId, text, true);
    }
    async sendStatus(_msg, _text) {
        return \`noop-\${Date.now()}\`;
    }
    async updateStatus(_msg, _statusId, _text) {
    }
    async clearStatus(_msg, _statusId) {
    }
    async send(chatId, text) {`;

  return [[channelMsgOld, channelMsgNew], [replyOld, replyNew]];
}

module.exports = { handleFramePairs, stopPairs };
