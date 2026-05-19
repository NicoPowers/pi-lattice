import {
  deleteTemplate,
  discoverTemplates,
  getTemplate,
  saveTemplate,
  type TemplateDefinition,
} from "./template-common.js";

const config = { dirName: "skill-templates", itemField: "skills", libraryKind: "skillTemplates" as const, supportsOrchestratorAudience: true };

export type SkillTemplate = TemplateDefinition;
export type SkillTemplateInput = Parameters<typeof saveTemplate>[0];

export function discoverSkillTemplates(cwd: string): SkillTemplate[] {
  return discoverTemplates(cwd, config);
}

export function getSkillTemplate(name: string, cwd: string): SkillTemplate | undefined {
  return getTemplate(name, cwd, config);
}

export function saveSkillTemplate(
  template: SkillTemplateInput,
  cwd: string
): { success: boolean; path?: string; error?: string } {
  return saveTemplate(template, cwd, config);
}

export function deleteSkillTemplate(name: string, cwd: string): { success: boolean; error?: string } {
  return deleteTemplate(name, cwd, config);
}
