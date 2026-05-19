import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveSkillPath } from "./definitions.js";
import { discoverSkillTemplates } from "./skill-templates.js";
import { discoverExtensionTemplates } from "./extension-templates.js";
import { resolveOrchestratorLibraryResourceRef } from "./orchestrator-library.js";
import type { AgentDefinition } from "./state.js";

export interface ExtensionRef {
  name: string;
  path: string;
  scope?: string;
}

export interface ResolvedCapabilities {
  skills?: string[];
  extensions: ExtensionRef[];
  missingExtensionTemplates: string[];
  missingExtensions: string[];
  skillConflicts: Array<{ name: string; paths: string[] }>;
}

function uniqueStrings(items: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const value = item?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function resolveSkillRef(item: string, templateFilePath: string, cwd: string): string {
  const libraryResource = resolveOrchestratorLibraryResourceRef(item, cwd, "skills");
  if (libraryResource) return libraryResource.filePath;
  return resolveSkillPath(item, path.dirname(templateFilePath), cwd);
}

function skillRuntimeName(skillPath: string): string | undefined {
  try {
    const filePath = fs.statSync(skillPath).isDirectory() ? path.join(skillPath, "SKILL.md") : skillPath;
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    return typeof frontmatter.name === "string" ? frontmatter.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function findSkillConflicts(skillPaths: string[]): Array<{ name: string; paths: string[] }> {
  const byName = new Map<string, string[]>();
  for (const skillPath of skillPaths) {
    const name = skillRuntimeName(skillPath);
    if (!name) continue;
    byName.set(name, [...(byName.get(name) || []), skillPath]);
  }
  return Array.from(byName.entries())
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, paths }));
}

function uniqueExtensions(items: ExtensionRef[]): ExtensionRef[] {
  const seen = new Set<string>();
  const result: ExtensionRef[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    result.push(item);
  }
  return result;
}

export function resolveCapabilities(options: {
  cwd: string;
  definition?: AgentDefinition;
  requestedExtensions?: string[];
  availableExtensions: ExtensionRef[];
}): ResolvedCapabilities {
  const { cwd, definition, requestedExtensions = [], availableExtensions } = options;
  const skillTemplates = discoverSkillTemplates(cwd);
  const extensionTemplates = discoverExtensionTemplates(cwd);

  const selectedSkillTemplateNames = new Set(definition?.skillTemplates || []);
  const selectedExtensionTemplateNames = new Set(definition?.extensionTemplates || []);

  const missingExtensionTemplates = [...selectedExtensionTemplateNames]
    .filter((name) => !extensionTemplates.some((template) => template.name === name));

  const skillTemplateItems = skillTemplates
    .filter((template) => template.applyToAll || selectedSkillTemplateNames.has(template.name))
    .flatMap((template) => template.items.map((item) => resolveSkillRef(item, template.filePath, cwd)));

  const directSkills = (definition?.skills || []).map((item) => resolveOrchestratorLibraryResourceRef(item, cwd, "skills")?.filePath || item);
  const skills = uniqueStrings([...directSkills, ...skillTemplateItems]);

  const extensionNames = uniqueStrings([
    ...requestedExtensions,
    ...extensionTemplates
      .filter((template) => template.applyToAll || selectedExtensionTemplateNames.has(template.name))
      .flatMap((template) => template.items),
  ]);

  const resolvedExtensions: ExtensionRef[] = [];
  const missingExtensions: string[] = [];
  for (const name of extensionNames) {
    const extension = availableExtensions.find((candidate) => candidate.name === name);
    if (extension) resolvedExtensions.push(extension);
    else missingExtensions.push(name);
  }

  return {
    skills: skills.length ? skills : undefined,
    extensions: uniqueExtensions(resolvedExtensions),
    missingExtensionTemplates,
    missingExtensions,
    skillConflicts: findSkillConflicts(skills),
  };
}
