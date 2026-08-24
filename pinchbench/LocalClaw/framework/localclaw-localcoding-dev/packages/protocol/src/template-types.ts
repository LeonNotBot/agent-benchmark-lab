export type TemplateCategory = "development" | "writing" | "data" | "devops" | "other";

export interface Template {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: TemplateCategory;
  routingPreference: "standard";
  modelOverride?: string;
  skills: string[];
  initialPrompt?: string;
  builtin: boolean;
  claudeMdContent: string;
}

export type TemplateSummary = Omit<Template, "claudeMdContent">;
