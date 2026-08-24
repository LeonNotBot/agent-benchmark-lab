/**
 * Legacy channel-daemon 已移除。
 * 微信消息现由 golembot WeixinAdapter → golem-channel-manager → gateway.handleMessage 路径承载。
 * 此占位符防止其他模块误导 ChannelDaemonService 时编译报错。
 */
export const ChannelDaemonService = class {
  isRunning = () => false;
  forwardMessage = () => {};
  restart = () => {};
  stop = () => {};
};
