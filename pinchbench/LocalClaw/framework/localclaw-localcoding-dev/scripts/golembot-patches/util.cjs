"use strict";
// 构建期 golembot 补丁的共享工具：对文件做幂等的精确字符串替换。
const fs = require("fs");

/**
 * @param {string} file 目标文件绝对路径
 * @param {string} marker 已打补丁特征串；存在则整体跳过（幂等）
 * @param {Array<[string,string]>} pairs 精确替换对
 * @param {string} label 日志标签
 */
function patchFile(file, marker, pairs, label) {
  if (!fs.existsSync(file)) {
    console.warn(`  [patch] golembot ${label}: file missing, skip`);
    return;
  }
  let src = fs.readFileSync(file, "utf8");
  if (src.includes(marker)) return; // 已打补丁
  for (const [oldStr, newStr] of pairs) {
    if (!src.includes(oldStr)) {
      console.warn(`  [patch] golembot ${label}: anchor not found, skip one hunk`);
      continue;
    }
    src = src.replace(oldStr, newStr);
  }
  fs.writeFileSync(file, src, "utf8");
  console.log(`  [patch] golembot ${label} patched`);
}

module.exports = { patchFile };
