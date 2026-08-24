// Skill event handlers
type SetFn = (partial: any) => void;

export function handleSkillEvents(
  event: any,
  set: SetFn,
): boolean {
  const { type } = event;

  if (type === "skill.list") {
    set({ skills: event.payload.skills });
    return true;
  }

  if (type === "skill.installed") {
    set((state: any) => ({ skills: [...state.skills, event.payload.skill] }));
    return true;
  }

  if (type === "skill.deleted") {
    set((state: any) => ({ skills: state.skills.filter((s: any) => s.name !== event.payload.name) }));
    return true;
  }

  return false;
}
