# 权限模式测试方案（方案 A：移除 --allow-dangerously-skip-permissions）

## 背景

通过分析 claude-cli 源码发现：
- `isBypassPermissionsModeAvailable` 在 CLI 内部硬编码为 `true`（permissionSetup.ts:930）
- `allowDangerouslySkipPermissions` 启动参数带下划线前缀，**在 CLI 代码里未被使用**
- 运行时 `set_permission_mode` 切到 bypass 的 gate 检查读取的是 `toolPermissionContext.isBypassPermissionsModeAvailable`，而启动时就是 `true`

**结论**：启动时的 `--allow-dangerously-skip-permissions` flag 对功能无实际影响，可以安全删除。

## 修改内容

### 1. 删除启动 flag
- **文件**：`packages/sdk/src/capability/runner/runner-spawn.service.ts`
- **位置**：`buildCliArgs` 方法（约 1220 行）
- **改动**：删除 `"--allow-dangerously-skip-permissions"` 这一行及其注释

### 2. 更新注释
- **文件 1**：`packages/sdk/src/capability/runner/runner-spawn.service.ts`（226 行）
  - 更新 `PLAN_FORBIDDEN_TOOLS` 的背景说明，指向 CLI 内部实现而非启动 flag
- **文件 2**：`packages/client/src/thread/ModeChip.tsx`（29 行）
  - 更新 `fullAvailable` 参数的文档注释，说明 bypass 模式始终可用的真实原因

## 手动测试清单

### 测试前准备
1. 重新编译 SDK 和客户端：
   ```bash
   pnpm build
   ```
2. 重启应用（确保加载新代码）

### 测试 1：权限模式热切换（核心功能）

#### 1.1 切换到「自动执行」模式
1. 启动应用，创建新会话
2. 点击左下角的权限模式选择器（默认显示「标准模式」）
3. 选择「自动执行」
4. 输入提示词：`在当前目录创建 test-auto.txt，写入 "auto mode test"`
5. **预期**：
   - ✅ 不弹确认卡片
   - ✅ 直接执行，ToolUseCard 下方显示 diff
   - ✅ 文件成功创建

#### 1.2 切换到「完全访问 ⚠️」模式
1. 继续在同一会话，点击权限模式选择器
2. 选择「完全访问 ⚠️」（应显示橙色警告色）
3. 输入提示词：`在当前目录创建 test-bypass.txt，写入 "bypass mode test"`
4. **预期**：
   - ✅ 不弹确认卡片
   - ✅ 直接执行，ToolUseCard 下方显示 diff
   - ✅ 文件成功创建

#### 1.3 切换回「标准模式」（对照组）
1. 点击权限模式选择器，选择「标准模式」
2. 输入提示词：`在当前目录创建 test-default.txt，写入 "default mode test"`
3. **预期**：
   - ✅ **弹出确认卡片**（覆盖输入框）
   - ✅ 点击「允许」后执行
   - ✅ 文件成功创建

### 测试 2：热切不重建进程

#### 2.1 检查 server 日志
1. 打开日志文件：
   ```powershell
   # Windows PowerShell
   Get-Content -Tail 50 ~/.localcoding/logs/server-*.log | Select-String "permission-mode"
   ```
2. **预期输出**（每次切换模式）：
   ```
   [runner-spawn] runtime permission-mode switch sessionId=xxx default → acceptEdits (set_permission_mode, no respawn)
   [runner-spawn] runtime permission-mode switch sessionId=xxx acceptEdits → bypassPermissions (set_permission_mode, no respawn)
   [runner-spawn] runtime permission-mode switch sessionId=xxx bypassPermissions → default (set_permission_mode, no respawn)
   ```
3. **不应出现**：
   ```
   fingerprint changed, restarting process  # ← 重建进程的标志
   ```

### 测试 3：Plan 模式写保护（验证 SDK 自实现逻辑）

#### 3.1 Plan 模式拦截写操作
1. 点击权限模式选择器，选择「计划模式」
2. 输入提示词：`在当前目录创建 test-plan.txt`
3. **预期**：
   - ✅ AI 返回错误提示：「当前处于计划模式（Plan Mode），不能直接执行 Write 等修改类操作。请先用 ExitPlanMode 工具提交你的实施计划...」
   - ✅ Write 工具调用被 deny

#### 3.2 Plan 模式放行读操作
1. 继续在 Plan 模式，输入提示词：`列出当前目录的文件`
2. **预期**：
   - ✅ 直接执行 Bash 的 `ls` 或类似读命令
   - ✅ 返回文件列表

### 测试 4：两模式行为一致性（验证当前实现）

**目的**：确认「自动执行」和「完全访问」在当前实现里对写类工具的放行结果完全一致。

#### 4.1 准备工作
1. 创建测试目录：`mkdir test-modes`
2. 进入该目录：`cd test-modes`

#### 4.2 自动执行模式
1. 切换到「自动执行」
2. 依次输入以下提示词，观察是否弹确认：
   - `创建 file1.txt` → 应直接执行
   - `修改 file1.txt 第一行为 "modified"` → 应直接执行
   - `执行 ls -la` → 应直接执行
   - `删除 file1.txt` → 应直接执行

#### 4.3 完全访问模式
1. 切换到「完全访问 ⚠️」
2. 重复 4.2 的操作（改用 file2.txt）
3. **预期**：所有操作的放行结果与「自动执行」完全一致（都不弹确认）

## 预期结果总结

| 测试项 | 预期行为 | 状态 |
|-------|---------|------|
| 自动执行模式可用 | ✅ 菜单显示，可选择，写操作直接执行 | ⬜ |
| 完全访问模式可用 | ✅ 菜单显示（橙色警告），可选择，写操作直接执行 | ⬜ |
| 标准模式弹确认 | ✅ 写操作弹确认卡片 | ⬜ |
| 热切不重建进程 | ✅ 日志显示 `set_permission_mode, no respawn` | ⬜ |
| Plan 模式写拦截 | ✅ Write/Edit/Bash 被 deny | ⬜ |
| Plan 模式读放行 | ✅ Read/Grep/Glob 直接执行 | ⬜ |
| 两模式行为一致 | ✅ acceptEdits 和 bypass 对写类工具放行结果相同 | ⬜ |

## 如果测试失败

### 问题 1：「完全访问」选项消失
- **原因**：可能 ModeChip 传了 `fullAvailable={false}`
- **排查**：检查 `Composer.tsx:357` 是否传了该参数
- **解决**：确保 `<ModeChip mode={...} onChange={...} />` 不传 `fullAvailable`（默认 true）

### 问题 2：切换到 bypass 时报错
- **错误信息**：`Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions`
- **原因**：CLI 侧的 gate 检查失败（理论上不应该，因为 `isBypassPermissionsModeAvailable` 恒 true）
- **排查**：
  1. 检查是否用的旧版 claude-cli（重新 build）
  2. 查看 `~/.localcoding/logs/server-*.log` 确认报错来源
- **解决**：确认 CLI 版本与 D:\code\claude-code 源码一致

### 问题 3：Plan 模式写操作没被拦截
- **原因**：`isPlanForbiddenTool` 逻辑未生效
- **排查**：
  1. 在 `handleControlRequest` 的 `can_use_tool` 分支打日志
  2. 确认 `curMode` 是否为 `"plan"`
- **解决**：检查 `runner-spawn.service.ts:1418` 的拦截逻辑

## 回归验证（可选）

如果担心有遗漏，可以用旧版本对比：

1. Git 切回修改前的提交
2. 重新编译运行
3. 执行上述测试 1-4
4. 确认所有行为与新版本**完全一致**

**预期结果**：删除 flag 前后功能无差异（因为 CLI 本来就没用它）。

## 测试完成后

- [ ] 所有测试项通过
- [ ] 清理测试文件：`rm -rf test-modes test-*.txt`
- [ ] 提交代码：
  ```bash
  git add .
  git commit -m "refactor: 移除无效的 --allow-dangerously-skip-permissions flag
  
  CLI 源码里 isBypassPermissionsModeAvailable 硬编码 true，
  allowDangerouslySkipPermissions 启动参数未被使用，运行时热切
  到 bypass 模式不依赖该 flag。删除以简化启动参数。
  
  - 删除 buildCliArgs 里的 --allow-dangerously-skip-permissions
  - 更新相关注释，指向 CLI 内部实现而非启动参数
  - 功能无变化：bypass 模式始终可用，热切不重建进程
  
  测试：按 docs/permission-mode-test.md 验证所有模式正常工作"
  ```

## 参考资料

- **CLI 源码关键位置**：
  - `D:\code\claude-code\src\utils\permissions\permissionSetup.ts:930`（硬编码 `isBypassPermissionsModeAvailable = true`）
  - `D:\code\claude-code\src\hooks\useReplBridge.tsx:473`（运行时 gate 检查）
- **LocalClaw 实现**：
  - `packages/sdk/src/capability/runner/runner-spawn.service.ts:1418`（plan 模式拦截）
  - `packages/sdk/src/capability/runner/runner-spawn.service.ts:1440`（权限判断）
