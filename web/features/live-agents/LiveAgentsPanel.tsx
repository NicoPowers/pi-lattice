import { useMemo, useState } from "react";
import type { AgentInfo } from "../../types.js";
import type { AgentState, LogLine, StatsEntry } from "../../shared/dashboard-types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";

function shortPath(p?: string): string {
  if (!p) return "";
  return p.length > 42 ? "…" + p.slice(-39) : p;
}

function formatCompactNumber(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function statusVariant(status: AgentInfo["status"]): "default" | "success" | "destructive" | "outline" {
  if (status === "idle") return "success";
  if (status === "error" || status === "exited") return "destructive";
  if (status === "streaming") return "default";
  return "outline";
}

export function AgentsPanel({ agents, stats, onInspect, pushLog }: { agents: Record<string, AgentState>; stats: Record<string, StatsEntry>; onInspect: (name: string) => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
  const entries = Object.entries(agents);
  return (
    <Card className="min-h-[70vh]">
      <CardHeader><CardTitle>Active Agents</CardTitle></CardHeader>
      <CardContent>
        {!entries.length ? <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No agents running.</div> :
          <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {entries.map(([name, agent]) => <AgentCard key={name} name={name} agent={agent} stats={stats[name]} onInspect={onInspect} pushLog={pushLog} />)}
          </div>}
      </CardContent>
    </Card>
  );
}

function AgentCard({ name, agent, stats, onInspect, pushLog }: { name: string; agent: AgentState; stats?: StatsEntry; onInspect: (name: string) => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
  const [message, setMessage] = useState("");
  const send = async () => {
    if (!message.trim()) return;
    const body = message.trim();
    setMessage("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: body }) });
      if (!res.ok) throw new Error(String(res.status));
      pushLog(`Queued message for ${name}`);
    } catch (e: any) {
      pushLog(`Send to ${name} failed: ${e.message}`, "error");
    }
  };
  const kill = async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/kill`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
    } catch (e: any) {
      pushLog(`Kill ${name} failed: ${e.message}`, "error");
    }
  };
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(agent.worktree || "");
      pushLog(`Copied worktree path for ${name}`, "success");
    } catch {
      pushLog(`Worktree path: ${agent.worktree}`);
    }
  };
  return (
    <Card className={agent.status === "streaming" ? "border-primary/50" : ""}>
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between gap-3"><CardTitle>{name}</CardTitle><Badge variant={statusVariant(agent.status)}>{agent.status}</Badge></div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span>{agent.definition ? `type: ${agent.definition}` : "no type"}</span>
          <span>{agent.parent ? `parent: ${agent.parent}` : "root"}</span>
          <span>turns: {agent.turns || 0}</span>
          <Stats stats={stats} />
          {agent.worktree && <><span title={agent.worktree}>worktree: {shortPath(agent.worktree)}</span><Button variant="secondary" className="px-2 py-1 text-xs" onClick={copyPath}>Copy Path</Button></>}
          <span title={agent.runtimeTools?.active.map((tool) => tool.name).join(", ") || "No runtime tool snapshot reported yet"}>tools: {agent.runtimeTools ? `${agent.runtimeTools.active.length} active / ${agent.runtimeTools.all.length} total` : "unknown"}</span>
          {!!agent.runtimeTools?.conflicts?.length && <Badge variant="warning" title={agent.runtimeTools.conflicts.map((conflict) => `${conflict.name}: ${conflict.count} registrations (${conflict.sources.join(", ") || "unknown sources"})`).join("\n")}>tool conflicts: {agent.runtimeTools.conflicts.length}</Badge>}
        </div>
        <pre className="max-h-72 min-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs leading-6">{agent.text || ""}</pre>
        <div className="flex gap-2">
          <Input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Message…" />
          <Button onClick={send}>Send</Button>
          <Button variant="secondary" onClick={() => onInspect(name)}>Inspect</Button>
          <Button variant="destructive" onClick={kill}>Kill</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stats({ stats }: { stats?: StatsEntry }) {
  if (!stats || stats.error) return <><span>ctx: —</span><span>cost: —</span></>;
  const s = stats.stats || {};
  const state = stats.state || {};
  const context = s.contextUsage || {};
  const used = context.tokens ?? context.current ?? s.tokens?.total;
  const max = context.contextWindow ?? context.max ?? state.model?.contextWindow;
  const pct = used && max ? Math.round((used / max) * 100) : undefined;
  const cost = typeof s.cost === "number" ? `$${s.cost.toFixed(4)}` : "—";
  const tokenText = used && max ? `${formatCompactNumber(used)} / ${formatCompactNumber(max)}` : formatCompactNumber(s.tokens?.total);
  return <><span>ctx: {pct !== undefined ? `${pct}% ` : ""}{tokenText}</span><span>cost: {cost}</span></>;
}

export function HierarchyPanel({ agents }: { agents: Record<string, AgentState> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const agent of Object.values(agents)) {
      if (!agent.parent) continue;
      map.set(agent.parent, [...(map.get(agent.parent) || []), agent.name]);
    }
    return map;
  }, [agents]);
  const roots = Object.values(agents).filter((a) => !a.parent || !agents[a.parent]);
  const renderNode = (agent: AgentState, depth = 0): React.ReactNode => {
    const children = Array.from(new Set([...(agent.children || []), ...(childrenByParent.get(agent.name) || [])])).filter((name) => agents[name]);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(agent.name);
    return <div key={agent.name}><button className="w-full py-1 text-left text-sm" style={{ paddingLeft: depth * 16 }} onClick={() => hasChildren && setExpanded((prev) => { const next = new Set(prev); next.has(agent.name) ? next.delete(agent.name) : next.add(agent.name); return next; })}>{hasChildren ? (isExpanded ? "▼ " : "▶ ") : "  "}<strong>{agent.name}</strong> <span className="text-xs text-muted-foreground">[{agent.definition || "custom"}]</span> <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge></button>{isExpanded && children.map((child) => renderNode(agents[child], depth + 1))}</div>;
  };
  return <Card className="min-h-[70vh]"><CardHeader><CardTitle>Hierarchy</CardTitle></CardHeader><CardContent>{roots.length ? roots.map((root) => renderNode(root)) : <div className="text-sm text-muted-foreground">No agents yet.</div>}</CardContent></Card>;
}
