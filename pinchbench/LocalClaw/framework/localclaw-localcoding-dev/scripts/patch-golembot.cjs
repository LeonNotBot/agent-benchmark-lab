"use strict";
// 构建期为 golembot@0.47.1 注入 localclaw 功能补丁（替代脆弱的 pnpm patch）。
// 在 golembot 被复制到 dist-server/node_modules 后调用，对 dist 文件做精确
// 字符串替换。每个补丁以特征串判断是否已应用，保证幂等、可重复执行。
//
// 覆盖 5 项功能：
//   1. dingtalk.js  —— Stream 模式 picture/richText 图片经 messageFiles/download 下载
//                      + 语音(audio)取 content.recognition 服务端 ASR 文字
//                      + 文件(file)经 messageFiles/download 下载原始字节填充 files
//   2. wecom.js     —— 企微图片下载与解密 + 图文混排(message.mixed)
//                      + 语音(message.voice)取 body.voice.content 转写文字
//                      + 文件(message.file)用 SDK downloadFile 解密下载填充 files
//   3. gateway.js   —— 流式输出代码围栏(```)保护，避免半截 fence 渲染破损
//   4. weixin.js    —— iLink 会话超时(errcode!=0)时停止轮询并提示重新扫码
//                      + 文件(item.type=4)best-effort 下载(CDN+AES/直连)填充 files
//   5. feishu.js    —— 语音(audio)经 speech_to_text file_recognize 转写文字
const path = require("path");
const { patchDingtalk } = require("./golembot-patches/dingtalk.cjs");
const { patchWecom } = require("./golembot-patches/wecom.cjs");
const { patchGateway } = require("./golembot-patches/gateway.cjs");
const { patchWeixin } = require("./golembot-patches/weixin.cjs");
const { patchFeishuVoice } = require("./golembot-patches/feishu.cjs");

/**
 * 对复制到 dist-server 的 golembot 目录应用全部功能补丁。
 * @param {string} golembotDir golembot 包根目录（含 dist/）
 */
function patchGolembotFeatures(golembotDir) {
  const ch = path.join(golembotDir, "dist", "channels");
  patchDingtalk(path.join(ch, "dingtalk.js"));
  patchWecom(path.join(ch, "wecom.js"));
  patchGateway(path.join(golembotDir, "dist", "gateway.js"));
  patchWeixin(path.join(ch, "weixin.js"));
  patchFeishuVoice(path.join(ch, "feishu.js"));
}

module.exports = { patchGolembotFeatures };
