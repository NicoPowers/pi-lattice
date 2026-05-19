import { DefaultResourceLoader, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface DiscoveredSkill {
  id: string;
  name: string;
  description?: string;
  path: string;
  filePath: string;
  baseDir: string;
  source?: string;
  scope?: string;
  kind: "directory" | "file";
  editable: boolean;
}

export interface SkillDetail {
  skill: DiscoveredSkill;
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mtimeMs: number;
  hash: string;
}

export interface SkillFileEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
  markdown?: boolean;
  editable: boolean;
}

export interface SkillFileDetail {
  path: string;
  content: string;
  size: number;
  mtimeMs: number;
  hash: string;
  markdown: boolean;
  editable: boolean;
}

function canonicalPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function skillId(filePath: string): string {
  return crypto.createHash("sha256").update(canonicalPath(filePath)).digest("base64url");
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("base64url");
}

function isSubPath(filePath: string, root: string): boolean {
  const relative = path.relative(canonicalPath(root), canonicalPath(filePath));
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function editableRoots(cwd: string): string[] {
  return [
    path.join(cwd, ".pi", "skills"),
    path.join(cwd, ".agents", "skills"),
    path.join(getAgentDir(), "skills"),
    path.join(os.homedir(), ".agents", "skills"),
  ].filter((root) => fs.existsSync(root));
}

function isEditableSkill(filePath: string, cwd: string): boolean {
  return editableRoots(cwd).some((root) => isSubPath(filePath, root));
}

function compareSkills(a: DiscoveredSkill, b: DiscoveredSkill): number {
  return a.name.localeCompare(b.name) || (a.scope || "").localeCompare(b.scope || "") || a.path.localeCompare(b.path);
}

export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
}

export function validateSkillContent(content: string): string | undefined {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
  const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  if (!name.trim()) return "skill frontmatter name is required";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) || name.includes("--")) return "skill name must be lowercase letters, numbers, and single hyphens only";
  if (!description.trim()) return "skill frontmatter description is required";
  if (description.length > 1024) return "skill description must be at most 1024 characters";
  return undefined;
}

function resolveSkillFile(skill: DiscoveredSkill, relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) return undefined;
  const target = path.resolve(skill.baseDir, normalized);
  const base = canonicalPath(skill.baseDir);
  const relative = path.relative(base, path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return target;
}

function isTextFile(filePath: string): boolean {
  return /\.(md|txt|json|ya?ml|ts|tsx|js|jsx|sh|py|css|html)$/i.test(filePath);
}

function detailForSkill(skill: DiscoveredSkill): SkillDetail {
  const content = fs.readFileSync(skill.filePath, "utf-8");
  const stat = fs.statSync(skill.filePath);
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  return { skill, content, frontmatter, body, mtimeMs: stat.mtimeMs, hash: contentHash(content) };
}

async function loadSkills(cwd: string) {
  const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
  await loader.reload();
  return loader.getSkills();
}

export async function discoverSkillDiagnostics(cwd: string): Promise<Array<{ type: string; message: string; path?: string }>> {
  const { diagnostics } = await loadSkills(cwd);
  return diagnostics.map((diagnostic: any) => ({ type: diagnostic.type, message: diagnostic.message, path: diagnostic.path }));
}

export async function discoverSkills(cwd: string): Promise<DiscoveredSkill[]> {
  const { skills } = await loadSkills(cwd);
  const discovered = skills
    .map((skill: any) => {
      const filePath = skill.filePath;
      const baseDir = skill.baseDir || path.dirname(filePath);
      const kind = path.basename(filePath).toLowerCase() === "skill.md" ? "directory" : "file";
      return {
        id: skillId(filePath),
        name: skill.name,
        description: skill.description,
        path: filePath,
        filePath,
        baseDir,
        source: skill.sourceInfo?.source,
        scope: skill.sourceInfo?.scope,
        kind,
        editable: isEditableSkill(filePath, cwd),
      } satisfies DiscoveredSkill;
    });

  const { discoverConfiguredOrchestratorLibraries } = await import("./orchestrator-library.js");
  const librarySkills = discoverConfiguredOrchestratorLibraries(cwd).resources
    .filter((resource) => resource.kind === "skills")
    .map((resource) => {
      const kind = path.basename(resource.filePath).toLowerCase() === "skill.md" ? "directory" : "file";
      return {
        id: skillId(resource.filePath),
        name: resource.name,
        description: resource.description,
        path: resource.filePath,
        filePath: resource.filePath,
        baseDir: kind === "directory" ? path.dirname(resource.filePath) : path.dirname(resource.filePath),
        source: "orchestrator-library",
        scope: resource.libraryName,
        kind,
        editable: resource.editable,
      } satisfies DiscoveredSkill;
    });

  const byFilePath = new Map<string, DiscoveredSkill>();
  for (const skill of [...discovered, ...librarySkills]) byFilePath.set(canonicalPath(skill.filePath), skill);
  return Array.from(byFilePath.values()).sort(compareSkills);
}

export async function getSkillDetail(id: string, cwd: string): Promise<SkillDetail | undefined> {
  const skills = await discoverSkills(cwd);
  const skill = skills.find((candidate) => candidate.id === id);
  if (!skill) return undefined;
  return detailForSkill(skill);
}

export async function createSkill(input: { scope?: "project" | "global"; name: string; description: string; body?: string; scaffold?: "minimal" | "rich" }, cwd: string): Promise<{ success: boolean; detail?: SkillDetail; error?: string; status?: number }> {
  const name = normalizeSkillName(input.name || "");
  if (!name) return { success: false, error: "name is required", status: 400 };
  if (!input.description?.trim()) return { success: false, error: "description is required", status: 400 };
  if (input.description.length > 1024) return { success: false, error: "description must be at most 1024 characters", status: 400 };

  const root = input.scope === "global" ? path.join(getAgentDir(), "skills") : path.join(cwd, ".pi", "skills");
  const dir = path.join(root, name);
  const filePath = path.join(dir, "SKILL.md");
  if (fs.existsSync(filePath) || fs.existsSync(dir)) return { success: false, error: "skill already exists", status: 409 };

  const title = name.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
  const body = input.body?.trim() || (input.scaffold === "rich"
    ? `# ${title}\n\n## When to use\n\nUse this skill when ...\n\n## Workflow\n\n1. ...\n\n## References\n\n- [Reference notes](references/README.md)\n- [Examples](examples/README.md)\n- [Scripts](scripts/README.md)\n- [Assets](assets/README.md)`
    : `# ${title}\n\n## When to use\n\nUse this skill when ...\n\n## Workflow\n\n1. ...`);
  const content = `---\nname: ${name}\ndescription: ${input.description.trim()}\n---\n\n${body}\n`;
  const validationError = validateSkillContent(content);
  if (validationError) return { success: false, error: validationError, status: 400 };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  if (input.scaffold === "rich") {
    for (const child of ["references", "scripts", "assets", "examples"]) {
      const childDir = path.join(dir, child);
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(path.join(childDir, "README.md"), `# ${child[0].toUpperCase() + child.slice(1)}\n\nAdd ${child} for ${name} here.\n`, "utf-8");
    }
  }
  const skills = await discoverSkills(cwd);
  const skill = skills.find((candidate) => canonicalPath(candidate.filePath) === canonicalPath(filePath));
  if (!skill) return { success: false, error: "created skill was not discovered", status: 500 };
  return { success: true, detail: detailForSkill(skill) };
}

export async function getSkillTree(id: string, cwd: string): Promise<{ success: boolean; files?: SkillFileEntry[]; error?: string; status?: number }> {
  const skill = (await discoverSkills(cwd)).find((candidate) => candidate.id === id);
  if (!skill) return { success: false, error: "Skill not found", status: 404 };
  if (skill.kind !== "directory") return { success: true, files: [{ path: path.basename(skill.filePath), name: path.basename(skill.filePath), type: "file", size: fs.statSync(skill.filePath).size, markdown: true, editable: skill.editable }] };
  const files: SkillFileEntry[] = [];
  const walk = (dir: string, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push({ path: rel, name: entry.name, type: "directory", editable: false });
        if (files.length < 500) walk(full, rel);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        files.push({ path: rel, name: entry.name, type: "file", size: stat.size, markdown: /\.md$/i.test(entry.name), editable: skill.editable && isTextFile(full) });
      }
      if (files.length >= 500) return;
    }
  };
  walk(skill.baseDir);
  return { success: true, files };
}

export async function getSkillFile(id: string, relativePath: string, cwd: string): Promise<{ success: boolean; file?: SkillFileDetail; error?: string; status?: number }> {
  const skill = (await discoverSkills(cwd)).find((candidate) => candidate.id === id);
  if (!skill) return { success: false, error: "Skill not found", status: 404 };
  const target = resolveSkillFile(skill, relativePath);
  if (!target) return { success: false, error: "Invalid skill file path", status: 400 };
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return { success: false, error: "Skill file not found", status: 404 };
  const stat = fs.statSync(target);
  if (!isTextFile(target) || stat.size > 512_000) return { success: false, error: "Skill file is not previewable text", status: 415 };
  const content = fs.readFileSync(target, "utf-8");
  return { success: true, file: { path: relativePath.replace(/\\/g, "/").replace(/^\/+/, ""), content, size: stat.size, mtimeMs: stat.mtimeMs, hash: contentHash(content), markdown: /\.md$/i.test(target), editable: skill.editable && isTextFile(target) } };
}

export async function updateSkillFile(id: string, relativePath: string, input: { content: string; expectedHash?: string }, cwd: string): Promise<{ success: boolean; file?: SkillFileDetail; error?: string; status?: number }> {
  const skill = (await discoverSkills(cwd)).find((candidate) => candidate.id === id);
  if (!skill) return { success: false, error: "Skill not found", status: 404 };
  if (!skill.editable) return { success: false, error: "Skill is read-only", status: 403 };
  const target = resolveSkillFile(skill, relativePath);
  if (!target) return { success: false, error: "Invalid skill file path", status: 400 };
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return { success: false, error: "Skill file not found", status: 404 };
  if (!isTextFile(target)) return { success: false, error: "Skill file is not editable text", status: 415 };
  const current = fs.readFileSync(target, "utf-8");
  if (input.expectedHash && input.expectedHash !== contentHash(current)) return { success: false, error: "Skill file changed on disk; refresh before saving", status: 409 };
  fs.writeFileSync(target, input.content, "utf-8");
  return getSkillFile(id, relativePath, cwd);
}

export async function updateSkill(id: string, input: { content: string; expectedHash?: string }, cwd: string): Promise<{ success: boolean; detail?: SkillDetail; error?: string; status?: number }> {
  const skills = await discoverSkills(cwd);
  const skill = skills.find((candidate) => candidate.id === id);
  if (!skill) return { success: false, error: "Skill not found", status: 404 };
  if (!skill.editable) return { success: false, error: "Skill is read-only", status: 403 };
  if (typeof input.content !== "string") return { success: false, error: "content is required", status: 400 };
  const current = detailForSkill(skill);
  if (input.expectedHash && input.expectedHash !== current.hash) return { success: false, error: "Skill changed on disk; refresh before saving", status: 409 };
  const validationError = validateSkillContent(input.content);
  if (validationError) return { success: false, error: validationError, status: 400 };
  fs.writeFileSync(skill.filePath, input.content, "utf-8");
  return { success: true, detail: detailForSkill(skill) };
}

export async function deleteSkill(id: string, cwd: string): Promise<{ success: boolean; error?: string; status?: number }> {
  const skills = await discoverSkills(cwd);
  const skill = skills.find((candidate) => candidate.id === id);
  if (!skill) return { success: false, error: "Skill not found", status: 404 };
  if (!skill.editable) return { success: false, error: "Skill is read-only", status: 403 };
  if (skill.kind === "directory") fs.rmSync(skill.baseDir, { recursive: true, force: true });
  else fs.rmSync(skill.filePath, { force: true });
  return { success: true };
}
