# 路径 C：acceptEdits 与 bypassPermissions 差异化实现

## 目标

让「自动执行」(acceptEdits) 与「完全访问」(bypassPermissions) 产生**可观测差异**：
- **acceptEdits**：高危 Bash 命令（`rm -rf` 等）弹二次确认卡片
- **bypassPermissions**：所有命令直接执行（真·跳过所有检查）

此前两者在 SDK 权限层行为完全一致（都只区分 default vs 非 default）。

## 改动清单

### 1. 新增 `dangerous-commands.ts`

`packages/sdk/src/capability/runner/dangerous-commands.ts`

- `ACCEPT_EDITS_ASK_RULES`：高危命令前缀清单，覆盖 5 类：
  - 递归删除：`rm -rf` / `rm -fr` / `rm --recursive --force`
  - 强制推送：`git push --force` / `-f` / `--force-with-lease`
  - 数据库删除：`drop table` / `drop database` / `truncate table`
  - 磁盘破坏：`mkfs` / `dd if=` / `> /dev/sd` / `> /dev/nvme`
  - 权限放开：`chmod -R 777` 等
- `matchesDangerousCommand(cmd)`：匹配入口
- `matchesAtBoundary(text, rule)`：边界判断 helper，防止 `rmdir` 误命中 `rm`、`mkfifo` 误命中 `mkfs`，同时放行 `mkfs.ext4` / `dd if=/dev/zero`

匹配策略：规范化空格 → 转小写 → 命令开头/管道后子命令按边界匹配；重定向规则（`> /dev/`）用子串匹配。

### 2. 集成到 `runner-spawn.service.ts`

`can_use_tool` 分支的 `needsUserDecision` 新增一个条件：

```ts
const isAcceptEditsDangerousBash =
  curMode === "acceptEdits" &&
  toolName === "Bash" &&
  matchesDangerousCommand((input as any)?.command ?? "");

const needsUserDecision =
  !alreadyAllowed &&
  (toolName === "AskUserQuestion" ||
    toolName === "ExitPlanMode" ||
    toolName === "exit_plan_mode" ||
    (curMode === "default" && CONFIRM_TOOLS_DEFAULT.has(toolName)) ||
    isAcceptEditsDangerousBash);   // ← 新增
```

`bypassPermissions` 不走这条分支，因此高危命令仍直接放行。

### 3. 单元测试

`packages/sdk/src/capability/runner/__tests__/dangerous-commands.spec.ts`，12 个用例，覆盖：
- 各类高危命令拦截（含大小写/多空格/换序变体）
- 管道/逻辑运算符后的子命令
- 安全命令放行
- 前缀相似命令防误报（`rmdir`/`mkfifo`/`git pushd`）
- 空/非法输入
- 已知局限（变量扩展/引号/命令替换绕过——记录为预期行为）

## 已知局限（有意接受）

正则/前缀匹配无法覆盖变形攻击：
- 变量扩展：`VAR="-rf" && rm $VAR /`
- 引号包裹：`rm "-rf" /`
- 命令替换：`$(echo rm) -rf /`
- 别名/函数：`alias rr='rm -rf'; rr /`

原因：真正完备的检查需 AST + 运行时分析（见 CLI 的 `bash/ast.ts`，约 3000 行 + tree-sitter 依赖）。本实现目标是**防常见误操作**，非安全沙箱。故意绕过者可直接切 bypassPermissions。

## 验证结果

- SDK 编译：通过
- 目标测试：12/12 通过
- 全量测试：424/424 通过（44 文件）

## 手动测试

```
# acceptEdits（自动执行）模式
输入："执行 rm -rf /tmp/test"     → 预期：弹确认卡片
输入："执行 ls -la"               → 预期：直接执行

# bypassPermissions（完全访问）模式
输入："执行 rm -rf /tmp/test"     → 预期：直接执行（无确认）
```
