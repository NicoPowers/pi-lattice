import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveSkillPath } from "./definitions.js";
import { discoverConfiguredOrchestratorLibraries } from "./orchestrator-library.js";
import { resolveCapabilities } from "./capability-resolution.js";
import { resolveOrchestratorLibraryResourceRef } from "./orchestrator-library.js";
import type { AgentDefinition } from "./state.js";

export interface RootOrchestratorProfile {
  name: string;
  description: string;
  skills?: string[];
  skillTemplates?: string[];
  instructions: string;
  source: "user" | "project" | "package" | "orchestrator-library";
  scope?: string;
  filePath: string;
  readOnly?: boolean;
}

export type RootProfileActivationChoice =
  | { action: "activate"; profile: RootOrchestratorProfile }
  | { action: "select"; profiles: RootOrchestratorProfile[] }
  | { action: "error"; error: string };

export interface ResolvedRootProfileCapabilities {
  skills: string[];
  errors: string[];
  skillConflicts: Array<{ name: string; paths: string[] }>;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function packageProfilesDir(): string | undefined {
  try {
    const candidate = path.join(__dirname, "..", "..", "orchestrator-profiles");
    if (isDirectory(candidate)) return candidate;
  } catch {
    /* __dirname may not be available in some loaders */
  }
  const fallback = path.resolve(process.cwd(), "orchestrator-profiles");
  return isDirectory(fallback) ? fallback : undefined;
}

function projectProfilesDir(cwd: string): string | undefined {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "orchestrator-profiles");
    if (isDirectory(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return undefined;
    currentDir = parentDir;
  }
}

function parseList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map(String).map((s) => s.trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  if (typeof value !== "string") return undefined;
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function readProfileFile(filePath: string, source: RootOrchestratorProfile["source"], cwd: string, scope?: string): RootOrchestratorProfile | undefined {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  const name = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : path.basename(filePath, ".md");
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "Root orchestrator profile";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.includes("..")) return undefined;
  const baseDir = path.dirname(filePath);
  const skills = parseList(frontmatter.skills)?.map((item) => resolveOrchestratorLibraryResourceRef(item, cwd, "skills")?.filePath || resolveSkillPath(item, baseDir, cwd));
  const skillTemplates = parseList(frontmatter.skillTemplates);
  return {
    name,
    description,
    skills,
    skillTemplates,
    instructions: body.startsWith("\n") ? body.slice(1) : body,
    source,
    scope,
    filePath,
    readOnly: source === "package",
  };
}

function loadProfilesFromDir(dir: string | undefined, source: RootOrchestratorProfile["source"], cwd: string, scope?: string): RootOrchestratorProfile[] {
  if (!dir || !isDirectory(dir)) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const profiles: RootOrchestratorProfile[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const profile = readProfileFile(path.join(dir, entry.name), source, cwd, scope);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

function libraryProfileDirs(cwd: string): Array<{ dir: string; scope: string }> {
  const dirs: Array<{ dir: string; scope: string }> = [];
  for (const library of discoverConfiguredOrchestratorLibraries(cwd).libraries) {
    if (!library.valid || !library.manifest) continue;
    let rawResources: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(library.manifestPath, "utf-8"));
      rawResources = parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.resources && typeof parsed.resources === "object" && !Array.isArray(parsed.resources)
        ? parsed.resources as Record<string, unknown>
        : {};
    } catch {
      rawResources = {};
    }
    const rawValue = rawResources.orchestratorProfiles;
    const rawPath = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : "orchestrator-profiles";
    const resolved = path.resolve(library.root, rawPath);
    const relative = path.relative(library.root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    if (isDirectory(resolved)) dirs.push({ dir: resolved, scope: library.manifest.name });
  }
  return dirs;
}

export function discoverRootProfiles(cwd: string): RootOrchestratorProfile[] {
  const profiles = [
    ...loadProfilesFromDir(packageProfilesDir(), "package", cwd),
    ...loadProfilesFromDir(path.join(getAgentDir(), "orchestrator-profiles"), "user", cwd),
    ...loadProfilesFromDir(projectProfilesDir(cwd), "project", cwd),
    ...libraryProfileDirs(cwd).flatMap((entry) => loadProfilesFromDir(entry.dir, "orchestrator-library", cwd, entry.scope)),
  ];

  const byName = new Map<string, RootOrchestratorProfile>();
  for (const profile of profiles) byName.set(profile.name, profile);
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getRootProfile(name: string, cwd: string): RootOrchestratorProfile | undefined {
  return discoverRootProfiles(cwd).find((profile) => profile.name === name);
}

export function chooseRootProfileActivation(arg: string | undefined, profiles: RootOrchestratorProfile[]): RootProfileActivationChoice {
  const requested = (arg || "").trim();
  if (requested) {
    const profile = profiles.find((candidate) => candidate.name === requested);
    if (!profile) return { action: "error", error: `Root orchestrator profile '${requested}' not found. Available: ${profiles.map((profile) => profile.name).join(", ") || "none"}` };
    return { action: "activate", profile };
  }
  if (profiles.length === 1) return { action: "activate", profile: profiles[0] };
  return { action: "select", profiles };
}

export function resolveRootProfileCapabilities(options: { cwd: string; profile: RootOrchestratorProfile }): ResolvedRootProfileCapabilities {
  const definition: AgentDefinition = {
    name: options.profile.name,
    description: options.profile.description,
    skills: options.profile.skills,
    skillTemplates: options.profile.skillTemplates,
    systemPrompt: options.profile.instructions,
    source: options.profile.source === "package" ? "package" : options.profile.source === "user" ? "user" : "project",
    filePath: options.profile.filePath,
  };
  const result = resolveCapabilities({ cwd: options.cwd, definition, availableExtensions: [], target: "orchestrator" });
  return {
    skills: result.skills || [],
    errors: result.errors,
    skillConflicts: result.skillConflicts,
  };
}
