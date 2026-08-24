import {
  Code2, Terminal, Cpu, PenLine, FileText, BookOpen,
  BarChart3, Database, PieChart, Image, Palette, Aperture,
  File, FolderOpen, Search, Globe, Compass,
  Zap, Workflow, Clock, Calendar, Bot, MessageSquare,
  Sparkles, Cloud, GitBranch, Rocket, Shield, KeyRound,
  Lock, Wrench, Settings, Sliders, Hammer, Scissors,
  DatabaseZap, Server, Smartphone, Globe2, Wifi,
  Mail, Bell, CalendarCheck,
  CheckSquare, ListTodo, ClipboardList, StickyNote,
  Tag, Bookmark, BookmarkPlus, Star, Flag,
  Map, Navigation, MapPin, Route, Plane,
  Building, Building2, Home,
  ShoppingCart, CreditCard, Gift, Package,
  Box, Archive, HardDrive,
  Monitor, Laptop, Tablet, Tv, Speaker,
  Headphones, Mic, Camera, Video,
  Film, Music, Mic2, Volume2,
  type LucideIcon,
} from "lucide-react";

// 类别定义
export type SkillCategory =
  | "code"
  | "writing"
  | "data"
  | "image"
  | "file"
  | "search"
  | "workflow"
  | "ai"
  | "cloud"
  | "security"
  | "tool"
  | "communication"
  | "productivity"
  | "default";

// 类别配色配置
export const CATEGORY_CONFIG: Record<SkillCategory, {
  gradient: string;
  bgLight: string;
  bgDark: string;
  textColor: string;
  borderColor: string;
}> = {
  code: {
    gradient: "from-indigo-500 to-purple-600",
    bgLight: "bg-indigo-100",
    bgDark: "bg-indigo-900/30",
    textColor: "text-indigo-600",
    borderColor: "border-indigo-200",
  },
  writing: {
    gradient: "from-amber-500 to-orange-500",
    bgLight: "bg-amber-100",
    bgDark: "bg-amber-900/30",
    textColor: "text-amber-600",
    borderColor: "border-amber-200",
  },
  data: {
    gradient: "from-emerald-500 to-teal-500",
    bgLight: "bg-emerald-100",
    bgDark: "bg-emerald-900/30",
    textColor: "text-emerald-600",
    borderColor: "border-emerald-200",
  },
  image: {
    gradient: "from-pink-500 to-rose-500",
    bgLight: "bg-pink-100",
    bgDark: "bg-pink-900/30",
    textColor: "text-pink-600",
    borderColor: "border-pink-200",
  },
  file: {
    gradient: "from-blue-500 to-cyan-500",
    bgLight: "bg-blue-100",
    bgDark: "bg-blue-900/30",
    textColor: "text-blue-600",
    borderColor: "border-blue-200",
  },
  search: {
    gradient: "from-teal-500 to-cyan-500",
    bgLight: "bg-teal-100",
    bgDark: "bg-teal-900/30",
    textColor: "text-teal-600",
    borderColor: "border-teal-200",
  },
  workflow: {
    gradient: "from-lime-500 to-green-500",
    bgLight: "bg-lime-100",
    bgDark: "bg-lime-900/30",
    textColor: "text-lime-600",
    borderColor: "border-lime-200",
  },
  ai: {
    gradient: "from-violet-500 to-purple-600",
    bgLight: "bg-violet-100",
    bgDark: "bg-violet-900/30",
    textColor: "text-violet-600",
    borderColor: "border-violet-200",
  },
  cloud: {
    gradient: "from-sky-500 to-blue-500",
    bgLight: "bg-sky-100",
    bgDark: "bg-sky-900/30",
    textColor: "text-sky-600",
    borderColor: "border-sky-200",
  },
  security: {
    gradient: "from-red-500 to-orange-500",
    bgLight: "bg-red-100",
    bgDark: "bg-red-900/30",
    textColor: "text-red-600",
    borderColor: "border-red-200",
  },
  tool: {
    gradient: "from-gray-500 to-slate-600",
    bgLight: "bg-gray-100",
    bgDark: "bg-gray-900/30",
    textColor: "text-gray-600",
    borderColor: "border-gray-200",
  },
  communication: {
    gradient: "from-cyan-500 to-blue-500",
    bgLight: "bg-cyan-100",
    bgDark: "bg-cyan-900/30",
    textColor: "text-cyan-600",
    borderColor: "border-cyan-200",
  },
  productivity: {
    gradient: "from-green-500 to-emerald-500",
    bgLight: "bg-green-100",
    bgDark: "bg-green-900/30",
    textColor: "text-green-600",
    borderColor: "border-green-200",
  },
  default: {
    gradient: "from-slate-500 to-gray-600",
    bgLight: "bg-slate-100",
    bgDark: "bg-slate-900/30",
    textColor: "text-slate-600",
    borderColor: "border-slate-200",
  },
};

// 图标映射规则
type IconRule = {
  keywords: RegExp[];
  category: SkillCategory;
  icon: LucideIcon;
};

const ICON_RULES: IconRule[] = [
  // 代码/开发
  {
    keywords: [/code/i, /dev/i, /script/i, /programming/i, /developer/i, /coder/i],
    category: "code",
    icon: Code2,
  },
  {
    keywords: [/terminal/i, /cli/i, /command/i, /bash/i, /shell/i],
    category: "code",
    icon: Terminal,
  },
  {
    keywords: [/cpu/i, /processor/i, /compute/i, /engine/i],
    category: "code",
    icon: Cpu,
  },

  // 写作/文案
  {
    keywords: [/write/i, /writer/i, /blog/i, /content/i, /author/i, /novel/i],
    category: "writing",
    icon: PenLine,
  },
  {
    keywords: [/document/i, /article/i, /paper/i, /essay/i, /report/i],
    category: "writing",
    icon: FileText,
  },
  {
    keywords: [/book/i, /ebook/i, /read/i, /reader/i, /library/i, /manual/i],
    category: "writing",
    icon: BookOpen,
  },

  // 数据/分析
  {
    keywords: [/data/i, /dataset/i, /table/i, /spreadsheet/i, /csv/i, /excel/i],
    category: "data",
    icon: Database,
  },
  {
    keywords: [/analytics/i, /stats/i, /statistics/i, /metric/i, /dashboard/i],
    category: "data",
    icon: BarChart3,
  },
  {
    keywords: [/chart/i, /graph/i, /visualization/i, /plot/i, /visual/i],
    category: "data",
    icon: PieChart,
  },

  // 图像/设计
  {
    keywords: [/image/i, /photo/i, /picture/i, /pic/i, /img/i, /snapshot/i],
    category: "image",
    icon: Image,
  },
  {
    keywords: [/design/i, /ui/i, /ux/i, /interface/i, /uiux/i, /mockup/i],
    category: "image",
    icon: Palette,
  },
  {
    keywords: [/icon/i, /svg/i, /vector/i, /font/i, /typography/i, /logo/i],
    category: "image",
    icon: Aperture,
  },

  // 文件/文档
  {
    keywords: [/file/i, /folder/i, /directory/i, /storage/i, /archive/i],
    category: "file",
    icon: File,
  },
  {
    keywords: [/note/i, /notes/i, /memo/i, /jot/i],
    category: "file",
    icon: StickyNote,
  },

  // 搜索/查询
  {
    keywords: [/search/i, /find/i, /lookup/i, /query/i, /scrape/i, /crawl/i],
    category: "search",
    icon: Search,
  },
  {
    keywords: [/web/i, /internet/i, /browser/i, /online/i, /website/i],
    category: "search",
    icon: Globe,
  },
  {
    keywords: [/map/i, /location/i, /geo/i, /gps/i, /navigate/i],
    category: "search",
    icon: MapPin,
  },

  // 效率/自动化
  {
    keywords: [/auto/i, /automate/i, /automation/i, /batch/i, /bulk/i],
    category: "workflow",
    icon: Zap,
  },
  {
    keywords: [/workflow/i, /pipeline/i, /process/i, /flow/i, /chain/i],
    category: "workflow",
    icon: Workflow,
  },
  {
    keywords: [/schedule/i, /cron/i, /timer/i, /reminder/i, /agenda/i],
    category: "workflow",
    icon: Calendar,
  },
  {
    keywords: [/clock/i, /time/i, /timer/i, /stopwatch/i, /alarm/i],
    category: "workflow",
    icon: Clock,
  },

  // AI/对话
  {
    keywords: [/ai/i, /gpt/i, /llm/i, /chat/i, /assistant/i, /bot/i, /gemini/i, /claude/i],
    category: "ai",
    icon: Sparkles,
  },
  {
    keywords: [/message/i, /chat/i, /conversation/i, /talk/i, /chatbot/i],
    category: "ai",
    icon: MessageSquare,
  },
  {
    keywords: [/agent/i, /autonomous/i, /agentic/i, /agentica/i],
    category: "ai",
    icon: Bot,
  },

  // 云/部署
  {
    keywords: [/cloud/i, /aws/i, /azure/i, /gcp/i, /serverless/i, /hosting/i],
    category: "cloud",
    icon: Cloud,
  },
  {
    keywords: [/git/i, /github/i, /gitlab/i, /version/i, /repo/i, /repository/i],
    category: "cloud",
    icon: GitBranch,
  },
  {
    keywords: [/deploy/i, /deployment/i, /release/i, /launch/i, /publish/i],
    category: "cloud",
    icon: Rocket,
  },
  {
    keywords: [/server/i, /backend/i, /api/i, /rest/i, /graphql/i, /endpoint/i],
    category: "cloud",
    icon: Server,
  },

  // 安全/隐私
  {
    keywords: [/security/i, /secure/i, /cybersecurity/i, /hack/i, /pentest/i],
    category: "security",
    icon: Shield,
  },
  {
    keywords: [/key/i, /password/i, /credential/i, /token/i, /secret/i],
    category: "security",
    icon: KeyRound,
  },
  {
    keywords: [/lock/i, /encrypt/i, /privacy/i, /private/i, /confidential/i],
    category: "security",
    icon: Lock,
  },

  // 工具/Utility
  {
    keywords: [/tool/i, /util/i, /utility/i, /helper/i, /assist/i],
    category: "tool",
    icon: Wrench,
  },
  {
    keywords: [/setting/i, /config/i, /preference/i, /option/i, /configure/i],
    category: "tool",
    icon: Settings,
  },
  {
    keywords: [/convert/i, /transform/i, /converter/i, /translate/i, /translat/i],
    category: "tool",
    icon: Hammer,
  },
  {
    keywords: [/cut/i, /trim/i, /slice/i, /split/i, /extract/i, /crop/i],
    category: "tool",
    icon: Scissors,
  },

  // 通讯
  {
    keywords: [/email/i, /mail/i, /smtp/i, /inbox/i, /letter/i, /sendmail/i],
    category: "communication",
    icon: Mail,
  },
  {
    keywords: [/notify/i, /notification/i, /alert/i, /alarm/i, /notice/i],
    category: "communication",
    icon: Bell,
  },
  {
    keywords: [/calendar/i, /event/i, /schedule/i, /appointment/i, /meeting/i],
    category: "communication",
    icon: CalendarCheck,
  },
  {
    keywords: [/todo/i, /task/i, /todoist/i, /checklist/i, /check/i, /todonote/i],
    category: "communication",
    icon: CheckSquare,
  },

  // 效率
  {
    keywords: [/star/i, /favorite/i, /favourite/i, /featured/i, /curated/i],
    category: "productivity",
    icon: Star,
  },
  {
    keywords: [/tag/i, /label/i, /category/i, /taxonomy/i, /classify/i],
    category: "productivity",
    icon: Tag,
  },
  {
    keywords: [/bookmark/i, /save/i, /pin/i, /mark/i, /favorite/i],
    category: "productivity",
    icon: BookmarkPlus,
  },
];

/**
 * 根据 skill 的元数据推断图标和配色
 */
export function getSkillIconInfo(skill: {
  name?: string;
  displayName?: string;
  description?: string;
  tags?: string[];
}): { icon: LucideIcon; category: SkillCategory; config: (typeof CATEGORY_CONFIG)["default"] } {
  // 合并所有文本用于匹配
  const text = [
    skill.displayName,
    skill.name,
    skill.description,
    ...(skill.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // 按顺序遍历规则，找到第一个匹配的
  for (const rule of ICON_RULES) {
    if (rule.keywords.some((kw) => kw.test(text))) {
      return {
        icon: rule.icon,
        category: rule.category,
        config: CATEGORY_CONFIG[rule.category],
      };
    }
  }

  // 默认使用 Sparkles 图标
  return {
    icon: Sparkles,
    category: "default",
    config: CATEGORY_CONFIG.default,
  };
}

/**
 * 获取类名的工具函数
 */
export function getSkillIconClasses(config: (typeof CATEGORY_CONFIG)["default"]): string {
  return `bg-gradient-to-br ${config.gradient} shadow-lg`;
}
