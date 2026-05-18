import { type ExtensionAPI, type ExtensionContext, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Agent instance tracking ──

interface Agent {
  id: string;
  proc: ChildProcess;
  stdin: NodeJS.WritableStream;
  status: "idle" | "streaming" | "error" | "exited";
  accumulatedText: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  buffer: string;
  definition?: AgentDefinition;
  worktreePath: string;
  parent?: string;
  children: string[];
  _currentSend?: Promise<void>;
  _nextTurn?: { resolve: () => void; reject: (e: Error) => void };
  _turnTimer?: NodeJS.Timeout;
}

interface PendingTask {
  name: string;
  message: string;
  startTime: number;
}

const pendingTasks = new Map<string, PendingTask>();

const agents = new Map<string, Agent>();

// ── Agent definition types (frontmatter + body) ──

interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  skills?: string[];
  systemPrompt: string;
  source: "user" | "project" | "package";
  filePath: string;
}

// ── Persistent file logging ──

const LOG_FILE = path.join(os.tmpdir(), "pi-multi-agent.log");

function log(tag: string, msg: string, extra?: unknown) {
  const ts = new Date().toISOString();
  const payload = extra !== undefined ? ` ${JSON.stringify(extra)}` : "";
  try {
    fs.appendFileSync(LOG_FILE, `[${ts}] [${tag}] ${msg}${payload}\n`);
  } catch {
    /* ignore */
  }
}

// ── Definition discovery ──

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function getPackageAgentsDir(): string | null {
  try {
    const extDir = __dirname;
    const candidate = path.join(extDir, "..", "agents");
    if (isDirectory(candidate)) return candidate;
  } catch {
    /* __dirname may not be available in some loaders */
  }
  return null;
}

function resolveSkillPath(raw: string, agentFileDir: string, cwd: string): string {
  if (path.isAbsolute(raw)) return raw;
  const relativeToAgent = path.resolve(agentFileDir, raw);
  if (fs.existsSync(relativeToAgent)) return relativeToAgent;
  const relativeToCwd = path.resolve(cwd, raw);
  if (fs.existsSync(relativeToCwd)) return relativeToCwd;
  const globalSkill = path.join(getAgentDir(), "skills", raw);
  if (fs.existsSync(globalSkill)) return globalSkill;
  const globalSkillAlt = path.join(os.homedir(), ".agents", "skills", raw);
  if (fs.existsSync(globalSkillAlt)) return globalSkillAlt;
  const projectSkill = path.join(cwd, ".pi", "skills", raw);
  if (fs.existsSync(projectSkill)) return projectSkill;
  const projectSkillAlt = path.join(cwd, ".agents", "skills", raw);
  if (fs.existsSync(projectSkillAlt)) return projectSkillAlt;
  return relativeToCwd;
}

function loadDefinitionsFromDir(dir: string, source: "user" | "project" | "package", cwd: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  if (!fs.existsSync(dir)) return defs;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return defs;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const skills = frontmatter.skills
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => resolveSkillPath(s, dir, cwd));

    defs.push({
      name: frontmatter.name,
      description: frontmatter.description,
      model: frontmatter.model,
      tools: tools && tools.length > 0 ? tools : undefined,
      skills: skills && skills.length > 0 ? skills : undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return defs;
}

function discoverDefinitions(cwd: string): AgentDefinition[] {
  const userDir = path.join(getAgentDir(), "agents");
  const projectDir = findProjectAgentsDir(cwd);
  const packageDir = getPackageAgentsDir();

  const userDefs = loadDefinitionsFromDir(userDir, "user", cwd);
  const projectDefs = projectDir ? loadDefinitionsFromDir(projectDir, "project", cwd) : [];
  const packageDefs = packageDir ? loadDefinitionsFromDir(packageDir, "package", cwd) : [];

  const map = new Map<string, AgentDefinition>();
  for (const d of packageDefs) map.set(d.name, d);
  for (const d of userDefs) map.set(d.name, d);
  for (const d of projectDefs) map.set(d.name, d);

  return Array.from(map.values());
}

function getDefinition(name: string, cwd: string): AgentDefinition | undefined {
  return discoverDefinitions(cwd).find((d) => d.name === name);
}

// ── UI panel ──

let currentCtx: ExtensionContext | undefined;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIndex = 0;
let spinnerTimer: NodeJS.Timeout | undefined;

function ensureSpinner() {
  if (spinnerTimer) return;
  spinnerTimer = setInterval(() => {
    spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
    refreshPanel();
  }, 120);
}

function stopSpinnerIfIdle() {
  const anyStreaming = Array.from(agents.values()).some((a) => a.status === "streaming");
  if (!anyStreaming && spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = undefined;
  }
}

function refreshPanel() {
  if (!currentCtx?.hasUI) return;
  const theme = currentCtx.ui.theme;
  const lines: string[] = [];

  if (agents.size === 0) {
    lines.push(theme.fg("dim", "No subagents"));
  } else {
    const parts: string[] = [];
    for (const [name, agent] of agents) {
      const defName = agent.definition?.name ? ` (${agent.definition.name})` : "";
      const parentTag = agent.parent ? theme.fg("dim", `←${agent.parent}`) : "";
      if (agent.status === "streaming") {
        const frame = theme.fg("accent", SPINNER_FRAMES[spinnerIndex]);
        parts.push(`${frame} ${theme.fg("warning", name)}${theme.fg("dim", defName)}${parentTag}`);
      } else if (agent.status === "idle") {
        parts.push(`${theme.fg("success", "●")} ${theme.fg("dim", name)}${theme.fg("dim", defName)}${parentTag}`);
      } else {
        parts.push(`${theme.fg("error", "○")} ${theme.fg("dim", name)}${theme.fg("dim", defName)}${parentTag}`);
      }
    }
    lines.push(parts.join("  "));
  }

  currentCtx.ui.setWidget("multi-agent", lines, { placement: "belowEditor" });

  const alive = Array.from(agents.values()).filter((a) => a.status === "idle" || a.status === "streaming").length;
  const working = Array.from(agents.values()).filter((a) => a.status === "streaming").length;
  const statusText = agents.size
    ? `${alive}/${agents.size} agents${working ? ` (${working} working)` : ""}`
    : "";
  currentCtx.ui.setStatus("multi-agent", theme.fg("dim", statusText));
}

function clearPanel() {
  if (!currentCtx?.hasUI) return;
  currentCtx.ui.setWidget("multi-agent", undefined);
  currentCtx.ui.setStatus("multi-agent", undefined);
}

// ── Bwrap / worktree helpers ──

function hasBwrap(): boolean {
  try {
    const result = spawnSync("which", ["bwrap"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

// Serialize git worktree operations
let worktreeLock = Promise.resolve();

async function createWorktree(id: string, repoCwd: string): Promise<string> {
  const worktreePath = path.join(os.tmpdir(), `pi-worktree-${id}-${Date.now()}`);
  const prev = worktreeLock;
  let result: string = worktreePath;

  worktreeLock = prev.then(async () => {
    log("worktree", `Creating worktree for '${id}'`, { path: worktreePath, repoCwd });
    return new Promise<void>((resolve, reject) => {
      const proc = spawn("git", ["worktree", "add", worktreePath, "HEAD"], {
        cwd: repoCwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout!.on("data", (d) => { stdout += d.toString(); });
      proc.stderr!.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`git worktree add failed: ${stderr || stdout}`));
        }
      });
      proc.on("error", (err) => reject(err));
    });
  });

  await worktreeLock;
  return result;
}

async function removeWorktree(worktreePath: string): Promise<void> {
  log("worktree", `Removing worktree`, { path: worktreePath });
  return new Promise<void>((resolve) => {
    const proc = spawn("git", ["worktree", "remove", "--force", worktreePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.on("close", () => {
      // Also clean up the directory if git didn't fully remove it
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve();
    });
    proc.on("error", () => {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve();
    });
  });
}

function cleanupOrphanedWorktrees() {
  const tmpDir = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      if (entry.startsWith("pi-worktree-")) {
        const fullPath = path.join(tmpDir, entry);
        const isActive = Array.from(agents.values()).some((a) => a.worktreePath === fullPath);
        if (!isActive) {
          log("worktree", `Cleaning up orphaned worktree`, { path: fullPath });
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
}

// ── Spawn helper ──

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }
  return { command: "pi", args };
}

async function spawnAgent(
  id: string,
  options: {
    model?: string;
    repoCwd: string;
    definition?: AgentDefinition;
    parent?: string;
    worktreePath?: string;
  }
): Promise<{ agent: Agent; error?: string }> {
  const { model, repoCwd, definition, parent, worktreePath: reuseWorktree } = options;

  if (!hasBwrap()) {
    return { agent: null as any, error: "bwrap is not installed. Install bubblewrap to use agent sandboxing." };
  }

  // Determine worktree
  let worktreePath: string;
  if (reuseWorktree) {
    worktreePath = reuseWorktree;
  } else {
    try {
      worktreePath = await createWorktree(id, repoCwd);
    } catch (err: any) {
      return { agent: null as any, error: `Failed to create worktree: ${err.message}` };
    }
  }

  // Ensure comms directory exists in worktree
  const commsDir = path.join(worktreePath, ".pi", "comms");
  fs.mkdirSync(commsDir, { recursive: true });
  fs.mkdirSync(path.join(commsDir, "requests"), { recursive: true });
  fs.mkdirSync(path.join(commsDir, "responses"), { recursive: true });

  // Write prompt into worktree so it's visible inside bwrap
  let promptInsideBwrap: string | null = null;
  if (definition?.systemPrompt?.trim()) {
    const filledPrompt = definition.systemPrompt
      .replace(/\{\{name\}\}/g, id)
      .replace(/\{\{type\}\}/g, definition.name);
    const promptDir = path.join(worktreePath, ".pi", "prompts");
    fs.mkdirSync(promptDir, { recursive: true });
    const promptFile = path.join(promptDir, `${id}.md`);
    fs.writeFileSync(promptFile, filledPrompt, { encoding: "utf-8", mode: 0o600 });
    promptInsideBwrap = `/tmp/workspace/.pi/prompts/${id}.md`;
  }

  const effectiveModel = definition?.model || model;
  const effectiveTools = definition?.tools;

  const piArgs = ["--mode", "rpc", "--no-session"];
  if (effectiveModel) piArgs.push("--model", effectiveModel);
  if (effectiveTools && effectiveTools.length > 0) piArgs.push("--tools", effectiveTools.join(","));
  if (promptInsideBwrap) piArgs.push("--system-prompt", promptInsideBwrap);
  if (definition?.skills) {
    piArgs.push("--no-skills");
    for (const skillPath of definition.skills) {
      piArgs.push("--skill", skillPath);
    }
  }

  // Copy delegate extension into worktree so sub-agent can load it inside bwrap
  let delegateInsideBwrap: string | null = null;
  try {
    const delegateSource = path.join(__dirname, "delegate-agent.ts");
    if (fs.existsSync(delegateSource)) {
      const delegateDir = path.join(worktreePath, ".pi", "extensions");
      const delegateDest = path.join(delegateDir, "delegate-agent.ts");
      fs.mkdirSync(delegateDir, { recursive: true });
      fs.copyFileSync(delegateSource, delegateDest);
      delegateInsideBwrap = "/tmp/workspace/.pi/extensions/delegate-agent.ts";
    }
  } catch {
    /* ignore copy failures */
  }
  if (delegateInsideBwrap) {
    piArgs.push("--no-extensions");
    piArgs.push("--extension", delegateInsideBwrap);
  }

  // Build bwrap command
  const piInvocation = getPiInvocation(piArgs);

  // Make ~/.pi/agent writable so the agent can create lock files / sessions
  const piAgentDir = path.join(os.homedir(), ".pi", "agent");
  const agentBindArgs = fs.existsSync(piAgentDir)
    ? ["--bind", piAgentDir, piAgentDir]
    : [];

  const bwrapArgs = [
    "--ro-bind", "/", "/",
    "--tmpfs", "/tmp",
    "--dev", "/dev",
    "--bind", worktreePath, "/tmp/workspace",
    "--chdir", "/tmp/workspace",
    "--share-net",
    "--setenv", "HOME", os.homedir(),
    ...agentBindArgs,
    piInvocation.command,
    ...piInvocation.args,
  ];

  log("spawn", `Starting agent '${id}' in bwrap`, { worktree: worktreePath, bwrap: `bwrap ${bwrapArgs.join(" ")}` });

  const proc = spawn("bwrap", bwrapArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  log("spawn", `Agent '${id}' process started (pid=${proc.pid})`);

  const agent: Agent = {
    id,
    proc,
    stdin: proc.stdin!,
    status: "idle",
    accumulatedText: "",
    history: [],
    buffer: "",
    definition,
    worktreePath,
    parent,
    children: [],
  };

  const flush = () => {
    const lines = agent.buffer.split("\n");
    agent.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "agent_start") {
          agent.status = "streaming";
          agent.accumulatedText = "";
          ensureSpinner();
          refreshPanel();
        } else if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (delta?.type === "text_delta" && typeof delta.delta === "string") {
            agent.accumulatedText += delta.delta;
          }
        } else if (event.type === "agent_end") {
          agent.status = "idle";
          const msgs = event.messages || [];
          const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
          if (lastAssistant) {
            const text =
              lastAssistant.content
                ?.filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("") || "";
            if (text && !agent.accumulatedText) agent.accumulatedText = text;
          }
          agent.history.push({ role: "assistant", text: agent.accumulatedText });
          if (agent._nextTurn) {
            agent._nextTurn.resolve();
            agent._nextTurn = undefined;
          }
          stopSpinnerIfIdle();
          refreshPanel();
        } else if (event.type === "tool_execution_start" && event.toolName === "delegate") {
          const toolCallId = event.toolCallId;
          const args = event.args || {};
          const target = args.target;
          const task = args.task;
          if (toolCallId && target && task) {
            log("delegate", `Agent '${id}' delegated to '${target}'`, { toolCallId });
            Promise.resolve().then(async () => {
              try {
                const reqFile = path.join(agent.worktreePath, ".pi", "comms", "requests", `${toolCallId}.json`);
                // Wait briefly for the request file to be written by the delegate tool
                let retries = 0;
                while (!fs.existsSync(reqFile) && retries < 20) {
                  await new Promise((r) => setTimeout(r, 50));
                  retries++;
                }
                if (!fs.existsSync(reqFile)) {
                  log("delegate", `Request file not found for ${toolCallId}`);
                  return;
                }

                const targetAgent = agents.get(target);
                if (!targetAgent) {
                  const respFile = path.join(agent.worktreePath, ".pi", "comms", "responses", `${toolCallId}.json`);
                  fs.writeFileSync(respFile, `Error: Target agent '${target}' not found`, "utf-8");
                  log("delegate", `Target agent '${target}' not found`);
                  return;
                }

                await sendToAgent(targetAgent, task, 300_000);
                const result = targetAgent.accumulatedText || "(no response)";

                const respFile = path.join(agent.worktreePath, ".pi", "comms", "responses", `${toolCallId}.json`);
                fs.writeFileSync(respFile, result, "utf-8");
                log("delegate", `Routed ${toolCallId} to '${target}', result written (${result.length} chars)`);
              } catch (err: any) {
                log("delegate", `Routing error for ${toolCallId}: ${err.message}`);
                const respFile = path.join(agent.worktreePath, ".pi", "comms", "responses", `${toolCallId}.json`);
                fs.writeFileSync(respFile, `Error: ${err.message}`, "utf-8");
              }
            });
          }
        }
      } catch (e) {
        log("rpc", `Agent '${id}' malformed JSON line`, line.slice(0, 200));
      }
    }
  };

  proc.stdout!.on("data", (data: Buffer) => {
    agent.buffer += data.toString();
    flush();
  });

  proc.stderr!.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) log("rpc", `Agent '${id}' STDERR`, text);
  });

  proc.on("close", (code) => {
    log("spawn", `Agent '${id}' process closed`, { code });
    agent.status = "exited";
    if (agent._nextTurn) {
      agent._nextTurn.reject(new Error(`Agent '${id}' exited with code ${code}`));
      agent._nextTurn = undefined;
    }
    stopSpinnerIfIdle();
    refreshPanel();
  });

  proc.on("error", (err) => {
    log("spawn", `Agent '${id}' process error`, err.message);
    agent.status = "error";
    if (agent._nextTurn) {
      agent._nextTurn.reject(new Error(`Agent '${id}' process error: ${err.message}`));
      agent._nextTurn = undefined;
    }
    stopSpinnerIfIdle();
    refreshPanel();
  });

  return { agent };
}

// ── Send helper (sync blocking, for sub-agent delegation chains) ──

async function sendToAgent(agent: Agent, message: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  log("send", `Agent '${agent.id}' queuing send`);
  while (agent._currentSend) {
    if (signal?.aborted) throw new Error("Aborted");
    try {
      await agent._currentSend;
    } catch {
      /* ignore previous errors */
    }
  }

  const perform = async () => {
    if (agent.status === "error" || agent.status === "exited") {
      throw new Error(`Agent is ${agent.status}`);
    }

    agent.history.push({ role: "user", text: message });
    agent.accumulatedText = "";

    const cmd = { type: "prompt", message };
    agent.stdin.write(JSON.stringify(cmd) + "\n");
    log("send", `Agent '${agent.id}' prompt written`);

    await new Promise<void>((resolve, reject) => {
      agent._nextTurn = { resolve, reject };
      agent._turnTimer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("Aborted"));
          },
          { once: true },
        );
      }
    });

    if (agent._turnTimer) {
      clearTimeout(agent._turnTimer);
      agent._turnTimer = undefined;
    }
    agent._nextTurn = undefined;
    log("send", `Agent '${agent.id}' send resolved`);
  };

  agent._currentSend = perform();
  try {
    await agent._currentSend;
  } finally {
    agent._currentSend = undefined;
  }
}

// ── Extension export ──

export default function (pi: ExtensionAPI) {
  log("init", "multi-agent extension loaded");

  // Cleanup orphaned worktrees from previous sessions
  cleanupOrphanedWorktrees();

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    refreshPanel();
  });

  pi.on("session_shutdown", async () => {
    log("lifecycle", "session_shutdown -> killing all child agents and removing worktrees");
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = undefined;
    }
    for (const [, agent] of agents) {
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");
    }
    // Wait a moment for processes to die, then remove worktrees
    await new Promise((r) => setTimeout(r, 500));
    for (const [, agent] of agents) {
      await removeWorktree(agent.worktreePath);
    }
    agents.clear();
    clearPanel();
  });

  // ====== TOOLS ======

  pi.registerTool({
    name: "agent_types",
    label: "Agent Types",
    description: "List available agent definitions discovered from ~/.pi/agent/agents and .pi/agents.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const defs = discoverDefinitions(ctx.cwd);
      const lines = defs.map((d) => {
        const skills = d.skills ? ` [skills: ${d.skills.length}]` : "";
        const tools = d.tools ? ` [tools: ${d.tools.join(",")}]` : "";
        return `- ${d.name} (${d.source}): ${d.description}${tools}${skills}`;
      });
      return {
        content: [
          {
            type: "text",
            text: defs.length
              ? `Available agent types:\n${lines.join("\n")}`
              : "No agent definitions found.",
          },
        ],
        details: { definitions: defs.map((d) => ({ name: d.name, source: d.source, description: d.description })) },
      };
    },
  });

  pi.registerTool({
    name: "agent_spawn",
    label: "Spawn Agent",
    description: [
      "Spawn a named sub-agent as a persistent Pi RPC process inside a bwrap sandbox.",
      "Root agents (parent='self') get a new git worktree. Sub-agents share their parent's worktree.",
    ].join(" "),
    parameters: Type.Object({
      name: Type.String({ description: "Unique instance name, e.g. 'lead' or 'scout_1'" }),
      type: Type.Optional(Type.String({ description: "Agent definition name, e.g. 'coder'" })),
      model: Type.Optional(Type.String({ description: "Override model pattern" })),
      parent: Type.String({ description: "Parent agent name, or 'self' for root agents" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      log("tool", `agent_spawn called`, { name: params.name, type: params.type, parent: params.parent });
      currentCtx = ctx;

      if (agents.has(params.name)) {
        return {
          content: [{ type: "text", text: `Agent '${params.name}' already exists.` }],
          isError: true,
          details: {},
        };
      }

      let definition: AgentDefinition | undefined;
      if (params.type) {
        definition = getDefinition(params.type, ctx.cwd);
        if (!definition) {
          const available = discoverDefinitions(ctx.cwd).map((d) => d.name).join(", ") || "none";
          return {
            content: [
              { type: "text", text: `Agent type '${params.type}' not found. Available: ${available}` },
            ],
            isError: true,
            details: {},
          };
        }
      }

      let worktreePath: string | undefined;
      if (params.parent !== "self") {
        const parentAgent = agents.get(params.parent);
        if (!parentAgent) {
          return {
            content: [{ type: "text", text: `Parent agent '${params.parent}' not found.` }],
            isError: true,
            details: {},
          };
        }
        worktreePath = parentAgent.worktreePath;
        parentAgent.children.push(params.name);
      }

      const result = await spawnAgent(params.name, {
        model: params.model,
        repoCwd: ctx.cwd,
        definition,
        parent: params.parent === "self" ? undefined : params.parent,
        worktreePath,
      });

      if (result.error || !result.agent) {
        return {
          content: [{ type: "text", text: result.error || "Unknown spawn error" }],
          isError: true,
          details: {},
        };
      }

      agents.set(params.name, result.agent);
      await new Promise((r) => setTimeout(r, 1000));
      refreshPanel();

      if (result.agent.status === "error" || result.agent.status === "exited") {
        agents.delete(params.name);
        await removeWorktree(result.agent.worktreePath);
        return {
          content: [
            { type: "text", text: `Failed to spawn agent '${params.name}'. Check logs.` },
          ],
          isError: true,
          details: {},
        };
      }

      const defInfo = definition ? ` (type: ${definition.name})` : "";
      const parentInfo = params.parent === "self" ? "root" : `child of ${params.parent}`;
      return {
        content: [
          {
            type: "text",
            text: `Spawned agent '${params.name}'${defInfo} (${parentInfo}, worktree: ${result.agent.worktreePath}) (status: ${result.agent.status}).`,
          },
        ],
        details: {
          name: params.name,
          status: result.agent.status,
          worktree: result.agent.worktreePath,
          definition: definition
            ? { name: definition.name, model: definition.model, tools: definition.tools }
            : undefined,
        },
      };
    },
  });

  pi.registerTool({
    name: "agent_send",
    label: "Send to Agent",
    description: [
      "Send a message to a spawned agent and wait for its response.",
      "If the agent has children, this will recursively delegate through the chain.",
    ].join(" "),
    parameters: Type.Object({
      name: Type.String({ description: "Agent instance name" }),
      message: Type.String({ description: "Message to send" }),
      timeout_seconds: Type.Optional(Type.Number({ default: 300 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      log("tool", `agent_send called`, { name: params.name });
      currentCtx = ctx;
      const agent = agents.get(params.name);
      if (!agent) {
        return {
          content: [
            { type: "text", text: `Agent '${params.name}' not found. Use agent_status to list agents.` },
          ],
          isError: true,
          details: {},
        };
      }

      const taskId = `${params.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingTasks.set(taskId, { name: params.name, message: params.message, startTime: Date.now() });

      // Fire off in background so the orchestrator isn't blocked
      Promise.resolve().then(async () => {
        try {
          await sendToAgent(agent, params.message, (params.timeout_seconds || 300) * 1000);
          const result = agent.accumulatedText || "(agent returned empty response)";
          log("tool", `agent_send async result`, { name: params.name, length: result.length });
          pi.sendUserMessage(`[${params.name}] ${result}`, { deliverAs: "steer" });
        } catch (err: any) {
          log("tool", `agent_send async error`, { name: params.name, error: err.message });
          pi.sendUserMessage(`[${params.name}] Error: ${err.message}`, { deliverAs: "steer" });
        } finally {
          pendingTasks.delete(taskId);
        }
      });

      return {
        content: [
          { type: "text", text: `Queued task for '${params.name}'. Result will be delivered when the agent completes.` },
        ],
        details: { queued: true, agent: params.name, taskId },
      };
    },
  });

  pi.registerTool({
    name: "agent_status",
    label: "Agent Status",
    description: "Check the status of all spawned agents or one specific agent.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Optional agent instance name" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      currentCtx = ctx;
      if (params.name) {
        const agent = agents.get(params.name);
        if (!agent)
          return {
            content: [{ type: "text", text: `Agent '${params.name}' not found.` }],
            isError: true,
            details: {},
          };
        const last = agent.history[agent.history.length - 1];
        const def = agent.definition ? ` [type: ${agent.definition.name}]` : "";
        const parent = agent.parent ? ` [parent: ${agent.parent}]` : " [root]";
        return {
          content: [
            {
              type: "text",
              text: `Agent '${params.name}'${def}${parent}: ${agent.status}, turns: ${Math.floor(agent.history.length / 2)}\nLast: ${last?.text.slice(0, 200) || "(none)"}`,
            },
          ],
          details: {
            name: agent.id,
            status: agent.status,
            worktree: agent.worktreePath,
            turns: Math.floor(agent.history.length / 2),
          },
        };
      }
      const list = Array.from(agents.entries()).map(([name, a]) => ({
        name,
        status: a.status,
        type: a.definition?.name,
        parent: a.parent || "self",
        worktree: a.worktreePath,
        turns: Math.floor(a.history.length / 2),
      }));
      return {
        content: [
          { type: "text", text: list.length ? JSON.stringify(list, null, 2) : "No active agents." },
        ],
        details: { agents: list },
      };
    },
  });

  pi.registerTool({
    name: "agent_kill",
    label: "Kill Agent",
    description: "Terminate an agent and its children, removing their worktree if root.",
    parameters: Type.Object({
      name: Type.String({ description: "Agent instance name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      currentCtx = ctx;
      const agent = agents.get(params.name);
      if (!agent)
        return {
          content: [{ type: "text", text: `Agent '${params.name}' not found.` }],
          isError: true,
          details: {},
        };

      // Kill children recursively
      for (const childId of agent.children) {
        const child = agents.get(childId);
        if (child && !child.proc.killed) child.proc.kill("SIGTERM");
      }
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");

      setTimeout(() => {
        if (!agent.proc.killed) agent.proc.kill("SIGKILL");
      }, 3000);

      // Remove from parent's children list
      if (agent.parent) {
        const parent = agents.get(agent.parent);
        if (parent) {
          parent.children = parent.children.filter((c) => c !== params.name);
        }
      }

      // If root, remove worktree (and implicitly all children's shared files)
      if (!agent.parent) {
        await removeWorktree(agent.worktreePath);
      }

      agents.delete(params.name);
      stopSpinnerIfIdle();
      refreshPanel();
      return {
        content: [{ type: "text", text: `Killed agent '${params.name}'.` }],
        details: {},
      };
    },
  });

  // ====== COMMANDS ======

  pi.registerCommand("agent-types", {
    description: "List available agent definitions",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      const defs = discoverDefinitions(ctx.cwd);
      const lines = defs.map((d) => `- ${d.name} (${d.source}): ${d.description}`);
      ctx.ui.notify(defs.length ? lines.join("\n") : "No agent definitions found.", "info");
    },
  });

  pi.registerCommand("spawn", {
    description: "Spawn a named agent. Usage: /spawn <name> <parent|'self'> [type|model]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const name = parts[0];
      const parent = parts[1];
      const typeOrModel = parts[2];
      currentCtx = ctx;

      if (!name || !parent) {
        ctx.ui.notify("Usage: /spawn <name> <parent|'self'> [type|model]", "error");
        return;
      }
      if (agents.has(name)) {
        ctx.ui.notify(`Agent '${name}' already exists.`, "warning");
        return;
      }

      let definition: AgentDefinition | undefined;
      let overrideModel: string | undefined;
      if (typeOrModel) {
        definition = getDefinition(typeOrModel, ctx.cwd);
        if (!definition) overrideModel = typeOrModel;
      }

      let worktreePath: string | undefined;
      if (parent !== "self") {
        const parentAgent = agents.get(parent);
        if (!parentAgent) {
          ctx.ui.notify(`Parent agent '${parent}' not found.`, "error");
          return;
        }
        worktreePath = parentAgent.worktreePath;
        parentAgent.children.push(name);
      }

      const result = await spawnAgent(name, {
        model: overrideModel,
        repoCwd: ctx.cwd,
        definition,
        parent: parent === "self" ? undefined : parent,
        worktreePath,
      });

      if (result.error || !result.agent) {
        ctx.ui.notify(result.error || "Spawn failed", "error");
        return;
      }

      agents.set(name, result.agent);
      await new Promise((r) => setTimeout(r, 800));
      refreshPanel();

      if (result.agent.status === "error" || result.agent.status === "exited") {
        agents.delete(name);
        await removeWorktree(result.agent.worktreePath);
        ctx.ui.notify(`Agent '${name}' exited immediately after spawn. Check logs.`, "error");
        return;
      }

      const defInfo = definition ? ` (type: ${definition.name})` : "";
      ctx.ui.notify(`Spawned agent '${name}'${defInfo} (parent: ${parent}).`, "info");
    },
  });

  pi.registerCommand("ask", {
    description: "Send a message to an agent and show its reply. Usage: /ask <name> <message>",
    handler: async (args, ctx) => {
      const space = args.indexOf(" ");
      if (space === -1) {
        ctx.ui.notify("Usage: /ask <name> <message>", "error");
        return;
      }
      const name = args.slice(0, space);
      const message = args.slice(space + 1);
      currentCtx = ctx;
      const agent = agents.get(name);
      if (!agent) {
        ctx.ui.notify(`Agent '${name}' not found.`, "error");
        return;
      }
      try {
        await sendToAgent(agent, message, 300_000);
        pi.sendMessage({
          customType: "agent-reply",
          content: `**${name}:**\n${agent.accumulatedText}`,
          display: true,
        });
      } catch (err: any) {
        ctx.ui.notify(err.message, "error");
      }
    },
  });

  pi.registerCommand("agents", {
    description: "List all spawned agents",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      const list =
        Array.from(agents.entries())
          .map(([n, a]) => {
            const t = a.definition ? ` (${a.definition.name})` : "";
            const p = a.parent ? ` ←${a.parent}` : " [root]";
            return `${n}${t}${p}: ${a.status}`;
          })
          .join(", ") || "none";
      ctx.ui.notify(`Agents: ${list}`, "info");
    },
  });

  pi.registerCommand("kill", {
    description: "Kill a spawned agent. Usage: /kill <name>",
    handler: async (name, ctx) => {
      currentCtx = ctx;
      const agent = agents.get(name);
      if (!agent) {
        ctx.ui.notify(`Agent '${name}' not found.`, "error");
        return;
      }

      for (const childId of agent.children) {
        const child = agents.get(childId);
        if (child && !child.proc.killed) child.proc.kill("SIGTERM");
      }
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");

      if (agent.parent) {
        const parent = agents.get(agent.parent);
        if (parent) parent.children = parent.children.filter((c) => c !== name);
      } else {
        await removeWorktree(agent.worktreePath);
      }

      agents.delete(name);
      stopSpinnerIfIdle();
      refreshPanel();
      ctx.ui.notify(`Killed agent '${name}'.`, "info");
    },
  });
}
