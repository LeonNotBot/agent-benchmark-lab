/**
 * 主进程 telemetry 支撑:匿名设备 ID 的生成与持久化。
 *
 * 设备 ID 落点为 userData/telemetry-id.json(单一真相源,不进 agent-settings),
 * 与配置解耦——用户重置统计标识时删此文件即可,不影响其他设置。
 * 仅含随机 UUID,不含机器名/MAC/用户名等任何可定位信息。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

/**
 * 读取或生成匿名设备 ID。
 * @param {string} userDataDir app.getPath("userData")
 * @returns {string} UUID v4
 */
function getOrCreateInstanceId(userDataDir) {
  const file = path.join(userDataDir, "telemetry-id.json");
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed.instanceId === "string" && parsed.instanceId) {
        return parsed.instanceId;
      }
    }
  } catch {
    // 坏文件:落到重新生成分支,覆盖写回。
  }
  const instanceId = crypto.randomUUID();
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ instanceId, createdAt: Date.now() }), "utf8");
  } catch {
    // 写盘失败不阻断启动;本次会话用内存里的 ID,下次再尝试持久化。
  }
  return instanceId;
}

module.exports = { getOrCreateInstanceId, reportFromMain };

/**
 * 主进程上报:POST 信封到本地 server /api/telemetry。
 * server 侧做 release/开关双闸门,故主进程无条件发送即可(dev 态 server 会丢弃)。
 * fire-and-forget,失败静默——打点绝不能影响主进程稳定性。
 *
 * @param {number} port 本地 server 端口
 * @param {object} envelope { type, ts?, instanceId?, version?, platform?, payload? }
 */
function reportFromMain(port, envelope) {
  try {
    const body = JSON.stringify(envelope);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/telemetry",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 2000,
      },
      (res) => { res.resume(); },
    );
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.write(body);
    req.end();
  } catch {
    // 静默
  }
}
