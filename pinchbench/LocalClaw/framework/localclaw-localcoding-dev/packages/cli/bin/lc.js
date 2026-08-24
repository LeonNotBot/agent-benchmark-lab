#!/usr/bin/env node
/**
 * lc — LocalClaw CLI 入口。
 *
 * 仿照 vendored claude-cli 的 cli-node.js（其内容即 `import "./cli.js"`）：
 * 本文件只负责以 node 运行时点火编译产物，真正的启动逻辑在 dist/index.js。
 */
import "../dist/index.js";
