# ClawHub Top 27 Skills 集成可行性分析报告

**日期：** 2026-05-09  
**项目：** LocalClaw（本地化 Claude Code 管理平台）  
**主题：** ClawHub Top 27 Skills 复用成本与改造方案

---

## 一、结论摘要

| 维度 | 结论 |
|------|------|
| **格式兼容性** | ✅ 27个Skills均采用标准SKILL.md格式，与LocalClaw完全兼容 |
| **Windows即用** | 8个Skills（30%）在Windows上完全兼容，无需任何改造 |
| **Windows小改** | 13个Skills（48%）存在路径/命令细节问题，需轻量适配 |
| **Windows大改** | 6个Skills（22%）依赖Bash脚本或明确标注不支持Windows |

**Windows平台是主要变量。** 格式层面零障碍，核心挑战在于：Skills中大量使用Unix路径风格、shell脚本和brew安装指引，需要系统性的Windows适配层。

---

### 跨平台兼容性速览

```
                Linux/Mac    Windows
纯文档型Skills    ✅ 即用      ✅ 即用
API Key型Skills  ✅ 即用      ✅ 大部分即用（curl已内置）
CLI工具型Skills  ✅ 即用      ⚠️ 需替换安装方式（brew→scoop）
Bash脚本型Skills ✅ 即用      ❌ 需重写为PowerShell或Python
```

---

## 二、27个Skills全景分析

### 2.1 按功能分类

| 分类 | 数量 | 代表Skills |
|------|------|------------|
| 搜索与信息检索 | 6 | baidu-search、brave-search、weather、stock-analysis |
| 文档与知识管理 | 5 | notion、obsidian、nano-pdf、ontology、elite-longterm-memory |
| 桌面与媒体自动化 | 5 | desktop-control、agent-browser-clawdbot、nano-banana-pro、openai-whisper、sonoscli |
| AI Agent框架 | 5 | proactive-agent、self-improving、humanizer、skill-creator、skill-vetter |
| 第三方平台集成 | 6 | github、gog、admapix、mcporter、polymarket-trade、auto-updater |

### 2.2 Windows平台兼容性全量评估

经过逐一检查每个Skill的脚本内容，Windows兼容性分布如下：

| 兼容级别 | 数量 | 代表问题 |
|---------|------|---------|
| ✅ 完全兼容 | 8个 | 无平台特定依赖 |
| ⚠️ 部分兼容 | 13个 | 路径风格/brew安装指引/python3命令 |
| ❌ 不兼容 | 6个 | 含Bash脚本/明确标注不支持Windows |

#### ✅ 完全兼容（8个）

| Skill | 原因 |
|-------|------|
| weather | 使用curl调用公开API，Windows 10+内置curl |
| multi-search-engine | 同上，无平台差异 |
| humanizer | 仅依赖Claude内置工具（Read/Write/Edit） |
| self-improving | 本地文件操作，Claude内置工具 |
| skill-vetter | curl可选调用，核心为文档型 |
| baidu-search | Python脚本+requests，跨平台 |
| brave-search | Node.js脚本，跨平台 |
| github | gh CLI官方支持Windows |

#### ⚠️ 部分兼容（13个）— 需轻量适配

**共性问题一：路径风格（影响11个Skills）**
Skills脚本中硬编码了Unix路径（`~/.config/`、`~/.cache/`、`~/.polymarket/`），在Windows上应为`%APPDATA%`。Python层面用`os.path.expanduser()`可自动处理，但Shell脚本中无法自动转换。

**共性问题二：brew安装指引（影响4个）**
gog、obsidian、openai-whisper、sonoscli的安装说明只写了`brew install`，Windows用户需要改用scoop/winget等替代安装方式。这是**文档问题而非功能问题**。

**共性问题三：`python3`命令（影响6个）**
Windows上Python通常注册为`python`而非`python3`，脚本若硬编码`python3`会报"找不到命令"。

| Skill | 具体问题 | 修复难度 |
|-------|---------|---------|
| notion | curl路径+config目录风格 | 低 |
| obsidian | brew→scoop+`~/.config`路径 | 低 |
| nano-pdf | uv跨平台，基本兼容 | 极低 |
| nano-banana-pro | uv跨平台，基本兼容 | 极低 |
| openai-whisper | brew→pip安装+`~/.cache/whisper`路径 | 低 |
| gog | brew→scoop+OAuth文件权限 | 低 |
| mcporter | npm支持但路径拼接问题 | 低 |
| stock-analysis | uv跨平台，home目录路径 | 低 |
| polymarket-trade | python3命令+home目录路径 | 低 |
| openclaw-tavily-search | python3命令+路径 | 低 |
| elite-longterm-memory | 脚本含`rm -rf`命令 | 中 |
| skill-creator | ZIP处理+目录权限 | 中 |
| ontology | `mkdir -p`命令+路径分隔符 | 中 |

#### ❌ 不兼容（6个）— 需重大改造或豁免

| Skill | 核心问题 | 建议处理 |
|-------|---------|---------|
| **proactive-agent** | `scripts/security-audit.sh`含大量Unix命令（stat -f、grep、awk、ANSI颜色） | 提供PowerShell重写版本，或禁用该脚本，保留核心提示词部分 |
| **auto-updater** | metadata明确标注`os: ["darwin","linux"]`，使用Unix cron + clawdbot CLI | 标注"暂不支持Windows"，待后续Windows Task Scheduler适配 |
| **desktop-control** | pyautogui在Windows需UAC权限，DPI缩放支持不完善，多显示器场景复杂 | 标注"需管理员权限"，提供权限检测脚本 |
| **agent-browser-clawdbot** | 依赖私有CLI，安装时拉取Linux依赖 | 暂缓，等待官方Windows版本 |
| **sonoscli** | Go CLI的SSDP广播在Windows防火墙环境下受限 | 标注"需手动开放防火墙端口" |
| **admapix** | 虽然Python跨平台，但安装脚本含Unix特定逻辑 | 改造安装脚本（约0.5天） |

### 2.3 依赖复杂度分层（综合视角）

#### 第一层：即装即用（纯文档型/内置工具）
self-improving、humanizer、skill-creator、skill-vetter、weather、multi-search-engine — 平台无关，直接复用。

#### 第二层：需API Key或Python/Node环境
baidu-search、brave-search、notion、nano-banana-pro、nano-pdf、openai-whisper、openclaw-tavily-search、stock-analysis、polymarket-trade、gog、elite-longterm-memory、admapix — Windows上需小改（安装方式文档+python3→python兼容）。

#### 第三层：依赖特定CLI工具
github（gh）、obsidian（obsidian-cli）、mcporter（mcporter）、ontology（python3脚本）、sonoscli（Go CLI）— Windows上需替换安装指引。

#### 第四层：需重大改造或豁免
proactive-agent（Bash脚本）、auto-updater（明确不支持Windows）、desktop-control（UAC权限）、agent-browser-clawdbot（私有CLI）— 需单独评估。

---

## 三、当前项目能力评估

### 3.1 已有能力（无需新建）

LocalClaw已实现完整的Skill管理体系，具备以下核心能力：

**Skill生命周期管理**
- 自动扫描 `~/.localclaw/skills/` 目录加载Skills
- REST API支持增删改查（`/api/skills`）
- Zip导入/导出支持批量迁移

**市场与来源管理**
- GitHub仓库扫描模式（目录自动发现）
- Registry JSON索引模式
- **已内置ClawHub格式清洗逻辑**（关键：manifest.json → SKILL.md自动转换）

**前端交互**
- Skill管理面板（SkillManager.tsx）
- `/` 快捷触发菜单
- Skill编辑器（SkillEditor.tsx）

### 3.2 能力缺口（需要补充）

| 缺口 | 现状 | 影响范围 |
|------|------|----------|
| 依赖检测 | 无法自动检测用户机器是否有gh、python3等工具 | 第三层6个Skills |
| API Key管理 | 无Key配置引导界面 | 第二层10个Skills |
| 批量安装 | 只支持逐个安装 | 用户体验 |
| 健康检查 | Skill运行前无验证机制 | 所有Skills |

---

## 四、改造方案

### 方案A：最小化改造（推荐）

**核心思路：** Skills文件本身不做大改，主要在LocalClaw平台层增加Windows兼容性检测和用户引导。

#### Phase 1 — 平台兼容性标注（1天）
将27个Skills按Windows兼容性打标，安装时向用户展示兼容性状态，避免无效安装。

在SKILL.md中补充字段：
```yaml
supported-platforms: [linux, darwin, win32]
windows-notes: "需管理员权限运行"
```

#### Phase 2 — Python命令兼容适配（0.5天）
在LocalClaw后端的Skill执行器中注入平台适配：Windows环境下将`python3`自动映射为`python`，路径分隔符统一处理。

#### Phase 3 — 安装引导增强（1.5天）
Skill详情页根据当前平台展示对应安装命令（brew / scoop / winget / pip），API Key在界面中引导配置。

#### Phase 4 — 依赖健康检查（1.5天）
安装前检测环境：`gh`/`python`/`node`等CLI是否存在，缺失时给出安装链接而非静默失败。

#### Phase 5 — 打包内置技能包（0.5天）
将8个即用型Skills打包为LocalClaw内置礼包，首次启动自动安装。

**Phase 1-5合计：约5天**

---

### 方案B：深度Windows适配（可选）

对6个不兼容Skills做逐一改造：

| Skill | 改造内容 | 工作量 |
|-------|---------|--------|
| proactive-agent | 将security-audit.sh重写为Python跨平台版本 | 1天 |
| auto-updater | 新增Windows Task Scheduler支持 | 2天 |
| desktop-control | 添加UAC权限检测+提升机制 | 1.5天 |
| admapix | 修复安装脚本的Unix特定逻辑 | 0.5天 |
| ontology | 将`mkdir -p`和路径拼接改为Python实现 | 0.5天 |
| elite-longterm-memory | 将`rm -rf`改为Python的shutil | 0.5天 |

**方案B额外合计：约6天**

---

### 方案C：深度市场集成（长期可选）

| 工作内容 | 工作量 |
|---------|--------|
| ClawHub API对接（实时拉取最新版本） | 2天 |
| Skill版本管理（更新/回滚） | 2天 |
| Skill评分/收藏/推荐系统 | 3天 |

**方案C额外合计：约7天**

---

## 五、风险与注意事项

### 5.1 Windows平台专项风险

| 风险 | 等级 | 应对措施 |
|------|------|----------|
| `python3` 命令在Windows不存在 | 高 | 平台检测层自动映射python3→python |
| Bash脚本（.sh）在Windows无法直接执行 | 高 | 标注不兼容，提供PowerShell替代版本 |
| desktop-control 的UAC权限拦截 | 高 | 安装前检测权限，提示以管理员身份运行 |
| Unix路径风格（`~/.config`）在Windows解析错误 | 中 | 统一用`os.path.expanduser()`处理 |
| brew安装指引对Windows用户无效 | 中 | 文档层补充Windows安装命令（scoop/winget） |
| auto-updater明确不支持Windows | 中 | 在UI上标注"仅限macOS/Linux" |
| Windows Defender对pyautogui模拟输入的拦截 | 中 | 安装引导中说明需加白名单 |

### 5.2 通用风险

| 风险 | 等级 | 应对措施 |
|------|------|----------|
| agent-browser-clawdbot依赖私有CLI | 中 | 先上架其余26个，此Skill暂标注"需单独安装" |
| elite-longterm-memory依赖LanceDB向量库 | 中 | 提供Docker镜像或本地安装脚本 |
| API Key安全存储 | 高 | 使用系统Keychain，不明文写入配置文件 |

### 5.3 合规说明

- 27个Skills均为ClawHub平台公开发布内容，引用需注明来源
- 部分Skills涉及商业API（AdMapix等），用户需自行注册并遵守对应服务条款
- 桌面控制类Skills需在用户明确授权后启用

---

## 六、建议与决策点

### 核心建议

**第一步（立即，0.5天）：** 将8个Windows完全兼容的Skills打包为内置礼包，下个版本直接发布，零成本上线亮点功能。

**第二步（1-2周，4.5天）：** 完成平台兼容性标注+安装引导增强，覆盖全部27个Skills的展示管理，用户可明确知道哪些Skills在自己的机器上能用。

**第三步（1个月，可选，6天）：** 对6个不兼容Skills做逐一改造，重点是proactive-agent和auto-updater，让Windows用户也能获得近似体验。

**第四步（长期，可选，7天）：** 对接ClawHub API，实现持续同步和版本管理。

### 关键决策

> **Windows用户是否是核心目标群体？**  
> 如果是，建议方案A+B共11天，实现100%Skills跨平台覆盖。  
> 如果不是，仅方案A共5天，标注不兼容的Skills，让Windows用户知情即可。

---

## 附录：27个Skills完整兼容性速查

| Skill | 功能 | Windows兼容 | 主要依赖 | 需配置 |
|-------|------|------------|---------|--------|
| weather | 天气查询 | ✅ | curl | 无 |
| multi-search-engine | 17搜索引擎 | ✅ | curl | 无 |
| humanizer | 去AI痕迹 | ✅ | 内置工具 | 无 |
| self-improving | 自改进框架 | ✅ | 内置工具 | 无 |
| skill-vetter | Skill审计 | ✅ | curl（可选） | 无 |
| baidu-search | 百度AI搜索 | ✅ | python | API Key |
| brave-search | Brave搜索 | ✅ | Node.js | API Key |
| github | GitHub操作 | ✅ | gh CLI | CLI认证 |
| notion | Notion管理 | ⚠️ | curl | API Key |
| obsidian | 笔记自动化 | ⚠️ | obsidian-cli | 安装CLI |
| nano-pdf | PDF编辑 | ⚠️ | nano-pdf(uv) | 安装CLI |
| nano-banana-pro | AI图像生成 | ⚠️ | uv | API Key |
| openai-whisper | 语音转文字 | ⚠️ | python | 本地模型 |
| gog | Google Workspace | ⚠️ | gog CLI | OAuth |
| mcporter | MCP直接调用 | ⚠️ | mcporter CLI | 安装CLI |
| stock-analysis | 股票分析 | ⚠️ | uv/python | 无 |
| polymarket-trade | 预测市场 | ⚠️ | python | 无 |
| openclaw-tavily-search | Tavily搜索 | ⚠️ | python | API Key |
| elite-longterm-memory | AI长期记忆 | ⚠️ | python+LanceDB | API Key |
| skill-creator | Skill创建指南 | ⚠️ | python | 无 |
| ontology | 知识图谱 | ⚠️ | python | 无 |
| admapix | 广告情报 | ⚠️ | python | API Key |
| sonoscli | Sonos控制 | ⚠️ | Go CLI+硬件 | 硬件 |
| proactive-agent | 主动Agent框架 | ❌ | Bash脚本 | 需重写脚本 |
| auto-updater | 自动更新 | ❌ | Unix cron | 明确不支持 |
| desktop-control | 桌面自动化 | ❌ | pyautogui+UAC | 需管理员权限 |
| agent-browser-clawdbot | 浏览器自动化 | ❌ | 私有CLI | 待官方支持 |

---

*报告生成于 2026-05-09 | LocalClaw项目组*