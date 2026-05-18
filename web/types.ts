// Shared types between server and dashboard

export interface RuntimeToolInfo {
  name: string;
  description?: string;
  sourceInfo?: unknown;
}

export interface RuntimeToolSnapshot {
  active: RuntimeToolInfo[];
  all: RuntimeToolInfo[];
  reportedAt: number;
  source: "child-agent";
}

export interface AgentInfo {
  name: string;
  status: "idle" | "streaming" | "error" | "exited";
  definition?: string;
  parent?: string;
  children: string[];
  turns: number;
  worktree: string;
  runtimeTools?: RuntimeToolSnapshot;
  text?: string;
}

export interface AgentTypeInfo {
  name: string;
  description: string;
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  tools?: string[];
  skills?: string[];
  skillTemplates?: string[];
  extensionTemplates?: string[];
  source: string;
}

export interface ModelInfo {
  provider: string;
  id: string;
  context: string;
  maxOut: string;
  thinking: boolean;
  images: boolean;
  thinkingLevels?: Array<"off" | "minimal" | "low" | "medium" | "high" | "xhigh">;
}

export interface SkillInfo {
  name: string;
  description?: string;
  path: string;
  source?: string;
  scope?: string;
}

export interface ExtensionInfo {
  name: string;
  scope: string;
  description?: string;
  expectedTools?: string[];
  metadataStatus?: "provided" | "unknown" | "invalid";
  metadataSource?: string;
}

export type ServerEvent =
  | { type: "init"; data: { agents: Record<string, AgentInfo> } }
  | { type: "agent-spawned"; data: AgentInfo }
  | { type: "agent-killed"; data: { name: string } }
  | { type: "agent-start"; data: { name: string } }
  | { type: "agent-end"; data: { name: string; text: string } }
  | { type: "agent-error"; data: { name: string; error: string } }
  | { type: "agent-exit"; data: { name: string; code?: number | null } }
  | { type: "agent-delta"; data: { name: string; delta: string } }
  | { type: "delegate"; data: { from: string; to: string; task: string } };
