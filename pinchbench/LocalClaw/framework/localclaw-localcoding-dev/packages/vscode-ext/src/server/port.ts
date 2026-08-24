import * as net from "net";

/**
 * 端口选择,复刻 electron/main.cjs 的 canListen / getRandomFreePort / pickFreePort。
 * 与 server 一致绑 127.0.0.1,避免「回环可监听但 0.0.0.0 被占」的误判。
 * 注意:插件可能与已运行的桌面版 server 撞端口,故 preferred 用不同默认值。
 */

export function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, "127.0.0.1");
  });
}

export function getRandomFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export async function pickFreePort(preferred: number): Promise<number> {
  if (await canListen(preferred)) return preferred;
  return getRandomFreePort();
}
