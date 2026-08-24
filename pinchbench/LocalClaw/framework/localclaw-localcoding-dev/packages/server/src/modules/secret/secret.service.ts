import { Injectable } from "@nestjs/common";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getSecretsPath } from "@lenovo/agent-sdk";
import type {
  SecretEntry,
  SecretUpsertRequest,
} from "@lenovo/agent-protocol";

interface SecretsStore {
  secrets: SecretEntry[];
}

@Injectable()
export class SecretService {
  private get secretsPath(): string {
    return getSecretsPath();
  }

  /** 确保父目录存在 */
  private ensureDir(): void {
    const dir = dirname(this.secretsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /** 从磁盘读取 secrets */
  private load(): SecretsStore {
    try {
      if (!existsSync(this.secretsPath)) {
        return { secrets: [] };
      }
      const raw = readFileSync(this.secretsPath, "utf-8");
      const data = JSON.parse(raw) as SecretsStore;
      return Array.isArray(data.secrets) ? data : { secrets: [] };
    } catch (err) {
      console.error(`[secret] Failed to load secrets:`, err);
      return { secrets: [] };
    }
  }

  /** 写回磁盘 */
  private save(store: SecretsStore): void {
    this.ensureDir();
    writeFileSync(this.secretsPath, JSON.stringify(store, null, 2), "utf-8");
  }

  /** 列出所有 secrets */
  listSecrets(): SecretEntry[] {
    return this.load().secrets;
  }

  /** 返回磁盘存储路径（供 UI 显示） */
  getStoragePath(): string {
    return this.secretsPath;
  }

  /** 获取单个 secret */
  getSecret(key: string): SecretEntry | null {
    const store = this.load();
    return store.secrets.find((s) => s.key === key) ?? null;
  }

  /** 创建或更新 secret */
  upsertSecret(dto: SecretUpsertRequest): SecretEntry {
    const store = this.load();
    const now = Date.now();
    const idx = store.secrets.findIndex((s) => s.key === dto.key);

    if (idx >= 0) {
      // 更新
      store.secrets[idx] = {
        ...store.secrets[idx],
        value: dto.value,
        description: dto.description,
        updatedAt: now,
      };
      this.save(store);
      return store.secrets[idx];
    } else {
      // 创建
      const entry: SecretEntry = {
        key: dto.key,
        value: dto.value,
        description: dto.description,
        createdAt: now,
        updatedAt: now,
      };
      store.secrets.push(entry);
      this.save(store);
      return entry;
    }
  }

  /** 删除 secret */
  deleteSecret(key: string): boolean {
    const store = this.load();
    const idx = store.secrets.findIndex((s) => s.key === key);
    if (idx < 0) return false;
    store.secrets.splice(idx, 1);
    this.save(store);
    return true;
  }
}
