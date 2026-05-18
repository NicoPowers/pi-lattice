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

function detailForSkill(skill: DiscoveredSkill): SkillDetail {
  const content = fs.readFileSync(skill.filePath, "utf-8");
  const stat = fs.statSync(skill.filePath);
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  return { skill, content, frontmatter, body, mtimeMs: stat.mtimeMs, hash: contentHash(content) };
}

export async function discoverSkills(cwd: string): Promise<DiscoveredSkill[]> {
  const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
  await loader.reload();
  const { skills } = loader.getSkills();
  return skills
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
    })
    .sort(compareSkills);
}

export async function getSkillDetail(id: string, cwd: string): Promise<SkillDetail | undefined> {
  const skills = await discoverSkills(cwd);
  const skill = skills.find((candidate) => candidate.id === id);
  if (!skill) return undefined;
  return detailForSkill(skill);
}

export async function createSkill(input: { scope?: "project" | "global"; name: string; description: string; body?: string }, cwd: string): Promise<{ success: boolean; detail?: SkillDetail; error?: string; status?: number }> {
  const name = normalizeSkillName(input.name || "");
  if (!name) return { success: false, error: "name is required", status: 400 };
  if (!input.description?.trim()) return { success: false, error: "description is required", status: 400 };
  if (input.description.length > 1024) return { success: false, error: "description must be at most 1024 characters", status: 400 };

  const root = input.scope === "global" ? path.join(getAgentDir(), "skills") : path.join(cwd, ".pi", "skills");
  const dir = path.join(root, name);
  const filePath = path.join(dir, "SKILL.md");
  if (fs.existsSync(filePath) || fs.existsSync(dir)) return { success: false, error: "skill already exists", status: 409 };

  const title = name.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
  const body = input.body?.trim() || `# ${title}\n\n## When to use\n\nUse this skill when ...\n\n## Workflow\n\n1. ...`;
  const content = `---\nname: ${name}\ndescription: ${input.description.trim()}\n---\n\n${body}\n`;
  const validationError = validateSkillContent(content);
  if (validationError) return { success: false, error: validationError, status: 400 };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  const skills = await discoverSkills(cwd);
  const skill = skills.find((candidate) => canonicalPath(candidate.filePath) === canonicalPath(filePath));
  if (!skill) return { success: false, error: "created skill was not discovered", status: 500 };
  return { success: true, detail: detailForSkill(skill) };
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
