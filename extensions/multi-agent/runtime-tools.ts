import * as fs from "node:fs";
import * as path from "node:path";

import type { RuntimeToolInfo, RuntimeToolSnapshot } from "./state.js";

export function runtimeToolsPath(worktreePath: string): string {
  return path.join(worktreePath, ".pi", "comms", "runtime-tools.json");
}

function normalizeTool(tool: any): RuntimeToolInfo | undefined {
  if (!tool || typeof tool.name !== "string" || !tool.name.trim()) return undefined;
  return {
    name: tool.name.trim(),
    description: typeof tool.description === "string" ? tool.description : undefined,
    sourceInfo: tool.sourceInfo,
  };
}

function normalizeList(value: unknown): RuntimeToolInfo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: RuntimeToolInfo[] = [];
  for (const item of value) {
    const tool = normalizeTool(item);
    if (!tool || seen.has(tool.name)) continue;
    seen.add(tool.name);
    result.push(tool);
  }
  return result;
}

export function readRuntimeToolSnapshot(worktreePath: string): RuntimeToolSnapshot | undefined {
  const filePath = runtimeToolsPath(worktreePath);
  if (!fs.existsSync(filePath)) return undefined;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const reportedAt = typeof raw.reportedAt === "number" && Number.isFinite(raw.reportedAt) ? raw.reportedAt : 0;
    return {
      active: normalizeList(raw.active),
      all: normalizeList(raw.all),
      reportedAt,
      source: "child-agent",
    };
  } catch {
    return undefined;
  }
}
