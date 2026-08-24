/**
 * 测试环境全局 setup。
 *
 * runner-spawn.service.ts 模块加载时 resolveCliPath() 会在顶层执行，
 * 若找不到 CLI 则抛错。测试环境没有真实 CLI 二进制也不需要跑它，
 * 设一个假路径让 resolveCliPath 第一优先级返回即可。
 */
process.env.CLAUDE_CLI_PATH = "/fake/cli-for-test";
