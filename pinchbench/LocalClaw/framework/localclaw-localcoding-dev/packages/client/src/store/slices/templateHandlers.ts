// Template event handlers
type SetFn = (partial: any) => void;

export function handleTemplateEvents(
  event: any,
  set: SetFn,
): boolean {
  const { type } = event;

  if (type === "template.list") {
    set({ templates: event.payload.templates });
    return true;
  }

  if (type === "template.detail") {
    set({ selectedTemplate: event.payload.template });
    return true;
  }

  if (type === "template.saved") {
    const saved = event.payload.template;
    set((state: any) => {
      const exists = state.templates.some((t: any) => t.slug === saved.slug);
      if (exists) {
        return { templates: state.templates.map((t: any) => t.slug === saved.slug ? saved : t) };
      }
      return { templates: [...state.templates, saved] };
    });
    return true;
  }

  if (type === "template.deleted") {
    const slug = event.payload.slug;
    set((state: any) => ({ templates: state.templates.filter((t: any) => t.slug !== slug) }));
    return true;
  }

  return false;
}
