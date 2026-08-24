"use strict";
const { patchFile } = require("./util.cjs");

// weixin.js: iLink 长轮询若返回 errcode != 0（bot_token 有效但会话过期），
// 原代码会继续轮询导致死循环。改为停止轮询并提示重新扫码。
function patchWeixin(file) {
  const old = `                const data = (await resp.json());
                if (data.get_updates_buf) {
                    this.syncBuffer = data.get_updates_buf;
                }`;
  const next = `                const data = (await resp.json());
                // iLink session timeout: errcode -14 = bot_token valid but long-poll session stale
                if (typeof data.errcode === "number" && data.errcode !== 0) {
                    console.error(\`[weixin] iLink error \${data.errcode}: \${data.errmsg || ""}. Stopping poll, please re-scan QR.\`);
                    this.running = false;
                    return;
                }
                if (data.get_updates_buf) {
                    this.syncBuffer = data.get_updates_buf;
                }`;
  // ── 文件消息接收（best-effort）──
  // iLink 私有 API 逆向：file_item 结构靠推测，参照 image_item 的 CDN + AES 解密
  // 路径尝试下载；拿不到加密参数则回退直连 file_url。任何失败都回退占位文本，
  // 绝不吞消息。下载成功则填充 files 供 gateway 透传给 AI 读取内容。

  // parseMessage 内声明 files 数组（与 images 并列）。
  const filesDeclOld = `        let text = '';
        const images = [];`;
  const filesDeclNew = `        let text = '';
        const images = [];
        const files = [];`;

  // case 4：原实现只写占位文本，改为尝试下载文件字节。
  const case4Old = `                case 4: {
                    const fileItem = item.file_item;
                    const fileName = fileItem?.file_url || '';
                    text += fileName ? \`(file: \${fileName})\` : '(file)';
                    break;
                }`;
  const case4New = `                case 4: {
                    const fileItem = item.file_item;
                    let downloaded = false;
                    if (fileItem) {
                        try {
                            const f = await this.downloadWeixinFile(fileItem);
                            if (f) {
                                files.push(f);
                                downloaded = true;
                            }
                        }
                        catch (e) {
                            console.error('[weixin] Failed to download file:', e.message);
                        }
                    }
                    if (!downloaded) {
                        const fn = fileItem?.file_name || fileItem?.file_url || '';
                        text += fn ? \`(file: \${fn})\` : '(file)';
                    }
                    break;
                }`;

  // 空消息判断 + channelMsg 透传 files。
  const emptyOld = `        if (!text && images.length === 0)
            return null;
        if (!text && images.length > 0)
            text = '(image)';`;
  const emptyNew = `        if (!text && images.length === 0 && files.length === 0)
            return null;
        if (!text && images.length > 0)
            text = '(image)';`;

  const channelMsgOld = `            images: images.length > 0 ? images : undefined,
            raw: update,
        };`;
  const channelMsgNew = `            images: images.length > 0 ? images : undefined,
            files: files.length > 0 ? files : undefined,
            raw: update,
        };`;

  patchFile(file, "downloadWeixinFile", [
    [old, next],
    [filesDeclOld, filesDeclNew],
    [case4Old, case4New],
    [emptyOld, emptyNew],
    [channelMsgOld, channelMsgNew],
    fileMethodPair(),
  ], "weixin.js");
}

// downloadWeixinFile 方法体（逐行数组，便于分段维护与控制单次编辑长度）。
const METHOD_LINES = [
  "    async downloadWeixinFile(fileItem) {",
  "        const media = fileItem.media;",
  "        const encryptQueryParam = media?.encrypt_query_param;",
  "        let data;",
  "        if (encryptQueryParam) {",
  "            // CDN 加密下载 + AES-128-ECB 解密（与图片同套）。",
  "            const cdnUrl = `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;",
  "            const resp = await fetch(cdnUrl);",
  "            if (!resp.ok)",
  "                throw new Error(`CDN download failed: HTTP ${resp.status}`);",
  "            const encrypted = Buffer.from(await resp.arrayBuffer());",
  "            if (encrypted.length === 0)",
  "                return null;",
  "            const aesKeyHex = fileItem.aeskey;",
  "            let key;",
  "            if (aesKeyHex && aesKeyHex.length === 32) {",
  "                key = Buffer.from(aesKeyHex, 'hex');",
  "            }",
  "            else {",
  "                const aesKeyB64 = media?.aes_key;",
  "                if (!aesKeyB64)",
  "                    return null;",
  "                const decoded = Buffer.from(aesKeyB64, 'base64');",
  "                if (decoded.length === 16)",
  "                    key = decoded;",
  "                else if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii')))",
  "                    key = Buffer.from(decoded.toString('ascii'), 'hex');",
  "                else",
  "                    return null;",
  "            }",
  "            const decipher = createDecipheriv('aes-128-ecb', key, null);",
  "            data = Buffer.concat([decipher.update(encrypted), decipher.final()]);",
  "        }",
  "        else if (fileItem.file_url && /^https?:\\/\\//.test(fileItem.file_url)) {",
  "            // 回退：直连 file_url（明文）。",
  "            const resp = await fetch(fileItem.file_url);",
  "            if (!resp.ok)",
  "                throw new Error(`file fetch HTTP ${resp.status}`);",
  "            data = Buffer.from(await resp.arrayBuffer());",
  "        }",
  "        else {",
  "            return null;",
  "        }",
  "        if (!data || data.length === 0)",
  "            return null;",
  "        if (data.length > 50 * 1024 * 1024)",
  "            throw new Error('file too large (>50MB)');",
  "        // 净化文件名，防止 index.js 落盘时路径穿越。",
  "        const safeName = String(fileItem.file_name || 'weixin-file').replace(/[\\\\/]/g, '_');",
  "        return { mimeType: 'application/octet-stream', data, fileName: safeName };",
  "    }",
];

module.exports = { patchWeixin };

// 在 downloadImage 之后（类尾 } 之前）插入 downloadWeixinFile。
// AES key 解析逻辑与 downloadImage 保持一致（hex/base64 两种编码）。
function fileMethodPair() {
  const anchorOld = `        return { mimeType, data, fileName: \`weixin-image.\${ext}\` };
    }
}`;
  const method = METHOD_LINES.join("\n");
  const anchorNew = `        return { mimeType, data, fileName: \`weixin-image.\${ext}\` };
    }
${method}
}`;
  return [anchorOld, anchorNew];
}
