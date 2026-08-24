// 首页预制 prompt 模板：点击后注入 Composer 输入框（经 thread store 的 composerDraft 机制）。
// 模板含中/英文双语，按当前 locale 取对应文案。
import { useThreadStore } from "./store";
import { useLocale } from "../i18n";

interface Bilingual {
  zh: string;
  en: string;
}
interface Template {
  title: Bilingual;
  desc: Bilingual;
  prompt: Bilingual;
}

const TEMPLATES: Template[] = [];

TEMPLATES.push(
  {
    title: { zh: "研究报告精读摘要", en: "Research report deep-read summary" },
    desc: {
      zh: "AI 大模型行业研究报告结构化精读，输出 HTML",
      en: "Structured deep-read of an AI LLM industry report, output as HTML",
    },
    prompt: {
      zh: "帮我对一份 AI 大模型行业研究报告做精读摘要。报告核心内容涵盖：2025 年全球大模型市场规模达 680 亿美元（YoY +45%）、主要玩家格局（OpenAI/Google/Meta/Anthropic 四强争霸）、技术路线分化（闭源 vs 开源、密集模型 vs MoE）、六大应用场景渗透率（客服 72%、代码生成 65%、内容创作 58%、数据分析 45%、教育 38%、医疗 22%）、三大投资热点（Agent 基础设施、垂直模型、数据标注）、五个关键风险（算力瓶颈、数据合规、幻觉问题、能耗争议、人才短缺）。请输出结构化精读摘要，包含：一句话核心结论、市场数据图表化描述、竞争格局矩阵、技术趋势研判、投资建议、风险提示，3000 字以上。最终通过 html 展示结果。",
      en: "Help me write a deep-read summary of an AI LLM industry research report. Core content covers: 2025 global LLM market size of $68B (YoY +45%), key player landscape (OpenAI/Google/Meta/Anthropic), technical route divergence (closed vs open source, dense vs MoE), penetration of six application scenarios (customer service 72%, code generation 65%, content creation 58%, data analysis 45%, education 38%, healthcare 22%), three investment hotspots (Agent infrastructure, vertical models, data labeling), and five key risks (compute bottleneck, data compliance, hallucination, energy debate, talent shortage). Output a structured summary including: one-line core conclusion, charted market data, competitive matrix, tech trend analysis, investment advice, and risk warnings, 3000+ words. Render the final result as HTML.",
    },
  },
  {
    title: { zh: "企业官网开发", en: "Corporate website development" },
    desc: {
      zh: "SMB 公司官网，含首页/关于/产品/联系页面",
      en: "An SMB corporate site with Home/About/Products/Contact pages",
    },
    prompt: {
      zh: "帮我开发一个企业官网，公司名称是【SMB】，主营业务是【Think Pad、ThinkBooK 笔记本电脑及相关选件】。要求：包含首页、关于我们、产品服务、联系我们页面，风格简约大气。",
      en: "Help me build a corporate website. Company name: [SMB]. Core business: [ThinkPad, ThinkBook laptops and related accessories]. Requirements: include Home, About Us, Products & Services, and Contact pages, with a clean and elegant style.",
    },
  },
  {
    title: { zh: "网页版坦克大战", en: "Web Battle City game" },
    desc: {
      zh: "可运行的简化版坦克大战，键盘操作 + 计分",
      en: "A runnable simplified Battle City with keyboard control and scoring",
    },
    prompt: {
      zh: "帮我做一个网页版简化版坦克大战。玩家可以方向键移动，空格发射子弹。地图里有墙体，3 个敌方坦克会自动移动和开火。击中敌人得分，玩家被击中扣生命，生命为 0 游戏结束。页面显示分数、生命值和重新开始按钮。请先实现一个能直接运行的版本，并告诉我如何运行。",
      en: "Help me build a simplified web version of Battle City. The player moves with arrow keys and fires with space. The map has walls, and 3 enemy tanks move and fire automatically. Hitting an enemy scores points; getting hit costs a life; the game ends at 0 lives. The page shows score, lives, and a restart button. First build a directly runnable version and tell me how to run it.",
    },
  },
  {
    title: { zh: "销售数据分析仪表盘", en: "Sales data analytics dashboard" },
    desc: {
      zh: "12 个月销售数据 Excel 仪表盘，含趋势/排名/KPI",
      en: "12-month sales Excel dashboard with trends/rankings/KPIs",
    },
    prompt: {
      zh: "帮我生成一份销售数据分析 Excel 仪表盘。包含：12 个月的销售数据（按产品线/区域/销售员）、月度趋势图数据、区域业绩排名、产品线毛利分析、Top 10 客户贡献、环比/同比增长率计算公式、KPI 达成率仪表盘数据。",
      en: "Help me generate a sales analytics Excel dashboard. Include: 12 months of sales data (by product line/region/salesperson), monthly trend chart data, regional performance ranking, product-line gross margin analysis, Top 10 customer contribution, MoM/YoY growth rate formulas, and KPI attainment dashboard data.",
    },
  },
);

export function PromptTemplates() {
  const { locale } = useLocale();
  const isZh = locale !== "en";
  const setComposerDraft = useThreadStore((s) => s.setComposerDraft);
  return (
    <div className="mx-auto mb-3 grid w-full max-w-3xl grid-cols-2 gap-2">
      {TEMPLATES.map((tpl) => (
        <button
          key={tpl.title.en}
          onClick={() => setComposerDraft(isZh ? tpl.prompt.zh : tpl.prompt.en)}
          className="group flex flex-col items-start rounded-xl border border-border-300 bg-bg-000 px-3.5 py-2.5 text-left transition-colors hover:border-accent-brand/60 hover:bg-bg-100"
        >
          <span className="text-sm font-medium text-text-200 group-hover:text-text-100">
            {isZh ? tpl.title.zh : tpl.title.en}
          </span>
          <span className="mt-0.5 line-clamp-1 text-xs text-text-400">{isZh ? tpl.desc.zh : tpl.desc.en}</span>
        </button>
      ))}
    </div>
  );
}
