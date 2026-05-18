import * as path from "node:path";
import { resolveSkillPath } from "./definitions.js";
import { discoverSkillTemplates } from "./skill-templates.js";
import { discoverExtensionTemplates } from "./extension-templates.js";
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
    .flatMap((template) => template.items.map((item) => resolveSkillPath(item, path.dirname(template.filePath), cwd)));

  const skills = uniqueStrings([...(definition?.skills || []), ...skillTemplateItems]);

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
  };
}
