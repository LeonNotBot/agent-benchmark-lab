"use strict";
const { patchFile } = require("./util.cjs");

// gateway.js: 流式输出在 \n\n 段落边界 flush 时，若 `complete` 含奇数个 ``` 代码
// 围栏，说明 fenced code block 跨段未闭合，此时 flush 会产生半截 ``` 渲染破损
// (尤其微信每条回复是独立不可变消息)。改为仅在 fence 成对(偶数)时才 flush。
function patchGateway(file) {
  const old = `                    if (parts.length > 1) {
                        // Everything except the last part is complete paragraphs — send them
                        const complete = parts.slice(0, -1).join('\\n\\n');
                        buffer = parts[parts.length - 1];
                        chunkIdx++;
                        console.log(\`[stream-debug] chunk #\${chunkIdx} (paragraph): "\${complete.trim().slice(0, 80)}…" [\${complete.length} chars]\`);
                        await sendChunk(complete);
                    }`;
  const next = `                    if (parts.length > 1) {
                        // Everything except the last part is complete paragraphs — send them
                        const complete = parts.slice(0, -1).join('\\n\\n');
                        // Code-fence guard: odd number of \`\`\` means a fenced block spans
                        // the paragraph boundary and is still open; defer flush until it closes.
                        const fenceCount = (complete.match(/\`\`\`/g) || []).length;
                        if (fenceCount % 2 === 0) {
                            buffer = parts[parts.length - 1];
                            chunkIdx++;
                            console.log(\`[stream-debug] chunk #\${chunkIdx} (paragraph): "\${complete.trim().slice(0, 80)}…" [\${complete.length} chars]\`);
                            await sendChunk(complete);
                        }
                    }`;
  patchFile(file, "Code-fence guard", [[old, next]], "gateway.js");
}

module.exports = { patchGateway };
