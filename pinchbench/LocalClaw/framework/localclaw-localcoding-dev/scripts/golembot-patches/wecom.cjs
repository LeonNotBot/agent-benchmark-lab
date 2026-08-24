"use strict";
const { patchFile } = require("./util.cjs");

// wecom.js: 新增图片下载与解密(AES-256-CBC) + 图文混排(message.mixed)支持。
// handleFrame 改为 async 以 await 图片下载；新增 downloadWecomImage；补
// sendStatus/updateStatus/clearStatus（no-op）。分多段拼接以控制单段长度。
function patchWecom(file) {
  const initOld = `        if (!WSClient) {
            throw new Error('Invalid @wecom/aibot-node-sdk: WSClient not found');
        }
        const wsOpts = {`;
  const initNew = `        if (!WSClient) {
            throw new Error('Invalid @wecom/aibot-node-sdk: WSClient not found');
        }
        // decryptFile (AES-256-CBC) for downloading received images. Optional —
        // if unavailable, image messages still arrive as '(image)' text.
        this.decryptFile = AiBot.decryptFile || AiBot.default?.decryptFile || null;
        const wsOpts = {`;

  const onOld = `        this.wsClient.on('message.text', (frame) => {
            this.handleFrame(frame, onMessage);
        });
        this.wsClient.on('message.image', (frame) => {
            this.handleFrame(frame, onMessage, '(image)');
        });
        await this.wsClient.connect();`;
  const onNew = `        this.wsClient.on('message.text', (frame) => {
            void this.handleFrame(frame, onMessage);
        });
        this.wsClient.on('message.image', (frame) => {
            void this.handleFrame(frame, onMessage, '(image)');
        });
        this.wsClient.on('message.mixed', (frame) => {
            void this.handleFrame(frame, onMessage, '(image)');
        });
        this.wsClient.on('message.voice', (frame) => {
            // 企微语音：SDK 在 body.voice.content 提供语音转文字结果。
            // handleFrame 会优先取 voice.content，缺失时回退占位符。
            void this.handleFrame(frame, onMessage, '(语音消息，未能识别内容)');
        });
        this.wsClient.on('message.file', (frame) => {
            // 企微文件：body.file 提供加密下载 url + aeskey，交由 handleFrame
            // 用 SDK downloadFile 解密下载后填充 files，AI 侧再读取内容。
            void this.handleFrame(frame, onMessage, '(file)');
        });
        await this.wsClient.connect();`;

  patchFile(file, "downloadWecomImage", [
    [initOld, initNew],
    [onOld, onNew],
    ...handleFramePairs(),
    ...stopPairs(),
  ], "wecom.js");
}

const { handleFramePairs, stopPairs } = require("./wecom-hunks.cjs");

module.exports = { patchWecom };
