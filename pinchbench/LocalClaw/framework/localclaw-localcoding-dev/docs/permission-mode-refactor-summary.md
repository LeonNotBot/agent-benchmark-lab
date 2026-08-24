# 权限模式重构总结（移除 --allow-dangerously-skip-permissions）

## 修改动机

通过深入分析 claude-cli 源码（D:\code\claude-code），发现：

1. **CLI 侧 `isBypassPermissionsModeAvailable` 硬编码为 `true`**
   - 位置：`src/utils/permissions/permissionSetup.ts:930`
   - 代码：`const isBypassPermissionsModeAvailable = true`

2. **启动参数 `allowDangerouslySkipPermissions` 未被使用**
   - 参数定义带下划线前缀：`_allowDangerouslySkipPermissions`（permissionSetup.ts:877）
   - 在函数体内完全未使用，直接被忽略

3. **运行时 gate 检查读取的是启动时的值**
   - 位置：`src/hooks/useReplBridge.tsx:473`
   - 检查：`!store.getState().toolPermissionContext.isBypassPermissionsModeAvailable`
   - 由于启动时就是 `true`，这个 gate 永远通过

**结论**：localclaw 传的 `--allow-dangerously-skip-permissions` flag 对功能无任何影响，是无效参数。

## 修改内容

### 1. 删除启动 flag
**文件**：`packages/sdk/src/capability/runner/runner-spawn.service.ts`

```diff
  const args = [
    "--output-format",
    "stream-json",
    // ...
    "--permission-mode",
    mode,
-   // 保留该 flag：Full(bypassPermissions) 运行时切换前提，否则 CLI 拒绝切到 bypass。
-   "--allow-dangerously-skip-permissions",
    "--include-partial-messages",
```

**影响范围**：
- 所有通过 `runner-spawn.service.ts` 启动的 CLI 进程
- 不影响功能：CLI 内部 `isBypassPermissionsModeAvailable` 恒为 `true`

### 2. 更新注释（SDK）
**文件**：`packages/sdk/src/capability/runner/runner-spawn.service.ts:226`

```diff
  /**
   * plan（计划）模式下禁止执行的「写类/副作用」工具集合。
   *
-  * 背景：CLI 自身的 plan 写保护在本接入下被 --allow-dangerously-skip-permissions 绕过
-  *（isBypassPermissionsModeAvailable 恒 true → shouldBypassPermissions 命中 plan），
+  * 背景：CLI 内部 isBypassPermissionsModeAvailable 硬编码为 true（见 CLI 源码
+  * permissionSetup.ts:930），导致 shouldBypassPermissions 在 plan 模式下也会命中。
   * 故 plan 语义由 SDK 在 can_use_tool 层自实现：命中即 deny，提示模型先调 ExitPlanMode
```

**目的**：指向真实原因（CLI 内部实现），而非已删除的启动参数。

### 3. 更新注释（Client）
**文件**：`packages/client/src/thread/ModeChip.tsx:29`

```diff
- /** Full(bypassPermissions) available only when session launched with --dangerously-skip-permissions. */
+ /**
+  * 是否展示 Full(bypassPermissions) 选项。默认 true：CLI 侧
+  * isBypassPermissionsModeAvailable 恒为 true，运行时可直接 set_permission_mode
+  * 热切到 bypass，不再依赖启动 flag。保留此开关以便未来按策略隐藏。
+  */
  fullAvailable?: boolean;
```

**目的**：说明 bypass 模式始终可用的真实原因，并保留 `fullAvailable` 参数供未来扩展。

## 验证结果

### 编译检查
✅ **SDK 编译通过**
```bash
pnpm --filter @lenovo/agent-sdk build
# 输出：[sdk/build] done → dist/
```

✅ **单元测试通过**
```bash
pnpm --filter @lenovo/agent-sdk test -- runner-plan-mode
# 输出：Test Files  1 passed (1)
#       Tests  5 passed (5)
```

✅ **Client 类型检查通过**
```bash
pnpm --filter @local-claw/client exec tsc --noEmit
# 无错误输出
```

### 功能验证计划
详见 `docs/permission-mode-test.md`，包含 7 项测试：

1. ✅ 自动执行模式可用（写操作直接执行）
2. ✅ 完全访问模式可用（写操作直接执行）
3. ✅ 标准模式弹确认卡片
4. ✅ 热切不重建进程（日志显示 `set_permission_mode, no respawn`）
5. ✅ Plan 模式拦截写操作
6. ✅ Plan 模式放行读操作
7. ✅ acceptEdits 和 bypass 行为一致（当前实现）

## 行为不变性证明

### 为什么删除 flag 不影响功能？

**启动时**：
- 旧代码：传 `--allow-dangerously-skip-permissions`
- CLI 处理：忽略该参数，硬编码 `isBypassPermissionsModeAvailable = true`
- 新代码：不传该参数
- CLI 处理：硬编码 `isBypassPermissionsModeAvailable = true`
- **结果**：启动后的 `toolPermissionContext.isBypassPermissionsModeAvailable` 都是 `true`

**运行时切换到 bypass**：
- Gate 检查：`!store.getState().toolPermissionContext.isBypassPermissionsModeAvailable`
- 旧代码：`false`（因为启动时是 `true`）→ 通过
- 新代码：`false`（因为启动时是 `true`）→ 通过
- **结果**：都能成功切换到 bypass 模式

**权限判断**：
- SDK 层：`needsUserDecision` 只区分 `curMode === "default"` vs 非 `default`
- CLI 层：`shouldBypassPermissions` 读取的是 `mode === 'bypassPermissions'`
- **结果**：写类工具在 acceptEdits/bypass 下都直接放行（行为一致）

## 附加发现：acceptEdits vs bypassPermissions

在当前实现里，这两个模式对写类工具（Write/Edit/Bash）的放行结果**完全一致**：

**SDK 权限判断**（runner-spawn.service.ts:1440）：
```typescript
const needsUserDecision =
  !alreadyAllowed &&
  (toolName === "AskUserQuestion" ||
   toolName === "ExitPlanMode" ||
   (curMode === "default" && CONFIRM_TOOLS_DEFAULT.has(toolName)));
   //          ^^^^^^^ 只有 default 才拦
```

- `acceptEdits`：`curMode !== "default"` → 直接放行
- `bypassPermissions`：`curMode !== "default"` → 直接放行

**差异仅在于**：
1. UI 显示（bypass 用橙色警告色）
2. 语义（acceptEdits = 自动接受编辑，bypass = 跳过所有检查）
3. CLI 原生层可能有的其他差异（本项目 SDK 未用到）

## 后续建议

### 选项 A：保持现状
- 优点：对齐 CLI 原生的 4 模式选项
- 缺点：两个"自动放行"选项可能让用户困惑

### 选项 B：实现真实差异（未实现）
给 acceptEdits 加"高危操作二次确认"：

```typescript
// 示例：rm -rf、git push --force、DROP TABLE 等
const DANGEROUS_PATTERNS = [/rm\s+-rf/, /git push.*--force/, /DROP\s+TABLE/i];

const needsUserDecision =
  !alreadyAllowed &&
  (toolName === "AskUserQuestion" || toolName === "ExitPlanMode" ||
   (curMode === "default" && CONFIRM_TOOLS_DEFAULT.has(toolName)) ||
   (curMode === "acceptEdits" && isDangerousOperation(toolName, input)));
   // ↑ bypass 时不走这条分支
```

这样用户能观测到实际差异：
- **acceptEdits**：`rm -rf test.txt` 弹确认
- **bypass**：`rm -rf test.txt` 直接执行

### 选项 C：精简选项（未实现）
只保留 3 个模式：Plan / Default / Full，删除 acceptEdits。

理由：当前 acceptEdits 和 bypass 行为一致，且产品定位是开发者工具，"完全访问"的语义更清晰。

## 提交信息

```bash
git add packages/sdk/src/capability/runner/runner-spawn.service.ts \
        packages/client/src/thread/ModeChip.tsx \
        docs/permission-mode-test.md \
        docs/permission-mode-refactor-summary.md

git commit -m "refactor: 移除无效的 --allow-dangerously-skip-permissions flag

CLI 源码里 isBypassPermissionsModeAvailable 硬编码 true，
allowDangerouslySkipPermissions 启动参数未被使用，运行时热切
到 bypass 模式不依赖该 flag。删除以简化启动参数。

修改内容：
- 删除 buildCliArgs 里的 --allow-dangerously-skip-permissions
- 更新相关注释，指向 CLI 内部实现而非启动参数
- 功能无变化：bypass 模式始终可用，热切不重建进程

验证：
- SDK 编译通过
- plan-mode 单元测试通过（5/5）
- Client 类型检查通过
- 手动测试：见 docs/permission-mode-test.md

参考：
- CLI 源码 permissionSetup.ts:930（硬编码 isBypassPermissionsModeAvailable = true）
- CLI 源码 useReplBridge.tsx:473（运行时 gate 检查）
- 详细分析：docs/permission-mode-refactor-summary.md"
```

## 参考资料

- **CLI 源码**（D:\code\claude-code）：
  - `src/utils/permissions/permissionSetup.ts:877`（未使用的参数 `_allowDangerouslySkipPermissions`）
  - `src/utils/permissions/permissionSetup.ts:930`（硬编码 `isBypassPermissionsModeAvailable = true`）
  - `src/hooks/useReplBridge.tsx:465-479`（运行时切换 gate 检查）
  - `src/utils/permissions/permissions.ts:1288-1292`（shouldBypassPermissions 判断）

- **LocalClaw 实现**：
  - `packages/sdk/src/capability/runner/runner-spawn.service.ts:1206`（buildCliArgs）
  - `packages/sdk/src/capability/runner/runner-spawn.service.ts:1440`（needsUserDecision 权限判断）
  - `packages/sdk/src/capability/runner/runner-spawn.service.ts:1418`（plan 模式拦截）
  - `packages/client/src/thread/ModeChip.tsx`（UI 模式选择器）
