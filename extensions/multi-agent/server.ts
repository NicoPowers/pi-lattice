import * as path from "node:path";
import * as fs from "node:fs";
import { agents, type Agent, log } from "./state.js";

// ── Types ──

export interface ServerDeps {
  repoCwd: string;
  spawnAgent: (id: string, options: any) => Promise<{ agent: Agent; error?: string }>;
  sendToAgent: (agent: Agent, message: string, timeoutMs: number) => Promise<void>;
  removeWorktree: (worktreePath: string) => Promise<void>;
  discoverDefinitions: (cwd: string) => Array<{ name: string; description: string; model?: string; tools?: string[]; source: string }>;
  getDefinition: (name: string, cwd: string) => { name: string; description: string; model?: string; tools?: string[]; skills?: string[]; systemPrompt: string; source: string; filePath: string } | undefined;
  notifyTerminal?: (text: string) => void;
}

interface ServerHandle {
  url: string;
  stop: () => void;
}

// ── SSE state ──

const sseControllers = new Set<ReadableStreamDefaultController>();

export function broadcast(event: { type: string; data: any }) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const encoded = new TextEncoder().encode(payload);
  for (const controller of sseControllers) {
    try {
      controller.enqueue(encoded);
    } catch {
      // client disconnected
    }
  }
}

// ── Helpers ──

function serializeAgent(agent: Agent) {
  return {
    name: agent.id,
    status: agent.status,
    definition: agent.definition?.name,
    parent: agent.parent,
    children: agent.children,
    turns: Math.floor(agent.history.length / 2),
    worktree: agent.worktreePath,
  };
}

function jsonResponse(data: any, status = 200) {
  return Response.json(data, { status });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ── Port probing ──

export async function findPort(preferred = [18765, 18766, 18767]): Promise<number> {
  for (const port of preferred) {
    try {
      const probe = Bun.serve({ port, fetch: () => new Response("ok") });
      probe.stop();
      return port;
    } catch {
      /* port in use */
    }
  }
  return 0;
}

// ── Server startup ──

export async function startServer(deps: ServerDeps): Promise<ServerHandle> {
  const port = await findPort();

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // CORS preflight
      const corsHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Static: dashboard
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const htmlPath = path.join(__dirname, "..", "..", "web", "index.html");
        if (fs.existsSync(htmlPath)) {
          return new Response(Bun.file(htmlPath), {
            headers: { "Content-Type": "text/html", ...corsHeaders },
          });
        }
        return errorResponse("Dashboard not found", 404);
      }

      // SSE: live event stream
      if (url.pathname === "/events") {
        const stream = new ReadableStream({
          start(controller) {
            sseControllers.add(controller);
            const initEvent = {
              type: "init",
              data: {
                agents: Object.fromEntries(
                  Array.from(agents.entries()).map(([k, v]) => [k, serializeAgent(v)])
                ),
              },
            };
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(initEvent)}\n\n`));
          },
          cancel(controller) {
            sseControllers.delete(controller);
          },
        });
        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // REST API

      // GET /api/agents
      if (url.pathname === "/api/agents" && req.method === "GET") {
        const list = Array.from(agents.entries()).map(([_, a]) => serializeAgent(a));
        return jsonResponse(list);
      }

      // GET /api/agent-types
      if (url.pathname === "/api/agent-types" && req.method === "GET") {
        const defs = deps.discoverDefinitions(deps.repoCwd);
        return jsonResponse(
          defs.map((d) => ({
            name: d.name,
            description: d.description,
            model: d.model,
            tools: d.tools,
            source: d.source,
          }))
        );
      }

      // POST /api/spawn
      if (url.pathname === "/api/spawn" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        const { name, parent, type, model } = body;

        if (!name || !parent) {
          return errorResponse("Missing required fields: name, parent");
        }
        if (agents.has(name)) {
          return errorResponse(`Agent '${name}' already exists`, 409);
        }

        let definition = type ? deps.getDefinition(type, deps.repoCwd) : undefined;
        if (type && !definition) {
          return errorResponse(`Agent type '${type}' not found`, 404);
        }

        let worktreePath: string | undefined;
        if (parent !== "self") {
          const parentAgent = agents.get(parent);
          if (!parentAgent) {
            return errorResponse(`Parent agent '${parent}' not found`, 404);
          }
          worktreePath = parentAgent.worktreePath;
          parentAgent.children.push(name);
        }

        const result = await deps.spawnAgent(name, {
          model,
          repoCwd: deps.repoCwd,
          definition,
          parent: parent === "self" ? undefined : parent,
          worktreePath,
        });

        if (result.error || !result.agent) {
          return errorResponse(result.error || "Spawn failed", 500);
        }

        agents.set(name, result.agent);

        if (result.agent.status === "error" || result.agent.status === "exited") {
          agents.delete(name);
          await deps.removeWorktree(result.agent.worktreePath);
          return errorResponse("Agent exited immediately after spawn", 500);
        }

        broadcast({ type: "agent-spawned", data: serializeAgent(result.agent) });
        deps.notifyTerminal?.(`[dashboard] Spawned agent '${name}'`);

        return jsonResponse(serializeAgent(result.agent), 201);
      }

      // POST /api/agents/:name/send
      const sendMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/send$/);
      if (sendMatch && req.method === "POST") {
        const name = decodeURIComponent(sendMatch[1]);
        let body: any;
        try {
          body = await req.json();
        } catch {
          return errorResponse("Invalid JSON body");
        }
        const { message } = body;

        const agent = agents.get(name);
        if (!agent) {
          return errorResponse(`Agent '${name}' not found`, 404);
        }
        if (!message) {
          return errorResponse("Missing required field: message");
        }

        Promise.resolve().then(async () => {
          try {
            broadcast({ type: "agent-start", data: { name } });
            await deps.sendToAgent(agent, message, 300_000);
            const result = agent.accumulatedText || "(agent returned empty response)";
            broadcast({ type: "agent-end", data: { name, text: result } });
            deps.notifyTerminal?.(`[${name}] ${result}`);
          } catch (err: any) {
            broadcast({ type: "agent-error", data: { name, error: err.message } });
            deps.notifyTerminal?.(`[${name}] Error: ${err.message}`);
          }
        });

        return jsonResponse({ queued: true, agent: name });
      }

      // POST /api/agents/:name/kill
      const killMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/kill$/);
      if (killMatch && req.method === "POST") {
        const name = decodeURIComponent(killMatch[1]);
        const agent = agents.get(name);
        if (!agent) {
          return errorResponse(`Agent '${name}' not found`, 404);
        }

        for (const childId of agent.children) {
          const child = agents.get(childId);
          if (child && !child.proc.killed) child.proc.kill("SIGTERM");
        }
        if (!agent.proc.killed) agent.proc.kill("SIGTERM");

        setTimeout(() => {
          if (!agent.proc.killed) agent.proc.kill("SIGKILL");
        }, 3000);

        if (agent.parent) {
          const parent = agents.get(agent.parent);
          if (parent) parent.children = parent.children.filter((c) => c !== name);
        } else {
          await deps.removeWorktree(agent.worktreePath);
        }

        agents.delete(name);
        broadcast({ type: "agent-killed", data: { name } });
        deps.notifyTerminal?.(`[dashboard] Killed agent '${name}'`);

        return jsonResponse({ killed: true, name });
      }

      return errorResponse("Not found", 404);
    },
  });

  const url = `http://localhost:${server.port}`;
  log("server", `HTTP server listening on ${url}`);

  return {
    url,
    stop: () => {
      server.stop();
      for (const controller of sseControllers) {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
      sseControllers.clear();
    },
  };
}
