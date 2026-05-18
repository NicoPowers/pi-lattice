import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentInfo, AgentTypeInfo, ExtensionInfo, ModelInfo, ServerEvent, SkillInfo } from "./types.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Dialog } from "./components/ui/dialog.js";
import { Input, Textarea } from "./components/ui/input.js";
import { Select } from "./components/ui/select.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";

type AgentState = AgentInfo & { text?: string };
type LogLine = { id: number; text: string; level: "info" | "success" | "warn" | "error" };
type Tab = "agents" | "types" | "skillTemplates" | "extensionTemplates" | "hierarchy" | "log";
type TemplateInfo = { name: string; description: string; items: string[]; applyToAll?: boolean; source: string; filePath: string };

type StatsEntry = { error?: string; stats?: any; state?: any };

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "agents", label: "Live Agents" },
  { id: "types", label: "Agent Types" },
  { id: "skillTemplates", label: "Skill Templates" },
  { id: "extensionTemplates", label: "Extension Templates" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "log", label: "Event Log" },
];

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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("agents");
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [agentStats, setAgentStats] = useState<Record<string, StatsEntry>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [types, setTypes] = useState<AgentTypeInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [skillTemplates, setSkillTemplates] = useState<TemplateInfo[]>([]);
  const [extensionTemplates, setExtensionTemplates] = useState<TemplateInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<{ kind: "skill" | "extension"; template?: TemplateInfo } | null>(null);
  const [editingType, setEditingType] = useState<AgentTypeInfo | null | undefined>(undefined);
  const [inspectAgentName, setInspectAgentName] = useState<string | null>(null);
  const [inspectText, setInspectText] = useState("Loading…");

  const pushLog = useCallback((text: string, level: LogLine["level"] = "info") => {
    setLogs((prev) => [{ id: Date.now() + Math.random(), level, text: `${new Date().toLocaleTimeString()}  ${text}` }, ...prev].slice(0, 100));
  }, []);

  const refreshTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-types");
      if (!res.ok) throw new Error(await res.text());
      setTypes(await res.json());
    } catch (e: any) {
      pushLog(`Failed to load agent types: ${e.message}`, "error");
    }
  }, [pushLog]);

  const refreshModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      if (!res.ok) return;
      const raw = await res.json();
      setModels(raw.map((m: string | ModelInfo) => typeof m === "string" ? { provider: "", id: m, context: "", maxOut: "", thinking: false, images: false } : m));
    } catch {
      setModels([]);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-stats");
      if (res.ok) setAgentStats(await res.json());
    } catch {
      // stats are best-effort
    }
  }, []);

  const refreshTemplates = useCallback(async () => {
    try {
      const [skillTemplatesRes, extsRes, availableExtsRes, skillsRes] = await Promise.all([
        fetch("/api/skill-templates"),
        fetch("/api/extension-templates"),
        fetch("/api/extensions"),
        fetch("/api/skills"),
      ]);
      if (skillTemplatesRes.ok) {
        const data = await skillTemplatesRes.json();
        setSkillTemplates(Array.isArray(data) ? data : []);
      }
      if (extsRes.ok) {
        const data = await extsRes.json();
        setExtensionTemplates(Array.isArray(data) ? data : []);
      }
      if (availableExtsRes.ok) {
        const data = await availableExtsRes.json();
        setExtensions(Array.isArray(data) ? data : []);
      }
      if (skillsRes.ok) {
        const data = await skillsRes.json();
        setSkills(Array.isArray(data) ? data : []);
      }
    } catch (e: any) {
      pushLog(`Failed to load templates: ${e.message}`, "error");
    }
  }, [pushLog]);

  const handleEvent = useCallback((ev: ServerEvent) => {
    switch (ev.type) {
      case "init":
        setAgents(Object.fromEntries(Object.entries(ev.data.agents || {}).map(([k, v]) => [k, { ...v }])));
        pushLog(`Synced ${Object.keys(ev.data.agents || {}).length} agents`);
        break;
      case "agent-spawned":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...prev[ev.data.name], ...ev.data } }));
        pushLog(`Agent ${ev.data.name} spawned (${ev.data.parent || "root"})`, "success");
        break;
      case "agent-killed":
        setAgents((prev) => {
          const next = { ...prev };
          delete next[ev.data.name];
          return next;
        });
        pushLog(`Agent ${ev.data.name} killed`, "warn");
        break;
      case "agent-delta":
        setAgents((prev) => {
          const current = prev[ev.data.name] || { name: ev.data.name, status: "idle", turns: 0, children: [], worktree: "" };
          return { ...prev, [ev.data.name]: { ...current, text: (current.text || "") + ev.data.delta } };
        });
        break;
      case "agent-start":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...(prev[ev.data.name] || { name: ev.data.name, turns: 0, children: [], worktree: "" }), status: "streaming" } }));
        break;
      case "agent-end":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...(prev[ev.data.name] || { name: ev.data.name, turns: 0, children: [], worktree: "" }), status: "idle", text: ev.data.text } }));
        break;
      case "agent-error":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...(prev[ev.data.name] || { name: ev.data.name, turns: 0, children: [], worktree: "" }), status: "error" } }));
        pushLog(`Agent ${ev.data.name} error: ${ev.data.error}`, "error");
        break;
      case "agent-exit":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...(prev[ev.data.name] || { name: ev.data.name, turns: 0, children: [], worktree: "" }), status: "exited" } }));
        pushLog(`Agent ${ev.data.name} exited (code ${ev.data.code ?? "?"})`, "warn");
        break;
      case "delegate":
        pushLog(`${ev.data.from} → ${ev.data.to} | ${ev.data.task.slice(0, 60)}`);
        break;
    }
  }, [pushLog]);

  useEffect(() => {
    let stopped = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      es = new EventSource("/events");
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 2000);
      };
      es.onmessage = (e) => handleEvent(JSON.parse(e.data) as ServerEvent);
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [handleEvent]);

  useEffect(() => {
    refreshTypes();
    refreshModels();
    refreshTemplates();
    refreshStats();
    const interval = setInterval(refreshStats, 5_000);
    return () => clearInterval(interval);
  }, [refreshModels, refreshStats, refreshTemplates, refreshTypes]);

  const emergencyStop = async () => {
    if (!confirm("Emergency Stop: Kill all agents and clean up worktrees?")) return;
    try {
      const res = await fetch("/api/emergency-stop", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      setAgents({});
      setAgentStats({});
      pushLog("EMERGENCY STOP executed", "error");
    } catch (e: any) {
      pushLog(`Emergency stop failed: ${e.message}`, "error");
    }
  };

  const inspect = async (name: string) => {
    setInspectAgentName(name);
    setInspectText("Loading…");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/events`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInspectText(formatInspectData(data));
    } catch (e: any) {
      setInspectText(`Inspect failed: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/85 px-6 py-4 backdrop-blur">
        <h1 className="text-xl font-semibold tracking-tight">🧠 Pi Orchestrator</h1>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground"><span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-muted-foreground"}`} /> {connected ? "Connected" : "Disconnected"}</span>
          <Button variant="destructive" onClick={emergencyStop}>🛑 Emergency Stop</Button>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl p-6">
        <Tabs>
          <TabsList className="mb-4 w-full">
            {tabs.map((tab) => <TabsTrigger key={tab.id} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</TabsTrigger>)}
          </TabsList>
          <TabsContent>
            {activeTab === "agents" && <AgentsPanel agents={agents} stats={agentStats} onInspect={inspect} pushLog={pushLog} />}
            {activeTab === "types" && <AgentTypesPanel types={types} onNew={() => setEditingType(null)} onEdit={(type) => setEditingType(type)} large />}
            {activeTab === "skillTemplates" && <TemplatesPanel kind="skill" templates={skillTemplates} onNew={() => setEditingTemplate({ kind: "skill" })} onEdit={(template) => setEditingTemplate({ kind: "skill", template })} onDeleted={refreshTemplates} pushLog={pushLog} />}
            {activeTab === "extensionTemplates" && <TemplatesPanel kind="extension" templates={extensionTemplates} onNew={() => setEditingTemplate({ kind: "extension" })} onEdit={(template) => setEditingTemplate({ kind: "extension", template })} onDeleted={refreshTemplates} pushLog={pushLog} />}
            {activeTab === "hierarchy" && <HierarchyPanel agents={agents} />}
            {activeTab === "log" && <EventLog logs={logs} />}
          </TabsContent>
        </Tabs>
      </main>

      <TypeEditorDialog open={editingType !== undefined} typeDef={editingType ?? undefined} models={models} skillTemplates={skillTemplates} extensionTemplates={extensionTemplates} onClose={() => setEditingType(undefined)} onSaved={() => { setEditingType(undefined); refreshTypes(); pushLog("Saved agent type", "success"); }} />
      <TemplateEditorDialog open={!!editingTemplate} kind={editingTemplate?.kind || "skill"} template={editingTemplate?.template} availableSkills={skills} availableExtensions={extensions} onClose={() => setEditingTemplate(null)} onSaved={() => { setEditingTemplate(null); refreshTemplates(); pushLog("Saved template", "success"); }} />
      <Dialog open={!!inspectAgentName} title={`Inspect ${inspectAgentName || "Agent"}`} onOpenChange={() => setInspectAgentName(null)} className="max-w-5xl">
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-sm leading-6">{inspectText}</pre>
      </Dialog>
    </div>
  );
}

function AgentsPanel({ agents, stats, onInspect, pushLog }: { agents: Record<string, AgentState>; stats: Record<string, StatsEntry>; onInspect: (name: string) => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
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

function AgentTypesPanel({ types, onNew, onEdit, large }: { types: AgentTypeInfo[]; onNew: () => void; onEdit: (type: AgentTypeInfo) => void; large?: boolean }) {
  return (
    <Card className={large ? "min-h-[70vh]" : ""}>
      <CardHeader><CardTitle>Agent Types</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!types.length ? <p className="text-sm text-muted-foreground">No agent types found.</p> : types.map((type) => (
          <div key={type.name} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
            <div><div className="text-sm font-semibold">{type.name}</div><div className="text-xs text-muted-foreground">{type.description}</div></div>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onEdit(type)}>Edit</Button>
          </div>
        ))}
        <Button variant="secondary" className="w-full" onClick={onNew}>+ New Type</Button>
      </CardContent>
    </Card>
  );
}

function HierarchyPanel({ agents }: { agents: Record<string, AgentState> }) {
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

function EventLog({ logs }: { logs: LogLine[] }) {
  return <Card className="min-h-[70vh]"><CardHeader><CardTitle>Event Log</CardTitle></CardHeader><CardContent className="max-h-[70vh] space-y-1 overflow-auto font-mono text-xs text-muted-foreground">{logs.length ? logs.map((line) => <div key={line.id} className={`border-l-2 pl-2 ${line.level === "error" ? "border-destructive" : line.level === "success" ? "border-emerald-400" : line.level === "warn" ? "border-amber-400" : "border-primary"}`}>{line.text}</div>) : "Waiting for events…"}</CardContent></Card>;
}

function splitItems(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)));
}

function toggleItemText(text: string, item: string): string {
  const items = splitItems(text);
  const next = items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
  return next.join("\n");
}

function TemplatesPanel({ kind, templates, onNew, onEdit, onDeleted, pushLog }: { kind: "skill" | "extension"; templates: TemplateInfo[]; onNew: () => void; onEdit: (template: TemplateInfo) => void; onDeleted: () => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
  const label = kind === "skill" ? "Skill Templates" : "Extension Templates";
  const deleteTemplate = async (name: string) => {
    if (!confirm(`Delete ${label.slice(0, -1).toLowerCase()} '${name}'?`)) return;
    const res = await fetch(`/api/${kind}-templates/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) return pushLog(`Delete failed: ${await res.text()}`, "error");
    pushLog(`Deleted template '${name}'`, "warn");
    onDeleted();
  };
  return <Card className="min-h-[70vh]"><CardHeader><CardTitle>{label}</CardTitle></CardHeader><CardContent className="space-y-3">
    {!templates.length ? <p className="text-sm text-muted-foreground">No {label.toLowerCase()} found.</p> : templates.map((template) => <div key={template.name} className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div><div className="flex items-center gap-2 text-sm font-semibold">{template.name}{template.applyToAll && <Badge variant="default">apply to all</Badge>}</div><div className="text-xs text-muted-foreground">{template.description}</div></div>
        <div className="flex gap-2"><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onEdit(template)}>Edit</Button><Button variant="destructive" className="px-2 py-1 text-xs" onClick={() => deleteTemplate(template.name)}>Delete</Button></div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">{template.items.length ? template.items.map((item) => <Badge key={item} variant="outline">{item}</Badge>) : <span className="text-xs text-muted-foreground">No items.</span>}</div>
    </div>)}
    <Button variant="secondary" className="w-full" onClick={onNew}>+ New {kind === "skill" ? "Skill" : "Extension"} Template</Button>
  </CardContent></Card>;
}

function TemplateEditorDialog({ open, kind, template, availableSkills, availableExtensions, onClose, onSaved }: { open: boolean; kind: "skill" | "extension"; template?: TemplateInfo; availableSkills: SkillInfo[]; availableExtensions: ExtensionInfo[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);
  const [itemsText, setItemsText] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(template?.name || "");
    setDescription(template?.description || "");
    setApplyToAll(!!template?.applyToAll);
    setItemsText((template?.items || []).join("\n"));
  }, [open, template]);
  const field = kind === "skill" ? "skills" : "extensions";
  const save = async () => {
    const payload = { name: name.trim(), description: description.trim(), applyToAll, [field]: splitItems(itemsText) };
    const res = await fetch(`/api/${kind}-templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return alert("Failed to save: " + await res.text());
    onSaved();
  };
  const title = `${template ? "Edit" : "New"} ${kind === "skill" ? "Skill" : "Extension"} Template`;
  return <Dialog open={open} title={title} onOpenChange={onClose}>
    <div className="space-y-3">
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">Name</label><Input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!template} />
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">Description</label><Input value={description} onChange={(e) => setDescription(e.target.value)} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} /> Apply to all newly spawned agents</label>
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">{kind === "skill" ? "Skills" : "Extensions"} (comma or newline separated)</label><Textarea rows={7} value={itemsText} onChange={(e) => setItemsText(e.target.value)} />
      {kind === "skill" && <div className="space-y-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">Discovered skills</div><div className="flex flex-wrap gap-1">{availableSkills.length ? availableSkills.map((skill) => <button key={skill.name} title={skill.description || skill.path} className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setItemsText((prev) => splitItems(`${prev}\n${skill.name}`).join("\n"))}>{skill.name}</button>) : <span className="text-xs text-muted-foreground">No skills discovered.</span>}</div></div>}
      {kind === "extension" && <div className="space-y-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">Discovered extensions</div><div className="flex flex-wrap gap-1">{availableExtensions.length ? availableExtensions.map((ext) => <button key={ext.name} className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setItemsText((prev) => splitItems(`${prev}\n${ext.name}`).join("\n"))}>{ext.name}</button>) : <span className="text-xs text-muted-foreground">No extensions discovered.</span>}</div></div>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Template</Button></div>
    </div>
  </Dialog>;
}

function TemplateChips({ templates, selectedText, emptyText, onToggle }: { templates: TemplateInfo[]; selectedText: string; emptyText: string; onToggle: (name: string) => void }) {
  const selected = new Set(splitItems(selectedText));
  return <div className="space-y-2"><div className="text-xs text-muted-foreground">Click to assign/unassign existing templates.</div><div className="flex flex-wrap gap-1">{templates.length ? templates.map((template) => {
    const active = selected.has(template.name);
    return <button key={template.name} type="button" title={template.description} className={`rounded-full border px-2 py-1 text-xs transition ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`} onClick={() => onToggle(template.name)}>{active ? "✓ " : ""}{template.name}</button>;
  }) : <span className="text-xs text-muted-foreground">{emptyText}</span>}</div></div>;
}

function TypeEditorDialog({ open, typeDef, models, skillTemplates, extensionTemplates, onClose, onSaved }: { open: boolean; typeDef?: AgentTypeInfo; models: ModelInfo[]; skillTemplates: TemplateInfo[]; extensionTemplates: TemplateInfo[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [skillTemplatesText, setSkillTemplatesText] = useState("");
  const [extensionTemplatesText, setExtensionTemplatesText] = useState("");
  const [prompt, setPrompt] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(typeDef?.name || "");
    setDescription(typeDef?.description || "");
    setModel(typeDef?.model || "");
    setThinking(typeDef?.thinking || "medium");
    setSkillTemplatesText((typeDef?.skillTemplates || []).join("\n"));
    setExtensionTemplatesText((typeDef?.extensionTemplates || []).join("\n"));
    setPrompt("");
  }, [open, typeDef]);
  const selectedModel = models.find((m) => m.id === model);
  const levels = selectedModel?.thinkingLevels || ["off", "minimal", "low", "medium", "high", "xhigh"];
  const save = async () => {
    if (!name.trim() || !description.trim()) return alert("Name and description are required");
    const payload = { name: name.trim(), description: description.trim(), model: model || undefined, thinking: selectedModel?.thinking ? thinking : undefined, skillTemplates: splitItems(skillTemplatesText), extensionTemplates: splitItems(extensionTemplatesText), prompt: prompt.trim() || undefined };
    const res = await fetch("/api/agent-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return alert("Failed to save: " + await res.text());
    onSaved();
  };
  return <Dialog open={open} title={typeDef ? `Edit ${typeDef.name}` : "New Agent Type"} onOpenChange={onClose}>
    <div className="space-y-3">
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">Name</label><Input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!typeDef} />
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">Description</label><Input value={description} onChange={(e) => setDescription(e.target.value)} />
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">Model</label><Select value={model} onChange={(e) => setModel(e.target.value)}><option value="">-- default --</option>{models.map((m) => <option key={m.id} value={m.id}>{m.provider ? `${m.provider}/${m.id}` : m.id}</option>)}</Select>
      {selectedModel?.thinking && <><label className="block text-xs uppercase tracking-wide text-muted-foreground">Thinking Level</label><Select value={thinking} onChange={(e) => setThinking(e.target.value)}>{levels.map((level) => <option key={level} value={level}>{level}</option>)}</Select></>}
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">Skill Templates</label><Textarea rows={3} value={skillTemplatesText} onChange={(e) => setSkillTemplatesText(e.target.value)} placeholder={skillTemplates.map((template) => template.name).join(", ") || "common, frontend"} />
      <TemplateChips templates={skillTemplates} selectedText={skillTemplatesText} emptyText="No skill templates defined yet." onToggle={(name) => setSkillTemplatesText((prev) => toggleItemText(prev, name))} />
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">Extension Templates</label><Textarea rows={3} value={extensionTemplatesText} onChange={(e) => setExtensionTemplatesText(e.target.value)} placeholder={extensionTemplates.map((template) => template.name).join(", ") || "browser-tools"} />
      <TemplateChips templates={extensionTemplates} selectedText={extensionTemplatesText} emptyText="No extension templates defined yet." onToggle={(name) => setExtensionTemplatesText((prev) => toggleItemText(prev, name))} />
      <label className="block text-xs uppercase tracking-wide text-muted-foreground">Prompt / Instructions</label><Textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Type</Button></div>
    </div>
  </Dialog>;
}

function formatInspectData(data: any): string {
  const lines: string[] = [`status: ${data.status}`, `worktree: ${data.worktree}`];
  if (data.runtimeTools) {
    lines.push(`runtime tools reported: ${new Date(data.runtimeTools.reportedAt).toLocaleString()}`);
    lines.push(`active tools: ${data.runtimeTools.active.map((tool: any) => tool.name).join(", ") || "(none)"}`);
    lines.push(`all tools: ${data.runtimeTools.all.map((tool: any) => tool.name).join(", ") || "(none)"}`);
  } else {
    lines.push("runtime tools: unknown");
  }
  lines.push("", "Recent events:");
  let textBuffer = "";
  let textStartTime = "";
  const flush = () => {
    const text = textBuffer.trim();
    if (text) lines.push(`${textStartTime} assistant_text ${JSON.stringify(text.length > 500 ? text.slice(0, 500) + "…" : text)}`);
    textBuffer = "";
    textStartTime = "";
  };
  for (const item of (data.events || []).slice(-180)) {
    const time = new Date(item.ts).toLocaleTimeString();
    const ev = item.event || {};
    if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
      if (!textStartTime) textStartTime = time;
      textBuffer += ev.assistantMessageEvent.delta || "";
      continue;
    }
    if (ev.type === "message_update") continue;
    flush();
    if (ev.type === "tool_execution_start") lines.push(`${time} tool_start ${ev.toolName || ""} ${JSON.stringify(ev.args || {}).slice(0, 220)}`);
    else if (ev.type === "tool_execution_end") lines.push(`${time} tool_end ${ev.toolName || ""}`);
    else if (["agent_start", "turn_start", "message_start", "message_end", "turn_end", "agent_end"].includes(ev.type)) lines.push(`${time} ${ev.type}`);
    else lines.push(`${time} ${ev.type || item.type}`);
  }
  flush();
  lines.push("", "Accumulated assistant text:", data.accumulatedText || "(none)");
  return lines.join("\n");
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
