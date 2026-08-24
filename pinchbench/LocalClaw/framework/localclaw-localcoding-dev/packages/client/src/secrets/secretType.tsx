import type { ReactNode } from "react";

export interface SecretTypeStyle {
  /** 卡片图标 */
  icon: ReactNode;
  /** 类型中文标签 */
  label: string;
  /** 图标徽章渐变背景（tailwind 类） */
  badge: string;
  /** hover 时卡片发光色（hsl 变量或色值） */
  glow: string;
}

// 各类隐私信息的图标（24x24，stroke=currentColor）
const ICONS: Record<string, ReactNode> = {
  id: (<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M5 17c0-1.7 1.8-3 4-3s4 1.3 4 3" /><path d="M15 9h3M15 13h3" /></>),
  bank: (<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></>),
  phone: (<><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>),
  email: (<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></>),
  address: (<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
  password: (<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /><circle cx="12" cy="16" r="1.2" /></>),
  birthday: (<><path d="M4 21h16v-7H4z" /><path d="M4 14a4 4 0 0 1 8 0 4 4 0 0 1 8 0" /><path d="M12 7V3M9 4l3 3 3-3" /></>),
  car: (<><path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13" /><path d="M3 13h18v5H3z" /><circle cx="7" cy="18" r="1.5" /><circle cx="17" cy="18" r="1.5" /></>),
  key: (<><circle cx="8" cy="15" r="4" /><path d="M10.85 12.15 19 4M18 5l2 2M15 8l2 2" /></>),
};

interface TypeDef { test: RegExp; label: string; iconKey: keyof typeof ICONS; badge: string; glow: string; }

// 按 key 名（大写下划线）匹配类型；优先级自上而下。
const TYPE_DEFS: TypeDef[] = [
  { test: /ID_?CARD|PASSPORT|SOCIAL|SSN|DRIVER|证件|身份/, label: "证件号码", iconKey: "id", badge: "from-amber-400 to-orange-500", glow: "245 158 11" },
  { test: /BANK|CARD|CREDIT|CVV|PAY|账号|银行|卡号/, label: "金融信息", iconKey: "bank", badge: "from-emerald-400 to-teal-500", glow: "16 185 129" },
  { test: /PHONE|MOBILE|^TEL|手机|电话/, label: "联系方式", iconKey: "phone", badge: "from-sky-400 to-blue-500", glow: "14 165 233" },
  { test: /EMAIL|MAIL|邮箱/, label: "联系方式", iconKey: "email", badge: "from-cyan-400 to-sky-500", glow: "6 182 212" },
  { test: /ADDRESS|住址|地址/, label: "联系方式", iconKey: "address", badge: "from-violet-400 to-purple-500", glow: "139 92 246" },
  { test: /BIRTH|DOB|生日/, label: "个人信息", iconKey: "birthday", badge: "from-pink-400 to-rose-500", glow: "244 114 182" },
  { test: /PLATE|CAR|VEHICLE|车牌|车辆/, label: "个人信息", iconKey: "car", badge: "from-lime-400 to-green-500", glow: "132 204 22" },
  { test: /PASSWORD|PWD|PASS|密码|口令/, label: "密码口令", iconKey: "password", badge: "from-rose-400 to-red-500", glow: "244 63 94" },
];

// 默认（API key / token / secret 等凭据）
const DEFAULT_DEF: Omit<TypeDef, "test"> = {
  label: "密钥凭据", iconKey: "key", badge: "from-indigo-400 to-violet-500", glow: "99 102 241",
};

export function getSecretType(key: string): SecretTypeStyle {
  const def = TYPE_DEFS.find((d) => d.test.test(key)) ?? DEFAULT_DEF;
  return {
    icon: ICONS[def.iconKey],
    label: def.label,
    badge: def.badge,
    glow: def.glow,
  };
}
