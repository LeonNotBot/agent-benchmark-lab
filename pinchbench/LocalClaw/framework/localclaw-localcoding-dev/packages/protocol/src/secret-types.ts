/**
 * 密钥/隐私信息条目
 */
export interface SecretEntry {
  /** 密钥名称/标识（唯一） */
  key: string;
  /** 密钥值（敏感信息） */
  value: string;
  /** 用途说明 */
  description: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
}

/**
 * 密钥列表响应
 */
export interface SecretListResponse {
  secrets: SecretEntry[];
  /** 磁盘存储路径（供 UI 显示） */
  storagePath: string;
}

/**
 * 创建/更新密钥请求
 */
export interface SecretUpsertRequest {
  key: string;
  value: string;
  description: string;
}

/**
 * 隐私「定义」配置：哪些信息算隐私（用户可在面板编辑，渲染进 CLAUDE.md）。
 */
export interface SecretCategory {
  label: string;
  examples: string;
}

export interface SecretDefConfig {
  categories: SecretCategory[];
  triggerPhrases: string;
  extraRules: string;
}
