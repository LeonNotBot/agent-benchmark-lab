# `POST /api/deploy` 接口签名规范

> 面向 asdc-coding 服务端的对接文档。客户端（LocalClaw 本地 server）按本规范加签，服务端按本规范强制验签。

## 1. 背景与安全边界

LocalClaw 的本地 server 运行在**用户自己的机器**上，会把用户代码打包成 zip，通过 `POST /api/deploy` 提交到 asdc 部署系统。

本签名方案采用**静态共享密钥 + HMAC-SHA256**，目标明确：

- ✅ 防篡改：包指纹、config、时间戳被中间人改动 → 验签失败。
- ✅ 防重放：同一请求无法被重复提交（时间窗 + nonce 去重）。
- ⚠️ **不做强身份认证**：secret 嵌在分发给用户的客户端内，理论上可被逆向提取。本方案是「防误改 / 防中间人 / 防重放」的护栏，不等同于「证明调用方身份」。双方已就此达成共识。

## 2. 密钥约定

| 项 | 说明 |
|---|---|
| `secret` | 32 字节随机密钥，hex 或 base64 字符串，双方带外约定，不入代码库 |
| `keyId` | 密钥标识，随请求头携带。服务端按 `keyId` 取对应 secret 验签 |
| 轮换 | 服务端可同时挂多把密钥（`keyId → secret` 映射）。换密钥时新旧并存一段时间，平滑过渡 |

## 3. 请求头

`file` + `config` 的 multipart body **完全不变**，签名信息全部放在请求头：

```
X-Deploy-Key-Id:     <keyId>
X-Deploy-Timestamp:  <unix 毫秒时间戳，字符串>
X-Deploy-Nonce:      <16 字节随机数的 hex，长度 32>
X-Deploy-Signature:  <hex(HMAC_SHA256)>
```

## 4. 签名算法

### 4.1 待签名字符串（canonical string）

7 个字段按**固定顺序**用 `\n`（单个换行符，0x0A）连接：

```
canonicalString =
  "POST"            + "\n" +   // 固定方法名
  "/api/deploy"     + "\n" +   // 固定路径
  timestamp         + "\n" +   // = X-Deploy-Timestamp
  nonce             + "\n" +   // = X-Deploy-Nonce
  keyId             + "\n" +   // = X-Deploy-Key-Id
  deployId          + "\n" +   // = config.deployId，本身就是 zip 内容的 sha256
  sha256Hex(configJson)        // 对 multipart 中 config 字段「原文字符串」做 sha256
```

### 4.2 关键约定（双方必须一致，否则算不出同一个签名）

- **不对整个 multipart body 签名**。文件可能几十 MB，且 boundary、流式构造不确定。文件完整性由 `deployId`（= zip 内容 sha256）担保。
- `sha256Hex(configJson)` 中的 `configJson`，是**实际放进 multipart `config` 字段的那个字符串原文**——逐字节一致。
  - 客户端：先把 config 序列化成最终字符串，对**同一份字符串**既算 sha256、又写进 body。
  - 服务端：直接取 body 里 `config` 字段的原文字符串算 sha256，**不要反序列化后再重新序列化**（避免 key 顺序、空格差异导致 hash 不一致）。
- 所有字段值取字符串形态；`timestamp` 是毫秒整数的十进制字符串。

### 4.3 签名

```
signature = lowercase(hex(HMAC_SHA256(secret, canonicalString)))
```

`X-Deploy-Signature` 即此值。

## 5. 服务端校验流程（强制验签，按序短路，任一不过即拒）

| 步骤 | 校验 | 不通过 |
|---|---|---|
| 1 | 4 个 `X-Deploy-*` 请求头齐全 | `401` |
| 2 | `keyId` 能查到对应 secret | `401` |
| 3 | `timestamp` 在 `now ± 10 分钟` 内 | `401`（防重放·时间窗） |
| 4 | `nonce` 在时间窗内未使用过；通过则立即登记 | `401`（防重放·去重） |
| 5 | 用 secret 重建 canonicalString 算 HMAC，与 `X-Deploy-Signature` **常量时间比较** | `401` |
| 6 | （建议）落盘 zip 后重算 sha256，与 `deployId` 比对 | `400` |

约定细节：

- **时间窗 = ±10 分钟**。`timestamp` 在客户端「发起请求时」取值；上传大包的耗时不计入窗口（窗口比对的是请求到达时刻，不是上传结束时刻）。
- **nonce 去重用 Redis**（多实例部署必须共享存储，否则重放可打到未存过该 nonce 的另一实例）。
  - key 建议：`deploy:nonce:<keyId>:<nonce>`
  - 写入用 `SET key 1 NX EX 600`（TTL = 时间窗 600 秒）。`NX` 失败即视为重放。
  - 顺序建议：**先验签（步骤 5）通过，再登记 nonce**，避免无效请求污染去重空间。
- 步骤 5 的比较务必用常量时间比较（如 `crypto.timingSafeEqual`），不要用 `===`，防时序侧信道。
- 强制模式：缺少签名头的请求一律 `401`，不放行。建议**上线初期先灰度放行并记录日志**，确认客户端版本铺开后再切强制拒绝。

## 6. 错误响应建议

| HTTP | 场景 | body 示例 |
|---|---|---|
| 401 | 头缺失 / keyId 未知 / 时间窗超限 / nonce 重放 / 签名失配 | `{"error":"signature verification failed","code":"SIG_INVALID"}` |
| 400 | 落盘后文件 hash 与 deployId 不符 | `{"error":"package hash mismatch","code":"HASH_MISMATCH"}` |

> 为避免给攻击者过多信息，401 的各子原因可对外统一文案，仅在服务端日志区分。

## 7. 服务端参考实现（Python）

> 仅供对齐算法。请按 asdc 实际框架（Flask / Django 等）改写，**算法与字段顺序不可变**。
> 标准库 `hashlib` / `hmac` 即可，无需第三方密码库；nonce 去重用 `redis-py`。

### 7.1 框架无关的核心（纯函数，可直接单测）

```python
import hashlib
import hmac
import time

WINDOW_MS = 10 * 60 * 1000          # ±10 分钟
NONCE_TTL = 600                     # 秒，= 时间窗
KEYS = {"default": "<secret-from-config>"}   # keyId -> secret，建议从环境变量/配置中心读


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def build_canonical(timestamp: str, nonce: str, key_id: str,
                    deploy_id: str, config_json: str) -> str:
    # 字段顺序、分隔符 "\n" 不可变
    return "\n".join([
        "POST", "/api/deploy", timestamp, nonce, key_id,
        deploy_id, sha256_hex(config_json),
    ])


def verify_signature(headers: dict, config_json: str, redis_client) -> bool:
    """headers: 取自请求头；config_json: multipart 中 config 字段的“原文字符串”。
    返回 True 表示验签 + 防重放均通过。务必先验签通过再登记 nonce。"""
    key_id = headers.get("X-Deploy-Key-Id")
    timestamp = headers.get("X-Deploy-Timestamp")
    nonce = headers.get("X-Deploy-Nonce")
    signature = headers.get("X-Deploy-Signature")
    if not (key_id and timestamp and nonce and signature):
        return False

    secret = KEYS.get(key_id)
    if not secret:
        return False

    # 时间窗：±10 分钟
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(int(time.time() * 1000) - ts) > WINDOW_MS:
        return False

    # 用 config 原文重建 canonical（不要反序列化后再重新序列化）
    deploy_id = __import__("json").loads(config_json)["deployId"]  # 仅取值，hash 仍用原文
    canonical = build_canonical(timestamp, nonce, key_id, deploy_id, config_json)
    expected = hmac.new(secret.encode("utf-8"),
                        canonical.encode("utf-8"),
                        hashlib.sha256).hexdigest()
    # 常量时间比较，防时序侧信道
    if not hmac.compare_digest(signature, expected):
        return False

    # 验签通过后再登记 nonce：SET NX EX 原子去重，已存在即视为重放
    ok = redis_client.set(f"deploy:nonce:{key_id}:{nonce}", "1", nx=True, ex=NONCE_TTL)
    return bool(ok)
```

### 7.2 FastAPI 接入示例

```python
from fastapi import FastAPI, UploadFile, Form, Request, HTTPException
import redis

app = FastAPI()
r = redis.Redis(host="127.0.0.1", port=6379, decode_responses=True)


@app.post("/api/deploy")
async def deploy(request: Request, file: UploadFile, config: str = Form(...)):
    # config 形参即 multipart 中 config 字段的原文字符串，直接用于验签
    if not verify_signature(dict(request.headers), config, r):
        raise HTTPException(status_code=401,
                            detail={"error": "signature verification failed",
                                    "code": "SIG_INVALID"})

    # （建议）落盘 zip 后重算 sha256，与 deployId 比对，不符返回 400 HASH_MISMATCH
    # ... 正常部署逻辑 ...
    return {"deploymentId": "..."}
```

> 注意：Starlette/FastAPI 的 header 名大小写不敏感，`dict(request.headers)` 的 key 是小写。
> 若用小写访问，请把 `verify_signature` 里的 `headers.get("X-Deploy-Key-Id")` 改为 `headers.get("x-deploy-key-id")`，其余同理。

## 8. 测试向量（务必先用它对齐实现）

用以下固定输入，应能算出完全相同的 `signature`：

```
secret      = test-secret-do-not-use-in-prod
keyId       = default
timestamp   = 1750000000000
nonce       = 0123456789abcdef0123456789abcdef
deployId    = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
configJson  = {"deployId":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","name":"demo-app"}
```

中间值与结果：

```
sha256(configJson) = a9ad81ca1da19ec9914a6d81d49ef4a403aca1cdc547bab9ea7986b7d72a38dc

canonicalString（\n 为换行符）=
POST
/api/deploy
1750000000000
0123456789abcdef0123456789abcdef
default
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
a9ad81ca1da19ec9914a6d81d49ef4a403aca1cdc547bab9ea7986b7d72a38dc

signature = 8cf595d4886c539dc7bf8af25b82b2a559f508f6a41f8a3bf96a286b06ff53d0
```

> 若服务端算出的 signature 与上面一致，说明字段顺序、换行符、config 原文处理三处都对齐了。
