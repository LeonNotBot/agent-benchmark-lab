# @lenovo/agent-protocol

> AI Coding Agent SDK 的共享协议与领域类型 ｜ 当前版本 `0.1.0`

纯类型包,**零运行时依赖**。为 SDK、服务端与前端提供统一的契约类型,确保三端协议一致。

- **传输契约**:`ServerEvent` / `ClientEvent` 等 WebSocket 线协议类型。
- **领域类型**:routing / session / channel / diff / scheduled 等领域模型。

## 为什么单独成包

前端(Vite 打包)需要这些类型,但不能依赖含 `better-sqlite3` / `@nestjs/*` 等 Node 服务端运行时的 `@lenovo/agent-sdk`,否则前端构建会被迫处理 node 内置模块导致体积爆炸。因此把纯类型独立成零依赖包,`sdk` 与 `client` 均依赖它。

```
@lenovo/agent-protocol   纯类型，零运行时依赖
  ├── @lenovo/agent-sdk   依赖它，含 node 运行时
  └── client              依赖它，不碰 sdk
```

## 安装

```bash
npm install @lenovo/agent-protocol
```

> 私有仓库 `https://registry-smb.lenovo.com`。

## 用法

```typescript
import type { ServerEvent, ClientEvent } from "@lenovo/agent-protocol";
```

从包入口或 `@lenovo/agent-protocol/src/types` 导入均可(入口统一从 `types.ts` 重导出)。

## 许可

私有包,仅限 Lenovo 内部产品线使用。
