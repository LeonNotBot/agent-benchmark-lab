/**
 * vendored claude-cli 无类型声明。它是 side-effect import（import 即点火，
 * 读 process.argv/env 启动，无导出），故声明为空模块即可满足 tsc。
 */
declare module "@lenovo/claude-cli/cli-node.js";
