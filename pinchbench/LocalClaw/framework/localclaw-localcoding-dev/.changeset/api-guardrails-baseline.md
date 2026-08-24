---
"@lenovo/agent-protocol": patch
"@lenovo/agent-sdk": patch
"@lenovo/agent-sdk-channel": patch
---

建立对外接口护栏与发布流程:接入 api-extractor 生成公共面基线快照(`etc/*.api.md`),新增 `api:check` / `api:update` 校验脚本,并以 changesets 管理版本与发布。此为基线版本,公共面无破坏性变更。
