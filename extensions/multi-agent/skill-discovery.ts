import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface DiscoveredSkill {
  name: string;
  description?: string;
  path: string;
  source?: string;
  scope?: string;
}

export async function discoverSkills(cwd: string): Promise<DiscoveredSkill[]> {
  const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
  await loader.reload();
  const { skills } = loader.getSkills();
  return skills
    .map((skill: any) => ({
      name: skill.name,
      description: skill.description,
      path: skill.filePath,
      source: skill.sourceInfo?.source,
      scope: skill.sourceInfo?.scope,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
