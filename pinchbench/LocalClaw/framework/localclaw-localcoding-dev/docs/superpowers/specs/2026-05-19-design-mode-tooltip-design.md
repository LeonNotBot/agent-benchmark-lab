# 设计功能温馨提示气泡 — 技术设计文档

> 在 PromptInput 底部"设计"按钮被切换为开启时，弹出温馨提示气泡，告知用户该功能用途及前置条件（VSCode + Pencil 插件），仅可通过 × 按钮关闭。

## 一、需求概述

### 目标

在 `PromptInput` 底部工具栏的"设计"按钮（即"启用设计功能"按钮）旁，新增一个**温馨提示气泡**。当用户点击按钮把"设计模式"从关闭切换为开启时，气泡自动弹出；用户必须通过气泡右上角的 × 关闭按钮来关闭气泡。

### 业务价值

- 让用户在首次/每次启用时，都能知晓该功能是用于"生成设计稿替代 Figma"
- 在用户开始使用之前，明确告知前置条件（VSCode + Pencil 插件），避免后续因环境缺失导致的失败困惑

---

## 二、需求细节

### 2.1 触发条件

| 用户操作 | 是否触发气泡 |
|----------|-------------|
| 点击按钮：`designMode: false → true`（开启） | ✅ 触发 |
| 点击按钮：`designMode: true → false`（关闭） | ❌ 不触发，且若气泡已显示则同步隐藏 |
| 页面初始化、刷新、首次加载 | ❌ 不触发 |
| 任何其他位置的交互 | ❌ 不触发 |

### 2.2 气泡内容

- **标题**：`设计功能温馨提示`
- **关闭按钮**：右上角 × 图标按钮
- **功能说明**：`该功能是辅助开发者生成设计稿替代 Figma`
- **前置条件区**（带醒目视觉块）：
  - 小标题：`使用前置条件`
  - 要点 1：`在电脑上安装并打开 VSCode`
  - 要点 2：`在 VSCode 中安装 Pencil 插件`

### 2.3 关闭方式

- **唯一关闭方式**：点击气泡右上角的 × 按钮
- 不支持点击外部关闭、不支持 ESC 关闭、不自动消失
- 当用户主动关闭设计模式（再次点击使其变 false）时，气泡也应同步消失（防止状态错乱）

---

## 三、UI 视觉规格

### 3.1 整体布局

气泡在"设计"按钮**正上方**弹出，使用 `absolute` 定位，带朝下小三角指向按钮：

```
        ┌─────────────────────────────────────────────┐
        │  设计功能温馨提示                        ×   │
        │  ─────────────────────────                  │
        │  该功能是辅助开发者生成设计稿替代 Figma        │
        │                                              │
        │  ┌──────────────────────────────────────┐  │
        │  │ ⓘ 使用前置条件                        │  │
        │  │ • 在电脑上安装并打开 VSCode            │  │
        │  │ • 在 VSCode 中安装 Pencil 插件         │  │
        │  └──────────────────────────────────────┘  │
        └────────────────▼────────────────────────────┘
                         │
                       [ 🎨 设计 ● ]
```

### 3.2 容器样式

| 项 | 值 |
|----|----|
| 定位 | `absolute bottom-full left-0 mb-2 z-30` |
| 尺寸 | `w-72`（288px），高度自适应 |
| 背景与描边 | `bg-white rounded-xl border border-border-300 shadow-elevated` |
| 内边距 | `p-3` |
| 小三角 | 底部居左偏移 16px，向下指向按钮（CSS 三角形或 SVG） |

### 3.3 标题区

| 元素 | 样式 |
|------|------|
| 标题"设计功能温馨提示" | `text-sm font-medium text-text-100` |
| × 关闭按钮 | `w-5 h-5 rounded text-text-400 hover:bg-bg-200 hover:text-text-200`，居右对齐 |
| 标题区底部分隔线 | `border-b border-border-300 mt-2 mb-2` |

### 3.4 功能说明区

```
该功能是辅助开发者生成设计稿替代 Figma
```

样式：`text-xs text-text-300 leading-relaxed`

### 3.5 前置条件区（视觉强调块）

| 元素 | 样式 |
|------|------|
| 容器 | `mt-2.5 rounded-lg bg-purple-light3/50 p-2.5` |
| 子标题 ⓘ + "使用前置条件" | `text-[11px] font-medium text-accent-brand flex items-center gap-1` |
| 要点列表 | `mt-1.5 space-y-1 text-xs text-text-200 leading-relaxed` |
| 每个要点 | 前缀紫色实心圆点 `before:content-['•'] before:text-accent-brand before:mr-1.5` 或使用 `<ul>` + 自定义 marker |

### 3.6 视觉层次原则

- **标题区** 字号最大、最深，配合下分隔线建立明显边界
- **功能说明** 行文字色中等
- **前置条件** 用浅紫底色块从背景中"凸"出来，强调"必须看"的信息
- 所有文字使用 `leading-relaxed` 提高可读性

---

## 四、技术实现方案

### 4.1 文件改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/client/src/components/PromptInput.tsx` | 修改 | 改造现有 `DesignModeToggle` 组件：新增本地 state、新增气泡子组件 |

**仅 1 个文件改动。** 不涉及 store、不涉及后端、不涉及 shared types。

### 4.2 状态管理

气泡的显隐是**纯 UI 局部状态**，无需放到全局 store：

```ts
function DesignModeToggle() {
  const designMode = useAppStore((s) => s.designMode);
  const setDesignMode = useAppStore((s) => s.setDesignMode);
  const [showTip, setShowTip] = useState(false);

  const handleClick = () => {
    const next = !designMode;
    setDesignMode(next);
    if (next) {
      setShowTip(true);   // 开启时弹出气泡
    } else {
      setShowTip(false);  // 关闭设计模式时同步关掉气泡
    }
  };

  return (
    <div className="relative">
      {showTip && <DesignTipPopover onClose={() => setShowTip(false)} />}
      <button onClick={handleClick} ...>
        ...
      </button>
    </div>
  );
}
```

### 4.3 新增子组件 `DesignTipPopover`

放在 `PromptInput.tsx` 内部，与 `DesignModeToggle` 同文件（保持现有结构风格，不为了一个静态展示组件单独建文件）：

```tsx
function DesignTipPopover({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="设计功能温馨提示"
      className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-border-300 bg-white shadow-elevated p-3 z-30"
    >
      {/* 标题 + 关闭 */}
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-medium text-text-100">设计功能温馨提示</h3>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="w-5 h-5 rounded text-text-400 hover:bg-bg-200 hover:text-text-200 flex items-center justify-center -mr-1 -mt-0.5"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="6" y1="18" x2="18" y2="6" />
          </svg>
        </button>
      </div>

      <div className="border-b border-border-300 mt-2 mb-2" />

      {/* 功能说明 */}
      <p className="text-xs text-text-300 leading-relaxed">
        该功能是辅助开发者生成设计稿替代 Figma
      </p>

      {/* 前置条件块 */}
      <div className="mt-2.5 rounded-lg bg-purple-light3/50 p-2.5">
        <div className="text-[11px] font-medium text-accent-brand flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>使用前置条件</span>
        </div>
        <ul className="mt-1.5 space-y-1 text-xs text-text-200 leading-relaxed list-none">
          <li className="flex gap-1.5">
            <span className="text-accent-brand">•</span>
            <span>在电脑上安装并打开 VSCode</span>
          </li>
          <li className="flex gap-1.5">
            <span className="text-accent-brand">•</span>
            <span>在 VSCode 中安装 Pencil 插件</span>
          </li>
        </ul>
      </div>

      {/* 朝下小三角 */}
      <div
        className="absolute -bottom-1.5 left-4 w-3 h-3 bg-white border-r border-b border-border-300 rotate-45"
        aria-hidden="true"
      />
    </div>
  );
}
```

### 4.4 容器调整

`DesignModeToggle` 的最外层 `<button>` 需要外面包一层 `<div className="relative">`，作为 popover 的定位上下文。

---

## 五、错误与边界

| 场景 | 处理 |
|------|------|
| 用户开启 → 关闭设计模式 → 再次开启 | 第二次开启会**重新弹出**气泡（符合"每次启用都出现"需求） |
| 用户开启后未关闭气泡，又点了一次"设计"使其变 false | 气泡同步消失 |
| 多次快速点击 | `setDesignMode(!designMode)` 状态翻转，根据当前 `designMode` 是否变 true 决定显示，无并发问题 |
| 点击页面其他区域 | 气泡**不**关闭（按需求只有 × 能关） |
| 容器溢出 | 气泡宽 288px，左对齐按钮，工具栏左侧空间充足，不会被屏幕右边裁剪 |

---

## 六、不在本次范围内（YAGNI）

明确**不做**以下扩展，避免范围蔓延：

- ❌ "首次启用才显示" 的本地存储记忆（用户明确要求每次启用都显示）
- ❌ 点击外部关闭 / ESC 关闭 / 自动消失（用户明确要求只能 × 关闭）
- ❌ 气泡内嵌"打开 VSCode"按钮、检测 Pencil 是否安装等运行时检测
- ❌ 国际化（项目其他工具栏文案当前为中文硬编码，保持一致）
- ❌ 把气泡组件抽到独立 `Popover` 通用组件（项目内尚无第二个 popover 用例）

---

## 七、测试计划

### 7.1 手动验证

1. 页面加载后，气泡**不应**显示
2. 首次点击"设计"按钮 → 按钮变高亮 + 气泡弹出在按钮上方
3. 气泡内容包含：标题"设计功能温馨提示"、× 关闭按钮、功能说明、前置条件块（含两条要点）
4. 点击 × → 气泡消失，按钮仍保持高亮（设计模式仍开启）
5. 再次点击按钮（关闭设计模式）→ 按钮变灰、气泡保持隐藏
6. 再次点击按钮（再次开启）→ 气泡**重新弹出**
7. 气泡显示期间，再次点击按钮（关闭设计模式）→ 按钮变灰且气泡同步消失
8. 点击气泡内文字、点击页面其他区域、按 ESC → 气泡都不消失
9. 视觉检查：标题字号最大、说明文字次之、前置条件块带浅紫底色，整体层次清晰

### 7.2 回归验证

- 设计模式开启/关闭后，发送消息时 payload 中 `designMode` 值正确
- 工具栏其他按钮（图片、快捷短语、知识库）功能不受影响

---

## 八、涉及文件清单

| 文件 | 操作 | 行数估计 |
|------|------|----------|
| `packages/client/src/components/PromptInput.tsx` | 修改 `DesignModeToggle`，新增 `DesignTipPopover` | +60 行左右 |

无新建文件、无后端改动、无 store/shared types 改动。
