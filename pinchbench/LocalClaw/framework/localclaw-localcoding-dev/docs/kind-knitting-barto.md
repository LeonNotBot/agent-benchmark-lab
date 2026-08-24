# 智能本地/云端模型路由方案（v2 — Ollama 内嵌）

## Context

v1 方案已实现路由框架（Phase 1-8），但 Ollama 依赖用户自行安装，导致 Local 按钮默认灰色不可用。本次完善目标：**Ollama 作为程序内嵌组件**，用户安装 local-claw 后即可直接使用本地模型，无需额外安装 Ollama。

同时支持三种 Ollama 来源（优先级从高到低）：
1. 环境变量指定路径（`OLLAMA_PATH`）
2. 打包到 Electron 资源中的内嵌 Ollama（生产环境）或项目本地 `ollama/` 目录（开发环境）
3. 系统已安装的 Ollama（`where ollama` / `which ollama`）

## 架构设计

### Ollama 二进制管理策略

Windows Ollama 压缩包约 2GB（含 CUDA 库），不适合直接打包到安装包。采用 **首次运行时下载** 策略：

```
用户首次点击 Local 模式
     ↓
OllamaService.ensureInstalled()
  ├── 检测: 内嵌路径 / 系统安装 → 已有则直接用
  └── 未找到 → 触发下载
     ↓
下载 Ollama 压缩包到临时目录 → 解压到 userData/ollama/
     ↓
前端显示下载进度条
     ↓
下载完成 → 启动 ollama serve → 拉取模型
```

### Ollama 存储路径

| 环境 | Ollama 二进制路径 | 模型存储路径 |
|------|------------------|-------------|
| 开发调试 | `项目根/ollama/ollama.exe` | `项目根/ollama/models/` |
| Electron 打包（无内嵌） | `userData/ollama/ollama.exe` | `userData/ollama/models/` |
| Electron 打包（有内嵌） | `resources/ollama/ollama.exe` | `userData/ollama/models/` |
| 系统安装 | 系统 PATH 中的 `ollama` | 系统默认路径 |

> `userData` = Electron `app.getPath('userData')`，Windows 下为 `%APPDATA%/local-claw`

### 下载源

| 平台 | 文件 | 大小 | URL |
|------|------|------|-----|
| Windows | `ollama-windows-amd64.zip` | ~2GB | `https://github.com/ollama/ollama/releases/download/v{version}/ollama-windows-amd64.zip` |
| macOS | `ollama-darwin.tgz` | ~130MB | `https://github.com/ollama/ollama/releases/download/v{version}/ollama-darwin.tgz` |

### Prompt 复杂度分类策略

**文件**: `packages/server/src/modules/routing/prompt-classifier.service.ts`

路由的核心决策依据是对用户输入进行 **启发式复杂度评分**（0-100 分），由 5 个维度加权求和，最终映射为三档复杂度。

#### 评分维度

| 维度 | 分值范围 | 说明 |
|------|---------|------|
| 任务类型 | 0-30 | 根据关键词判断任务性质 |
| 输入长度 | 5-20 | Prompt 字符数 |
| 代码内容 | 0-15 | 是否包含代码块或文件路径 |
| 推理需求 | 0-20 | 是否需要多步推理、条件判断、比较分析 |
| 工具使用预测 | 0-15 | 预计需要调用几类工具（搜索/编辑/执行） |

**多轮对话加成**: 若为 `session.continue`（多轮），额外 +15 分，因为上下文积累使任务隐含更高复杂度。

#### 任务类型评分细则（0-30 分）

| 关键词 | 分值 | 示例 |
|--------|------|------|
| 架构/迁移类 | 30 | architect, design, migrate, refactor across, system design |
| 多文件操作 | 25 | all files, across the codebase, update all, global replace |
| 调试类 | 20 | debug, stack trace, error |
| 编辑/修改类 | 10 | edit, modify, change, fix |
| 解释/查询类 | 5 | what is, explain, 什么是, 解释 |
| 默认 | 8 | 其他所有输入 |

#### 输入长度评分（5-20 分）

| 长度 | 分值 |
|------|------|
| < 50 字符 | 5 |
| 50-199 | 10 |
| 200-499 | 15 |
| ≥ 500 | 20 |

#### 代码内容评分（0-15 分）

- 包含 ` ```代码块``` `：+10
- 包含文件路径（如 `src/app.ts`）：+5
- 上限 15 分

#### 推理需求评分（0-20 分）

- **比较分析关键词**（+10）：compare, tradeoff, pros and cons, evaluate, 为什么, 比较, 权衡
- **多步骤模式**（+15）：`first...then`, `step 1/2`, `1)...2)`, `第一步...第二步`
- **条件判断模式**（+10）：`if...else/otherwise`, `depending on`, `根据...情况`
- 上限 20 分

#### 工具使用预测评分（0-15 分）

统计提及的工具类别数（搜索/编辑/执行）：

| 类别数 | 分值 | 涉及关键词 |
|--------|------|-----------|
| 3 类 | 15 | 同时涉及搜索+编辑+执行 |
| 2 类 | 10 | — |
| 1 类 | 5 | — |
| 0 类 | 0 | — |

- **搜索类**: search, find, 查找
- **编辑类**: edit, write, create, 修改, 创建
- **执行类**: run, execute, test, 运行, 测试

#### 复杂度阈值

| 分数区间 | 复杂度 | 路由决策 |
|---------|--------|---------|
| 0-30 | simple | 优先本地模型 |
| 31-55 | medium | 本地模型需 ≥7B 参数才处理，否则走云端 |
| 56-100 | complex | 强制云端模型 |

#### 示例

| 输入 | 得分 | 复杂度 |
|------|------|--------|
| "什么是 TypeScript" | 5+5+0+0+0 = 10 | simple |
| "修改 src/app.ts 的登录逻辑" | 10+5+5+0+5 = 25 | simple |
| "查找所有 API 调用并创建测试" | 8+10+0+0+10 = 28 | simple |
| "比较 Redis 和 Memcached，创建缓存层" | 8+10+0+10+5 = 33 | medium |
| "重构整个认证系统，先分析再迁移到 JWT" | 25+15+0+15+10 = 65 | complex |

## 实现计划

### Phase A: Ollama 路径解析模块

**新建 `electron/ollama-path.cjs`**（复用 `cli-path.cjs` 模式）

三级优先查找：
1. `process.env.OLLAMA_PATH` — 环境变量覆盖
2. 内嵌路径：
   - 打包: `process.resourcesPath/ollama/ollama[.exe]`
   - 开发: `项目根/ollama/ollama[.exe]`
3. 已下载路径: `userData/ollama/ollama[.exe]`（首次下载后存放处）
4. 系统 PATH: `where ollama` / `which ollama`

导出: `getOllamaPath()` → 返回可执行文件完整路径或 `null`
导出: `getOllamaModelsDir()` → 返回模型存储目录

### Phase B: Electron 主进程传递 Ollama 路径

**修改 `electron/main.cjs`**

```javascript
const { getOllamaPath, getOllamaModelsDir } = require("./ollama-path.cjs");

// 在 startServer() 的 fork env 中添加:
OLLAMA_EXECUTABLE: getOllamaPath() || "",
OLLAMA_MODELS_DIR: getOllamaModelsDir(),
OLLAMA_USER_DATA: app.getPath('userData'),
```

### Phase C: 重写 OllamaService — 内嵌支持 + 下载管理

**修改 `packages/server/src/modules/routing/ollama.service.ts`**

核心变更：

#### C1: Ollama 可执行文件查找逻辑

```
resolveOllamaPath():
  1. process.env.OLLAMA_EXECUTABLE (从 Electron 传入)
  2. process.env.OLLAMA_PATH (用户手动设置)
  3. 项目本地: path.join(cwd, "ollama", binary) (开发模式)
  4. userData 下载目录: path.join(userData, "ollama", binary)
  5. 系统 PATH: execSync("where/which ollama")
```

#### C2: Ollama 下载管理器

新增方法 `downloadOllama(onProgress)`:
- 根据 `process.platform` 选择下载 URL
- 使用 Node.js `https.get` 或 `fetch` 流式下载到 `userData/ollama/` 临时文件
- 下载完成后解压（Windows: unzip, macOS: tar xzf）
- 验证解压后的 `ollama[.exe]` 可执行
- 通过 `onProgress` 回调实时推送进度到前端

#### C3: 启动时使用完整路径

```javascript
// 旧: spawn("ollama", ["serve"], ...)
// 新: spawn(this.ollamaPath, ["serve"], { env: { OLLAMA_HOST, OLLAMA_MODELS } })
```

设置 `OLLAMA_MODELS` 环境变量控制模型存储位置（`userData/ollama/models/`），避免和系统 Ollama 冲突。

#### C4: 完整生命周期

```
ensureReady():
  1. checkRunning() → 系统 Ollama 已运行? 直接用
  2. resolveOllamaPath() → 找到可执行文件?
     2a. 没找到 → downloadOllama() → 下载安装
  3. startServe(ollamaPath) → 启动内嵌 Ollama
  4. ensureModel(modelName) → 确保模型已拉取
```

### Phase D: 共享类型更新

**修改 `packages/shared/src/types.ts`**

DeviceCapabilities 新增字段：
```typescript
export type DeviceCapabilities = {
  // ...existing fields
  ollamaInstalled: boolean;     // 已有
  ollamaRunning: boolean;       // 已有
  ollamaSource: "embedded" | "downloaded" | "system" | "none";  // 新增
  ollamaPath: string | null;    // 新增: 可执行文件路径
  availableModels: string[];    // 已有
};
```

ServerEvent 新增 `ollama.download` 事件：
```typescript
| { type: "ollama.download"; payload: { status: "downloading" | "extracting" | "done" | "error"; progress?: number; detail?: string } }
```

### Phase E: 前端下载进度 UI

**修改 `packages/client/src/components/ModelIndicator.tsx`**

当收到 `ollama.download` 事件时，显示下载进度条：
- "正在下载 Ollama... 45%" （附进度条）
- "正在解压..." 
- "Ollama 就绪"

**修改 `packages/client/src/components/RoutingPreference.tsx`**

Local 按钮不再灰色禁用，而是：
- Ollama 已就绪 → 正常切换
- Ollama 未安装 → 点击后触发下载流程，按钮显示 loading 状态

**修改 `packages/client/src/store/useAppStore.ts`**

新增状态：
```typescript
ollamaDownloadStatus: "idle" | "downloading" | "extracting" | "done" | "error";
ollamaDownloadProgress: number; // 0-100
```

### Phase F: 开发模式支持

**新建 `scripts/copy-ollama.cjs`**（可选，开发便利）

复用 `copy-cli.cjs` 模式，从环境变量指定的路径或默认位置拷贝 Ollama 二进制到项目 `ollama/` 目录。

**修改 `.gitignore`**：添加 `ollama/`

**修改 `package.json`** build scripts（仅当需要内嵌打包时）：
```json
"extraResources": [
  { "from": "claude-cli", "to": "claude-cli", "filter": ["**/*"] },
  { "from": "ollama", "to": "ollama", "filter": ["**/*"] }
]
```

### Phase G: WebSocket 事件集成

**修改 `websocket.gateway.ts`**

新增客户端事件处理：
```typescript
case "routing.preference":
  // 如果切换到 local 且 Ollama 未就绪，触发下载
  if (payload.preference === "local") {
    this.ensureOllamaAndNotify();
  }
```

`ensureOllamaAndNotify()` 方法：调用 `OllamaService.ensureReady()`，过程中通过 `ollama.download` 事件实时推送状态到前端。

## 关键文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `electron/ollama-path.cjs` | **新建** | Ollama 路径解析（3级优先查找） |
| `electron/main.cjs` | 修改 | 传递 OLLAMA_EXECUTABLE/MODELS_DIR/USER_DATA 环境变量 |
| `packages/server/src/modules/routing/ollama.service.ts` | **重写** | 内嵌支持 + 下载管理 + 完整路径启动 |
| `packages/shared/src/types.ts` | 修改 | 新增 ollamaSource/ollamaPath 字段 + ollama.download 事件 |
| `packages/client/src/store/useAppStore.ts` | 修改 | 下载状态 |
| `packages/client/src/components/ModelIndicator.tsx` | 修改 | 下载进度 UI |
| `packages/client/src/components/RoutingPreference.tsx` | 修改 | Local 按钮可点击触发下载 |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | 修改 | ollama.download 事件 + ensureOllamaAndNotify |
| `scripts/copy-ollama.cjs` | **新建**(可选) | 开发模式拷贝 Ollama 二进制 |
| `.gitignore` | 修改 | 添加 `ollama/` |
| `package.json` | 修改 | extraResources 添加 ollama（可选内嵌打包） |

## 回退策略

| 场景 | 处理 |
|------|------|
| 无网络且未下载 Ollama | Local 按钮提示"需要网络首次下载 Ollama"，路由到云端 |
| 下载中断 | 保留已下载部分，下次续传或重新下载 |
| 下载完成但解压失败 | 删除损坏文件，提示重试 |
| 内嵌 Ollama 启动失败 | 检查系统 Ollama，都失败则回退云端 |
| 系统已有 Ollama 运行 | 直接复用，不启动内嵌实例（避免端口冲突） |

## 验证方法

1. **开发模式**: 手动放置 Ollama 二进制到 `ollama/` 目录，启动后确认自动检测到
2. **下载流程**: 清空 `userData/ollama/`，点击 Local 按钮，确认触发下载并显示进度
3. **系统 Ollama 共存**: 系统已安装 Ollama 的情况下，确认优先使用系统实例
4. **Electron 打包**: 不带内嵌 Ollama 打包，安装后点击 Local 确认触发下载
5. **端到端**: 下载完成后发送简单问题，确认走本地模型并正确返回结果

---

## Phase H: 本地模型管理面板（已实现）

### 功能概述

用户切换到 Local 模式时，如果本地没有模型，自动弹出模型管理面板。同时提供常驻齿轮图标入口，用户随时可以安装和卸载本地模型。

### 交互流程

```
用户点击 Local 按钮 → 无可用模型
     ↓
自动弹出 ModelManager 抽屉面板
  ├── 顶部: 设备信息（GPU/RAM/CPU）
  ├── 推荐模型列表（根据 VRAM 匹配，标注推荐）
  │   ├── qwen2.5:3b [4GB+]         [安装]
  │   ├── qwen2.5:7b [6GB+]         [安装]
  │   ├── qwen2.5-coder:7b [8GB+]   [安装]  ← 推荐
  │   ├── qwen2.5-coder:14b [12GB+] [安装]
  │   └── qwen2.5-coder:32b [24GB+] [安装]
  ├── 已安装模型显示 [卸载] 按钮
  └── 底部: Ollama 状态（来源/运行状态/已安装模型数）
```

**常驻入口**: ModelIndicator 旁边的齿轮图标按钮，点击打开面板。

### 新增类型 (`packages/shared/src/types.ts`)

```typescript
export type ModelRecommendation = {
  model: string;
  requiredVramMB: number;
  maxComplexity: "simple" | "medium";
  installed: boolean;
  recommended: boolean;  // 最匹配设备的模型
  sizeMB?: number;
};

// Server → Client 新增事件
| { type: "model.list"; payload: { recommendations: ModelRecommendation[]; installedModels: string[] } }
| { type: "model.progress"; payload: { model: string; action: "pulling" | "deleting"; progress?: number; status: string } }

// Client → Server 新增事件
| { type: "model.list" }
| { type: "model.install"; payload: { model: string } }
| { type: "model.uninstall"; payload: { model: string } }
```

### 推荐模型矩阵

根据设备 GPU VRAM（无独显时取 RAM×25%，需 >16GB）匹配：

| 最低显存 | 推荐模型 | 适合任务 |
|----------|---------|---------|
| 24GB | qwen2.5-coder:32b | 中等复杂度 |
| 12GB | qwen2.5-coder:14b | 中等复杂度 |
| 8GB | qwen2.5-coder:7b | 简单任务 |
| 6GB | qwen2.5:7b | 简单任务 |
| 4GB | qwen2.5:3b | 简单任务 |

第一个满足设备显存的模型标记为「推荐」。

### 后端实现

**`ollama.service.ts`** 新增:
- `deleteModel(name)` — 调用 `DELETE /api/delete` 接口删除模型，完成后刷新模型列表

**`routing.service.ts`** 新增:
- `RECOMMENDATION_MATRIX` — 推荐模型矩阵常量
- `getModelRecommendations()` — 结合矩阵 + 设备 VRAM + 已安装模型，生成推荐列表

**`websocket.gateway.ts`** 新增事件处理:
- `model.list` → 调用 `getModelRecommendations()` 返回推荐列表
- `model.install` → 确保 Ollama 运行 → `pullModel()` 流式进度推送 → 完成后刷新列表和设备能力
- `model.uninstall` → `deleteModel()` → 刷新列表和设备能力
- `onRoutingPreference` 切换到 `local` 时自动发送 `model.list` 事件

### 前端实现

**`ModelManager.tsx`** — 新建抽屉面板组件:
- `Header` — 标题 + 关闭按钮
- `DeviceInfoCard` — GPU 名称、显存、内存、CPU 核数
- `RecommendedModels` → `ModelRow` — 每个模型显示名称、所需显存、任务类型、推荐标签、安装/卸载按钮、下载进度条
- `OllamaStatus` — 来源、运行状态、已安装模型数

**`useAppStore.ts`** 新增状态:
- `modelManagerOpen` — 面板开关
- `modelRecommendations` — 推荐模型列表
- `modelActionProgress` — 当前安装/卸载进度
- `setModelManagerOpen` — 开关 action
- 事件处理: `model.list` 到达时，若无已安装模型自动打开面板

**`App.tsx`** 集成:
- 齿轮图标按钮（紧邻 ModelIndicator + RoutingPreference）
- 渲染 `<ModelManager sendEvent={sendEvent} />`
- WebSocket 连接时发送 `model.list` 请求

### 自动弹出逻辑

1. 用户切换到 `local` → 后端发送 `model.list` 事件
2. 前端收到 `model.list` 且 `installedModels` 为空 → 自动设置 `modelManagerOpen: true`
3. 面板打开，用户选择模型安装

### 关键文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/shared/src/types.ts` | 修改 | ModelRecommendation 类型 + model.* 事件 |
| `packages/server/src/modules/routing/ollama.service.ts` | 修改 | 新增 deleteModel 方法 |
| `packages/server/src/modules/routing/routing.service.ts` | 修改 | 新增 getModelRecommendations |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | 修改 | model.* 事件处理 + 自动弹出 |
| `packages/client/src/components/ModelManager.tsx` | **新建** | 模型管理抽屉面板 |
| `packages/client/src/store/useAppStore.ts` | 修改 | 面板状态 + 推荐列表 + 进度 |
| `packages/client/src/App.tsx` | 修改 | 齿轮按钮 + ModelManager 组件 |

### 验证结果

1. 前端 + 后端构建通过
2. TypeScript 类型检查无新错误
3. 推荐逻辑边界值测试正确（24GB/8GB/无 GPU 等场景）
4. 自动弹出逻辑验证正确（无模型→打开，有模型→不打开）
5. deleteModel API 格式符合 Ollama 规范
