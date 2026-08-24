import type { Template, TemplateSummary } from "@lenovo/agent-protocol";

export interface TemplateSlice {
  templates: TemplateSummary[];
  selectedTemplate: Template | null;
  showTemplateManager: boolean;
  pendingTemplateSlug: string | null;
  setTemplates: (templates: TemplateSummary[]) => void;
  selectTemplate: (template: Template | null) => void;
  setShowTemplateManager: (show: boolean) => void;
  setPendingTemplateSlug: (slug: string | null) => void;
}

export function createTemplateSlice(set: any): TemplateSlice {
  return {
    templates: [],
    selectedTemplate: null,
    showTemplateManager: false,
    pendingTemplateSlug: null,

    setTemplates: (templates) => set({ templates }),
    selectTemplate: (selectedTemplate) => set({ selectedTemplate }),
    setShowTemplateManager: (showTemplateManager) => set({ showTemplateManager }),
    setPendingTemplateSlug: (pendingTemplateSlug) => set({ pendingTemplateSlug }),
  };
}
