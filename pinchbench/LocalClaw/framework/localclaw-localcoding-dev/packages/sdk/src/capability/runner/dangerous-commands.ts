/**
 * acceptEdits 模式下需要二次确认的高危命令前缀。
 *
 * 对齐 CLI 的 Bash(...:*) 规则语法，但实现为简化版前缀匹配（不做 AST 解析）。
 * 承认不完备：变形攻击（多空格、换序、变量扩展、引号包裹）可绕过。
 *
 * 维护原则：
 * 1. 只收录"常见误操作"，不试图穷尽所有危险操作
 * 2. 每条规则附注释说明为什么危险
 * 3. 优先覆盖不可逆操作（删除、覆盖、强制推送）
 *
 * 设计理念：
 * - 这是 acceptEdits 和 bypassPermissions 的**唯一差异点**
 * - bypassPermissions 模式下这些命令仍直接执行（真·跳过所有检查）
 * - 用户可通过"本次会话不再询问"绕过（session.sessionAllowedTools）
 */
export const ACCEPT_EDITS_ASK_RULES = [
  // ── 文件系统：删除（不可逆）──
  // 用一条通用 "rm" 覆盖所有删除：单文件 `rm x.txt` 与递归 `rm -rf /` 同样不可逆，
  // 都应确认（见 1.png：单文件 rm 曾漏网直接执行）。边界判断要求 rm 后接空格，
  // 故 rmdir 不会误命中。
  "rm",
  "rmdir", // 删空目录，同属删除类

  // ── Git：强制推送（覆盖远程历史，团队影响）──
  "git push --force",
  "git push -f",
  "git push --force-with-lease", // 虽然更安全，但仍能覆盖

  // ── 数据库：删表/删库（不可逆，业务影响）──
  "drop table", // SQL 关键字通常大写，但我们不区分大小写
  "drop database",
  "truncate table",

  // ── 磁盘操作：格式化、直接写设备（系统级破坏）──
  "mkfs", // 格式化分区，包括 mkfs.ext4 / mkfs.xfs 等
  "dd if=", // dd 常用于直接写磁盘，误操作风险高
  "> /dev/sd", // 重定向到磁盘设备
  "> /dev/nvme",

  // ── 权限：递归修改为完全开放（安全风险）──
  "chmod -r 777",
  "chmod 777 -r",
  "chmod -r a+rwx",
] as const;

/**
 * 检查命令是否匹配高危规则（需要二次确认）。
 *
 * 匹配策略：
 * 1. 规范化空格：多空格压缩成单空格
 * 2. 大小写不敏感（SQL 关键字常大写，bash 命令常小写）
 * 3. 前缀匹配 + 管道后命令匹配
 *
 * 局限性（已知可绕过，但我们接受这个权衡）：
 * - 变量扩展：`VAR="-rf" && rm $VAR /` ← 正则无法识别
 * - 引号包裹：`rm "-rf" /` ← 会绕过前缀匹配
 * - 命令替换：`$(echo rm) -rf /` ← 动态生成命令
 * - 别名：`alias rr='rm -rf' && rr /` ← shell 别名
 * - 函数：`f(){ rm -rf "$@";}; f /` ← 自定义函数
 *
 * 为什么接受这些局限：
 * 1. 真正完备的检查需要 AST + 运行时分析（成本高，见 CLI 的 bash/ast.ts）
 * 2. 目标是"防止常见误操作"而非"安全沙箱"（后者应该用 OS 级隔离）
 * 3. 故意绕过的用户可以直接切到 bypassPermissions 模式
 *
 * @param cmd - 要检查的 bash 命令字符串
 * @returns true 表示命中高危规则，需要二次确认
 */
export function matchesDangerousCommand(cmd: string): boolean {
  if (!cmd || typeof cmd !== "string") {
    return false;
  }

  // 规范化：压缩连续空格、转小写、去首尾空白
  const normalized = cmd.trim().replace(/\s+/g, " ").toLowerCase();

  for (const rule of ACCEPT_EDITS_ASK_RULES) {
    const ruleNorm = rule.toLowerCase();

    // 重定向类规则（以 > 开头，如 "> /dev/sd"）可出现在命令任意位置，
    // 例如 `cat x > /dev/sda`，故用子串匹配而非前缀匹配。
    if (ruleNorm.startsWith(">")) {
      if (normalized.includes(ruleNorm)) {
        return true;
      }
      continue;
    }

    // 1. 命令开头匹配
    if (matchesAtBoundary(normalized, ruleNorm)) {
      return true;
    }

    // 2. 管道、逻辑运算符后的子命令匹配
    // 例如：`ls | rm -rf /tmp`、`a && rm -rf b` 应该拦住。
    // 命令中可能有多个分隔符，逐个扫描每段的开头。
    for (const sep of [" | ", " && ", " || "]) {
      let idx = normalized.indexOf(sep);
      while (idx >= 0) {
        const seg = normalized.slice(idx + sep.length);
        if (matchesAtBoundary(seg, ruleNorm)) {
          return true;
        }
        idx = normalized.indexOf(sep, idx + sep.length);
      }
    }
  }

  return false;
}

/**
 * 判断 text 是否以 rule 开头，且 rule 之后是命令边界。
 *
 * 边界规则：
 * - rule 以字母/数字结尾（如 "rm -rf"、"mkfs"）：其后须为空格、点号或字符串结尾，
 *   避免 "rmdir" 误命中 "rm"、"mkfifo" 误命中 "mkfs"；点号放行 "mkfs.ext4"。
 * - rule 以非单词字符结尾（如 "dd if="）：直接前缀匹配即可，因为 "=" 本身已是边界，
 *   命令 "dd if=/dev/zero" 应命中。
 */
function matchesAtBoundary(text: string, rule: string): boolean {
  if (!text.startsWith(rule)) {
    return false;
  }
  const rest = text.slice(rule.length);
  if (rest === "") {
    return true;
  }
  const lastRuleChar = rule[rule.length - 1]!;
  const ruleEndsWithWord = /[a-z0-9]/.test(lastRuleChar);
  if (!ruleEndsWithWord) {
    // 规则以非单词字符结尾（=、+ 等），"=" 后紧跟路径即算命中。
    return true;
  }
  // 规则以单词字符结尾，要求后接空格或点号，防止前缀相似命令误命中。
  const nextChar = rest[0]!;
  return nextChar === " " || nextChar === ".";
}
