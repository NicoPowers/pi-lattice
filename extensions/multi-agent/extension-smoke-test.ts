import * as fs from "node:fs";
import * as path from "node:path";

import { resolveCapabilities, type ExtensionRef } from "./capability-resolution.js";
import { getExtensionTemplate, type ExtensionTemplate } from "./extension-templates.js";
import { readRuntimeToolSnapshot } from "./runtime-tools.js";
import type { Agent, RuntimeToolSnapshot } from "./state.js";

export interface ExtensionTemplateSmokeTestResult {
  success: boolean;
  template: string;
  extensions: ExtensionRef[];
  missingExtensions: string[];
  runtimeTools?: RuntimeToolSnapshot;
  diagnostics: Array<{ level: "error" | "warning" | "info"; message: string }>;
  stderrTail?: string;
}

export interface ExtensionTemplateSmokeTestDeps {
  repoCwd: string;
  discoverExtensions: (cwd: string) => ExtensionRef[];
  spawnAgent: (id: string, options: any) => Promise<{ agent: Agent; error?: string }>;
  removeWorktree: (worktreePath: string) => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRuntimeTools(worktreePath: string, timeoutMs = 3_000): Promise<RuntimeToolSnapshot | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = readRuntimeToolSnapshot(worktreePath);
    if (snapshot) return snapshot;
    await sleep(100);
  }
  return readRuntimeToolSnapshot(worktreePath);
}

function readStderrTail(worktreePath: string): string | undefined {
  const filePath = path.join(worktreePath, ".pi", "stderr.log");
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const text = fs.readFileSync(filePath, "utf-8").trim();
    return text ? text.slice(-4_000) : undefined;
  } catch {
    return undefined;
  }
}

function diagnosticsForSnapshot(snapshot: RuntimeToolSnapshot | undefined): ExtensionTemplateSmokeTestResult["diagnostics"] {
  if (!snapshot) {
    return [{ level: "warning", message: "No runtime tool snapshot was reported before the smoke-test timeout." }];
  }
  const diagnostics: ExtensionTemplateSmokeTestResult["diagnostics"] = [
    { level: "info", message: `Runtime reported ${snapshot.active.length} active tools and ${snapshot.all.length} total tools.` },
  ];
  for (const conflict of snapshot.conflicts || []) {
    diagnostics.push({
      level: "error",
      message: `Runtime tool '${conflict.name}' was registered ${conflict.count} times${conflict.sources.length ? ` by ${conflict.sources.join(", ")}` : ""}.`,
    });
  }
  return diagnostics;
}

export async function smokeTestExtensionTemplate(name: string, deps: ExtensionTemplateSmokeTestDeps): Promise<ExtensionTemplateSmokeTestResult | { error: string; status: number }> {
  const template: ExtensionTemplate | undefined = getExtensionTemplate(name, deps.repoCwd);
  if (!template) return { error: "Extension template not found", status: 404 };

  const capabilities = resolveCapabilities({
    cwd: deps.repoCwd,
    requestedExtensions: template.items,
    availableExtensions: deps.discoverExtensions(deps.repoCwd),
  });

  const base: Omit<ExtensionTemplateSmokeTestResult, "success"> = {
    template: template.name,
    extensions: capabilities.extensions,
    missingExtensions: capabilities.missingExtensions,
    diagnostics: [],
  };

  if (capabilities.missingExtensions.length) {
    return {
      ...base,
      success: false,
      diagnostics: capabilities.missingExtensions.map((extension) => ({ level: "error", message: `Extension '${extension}' was not found.` })),
    };
  }

  const agentId = `smoke-${template.name.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}`;
  let agent: Agent | undefined;
  try {
    const result = await deps.spawnAgent(agentId, {
      repoCwd: deps.repoCwd,
      definition: {
        name: "extension-smoke-test",
        description: "Temporary extension template smoke-test agent",
        tools: [],
        systemPrompt: "You are a temporary smoke-test agent. Do not perform any task.",
        source: "project",
        filePath: "",
      },
      extensions: capabilities.extensions,
    });
    agent = result.agent;
    if (result.error || !agent) {
      return { ...base, success: false, diagnostics: [{ level: "error", message: result.error || "Smoke-test agent failed to spawn." }] };
    }

    const snapshot = await waitForRuntimeTools(agent.worktreePath);
    const stderrTail = readStderrTail(agent.worktreePath);
    const diagnostics = diagnosticsForSnapshot(snapshot);
    if (agent.status === "error" || agent.status === "exited") {
      diagnostics.push({ level: "error", message: `Smoke-test agent ended with status '${agent.status}'.` });
    }
    if (stderrTail) diagnostics.push({ level: "warning", message: "Smoke-test agent wrote to stderr; inspect stderrTail for details." });

    return {
      ...base,
      success: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
      runtimeTools: snapshot,
      diagnostics,
      stderrTail,
    };
  } finally {
    if (agent) {
      try { if (!agent.proc.killed) agent.proc.kill("SIGTERM"); } catch {}
      await deps.removeWorktree(agent.worktreePath).catch(() => {});
    }
  }
}
