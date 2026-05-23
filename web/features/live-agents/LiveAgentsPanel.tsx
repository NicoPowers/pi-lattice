import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentInfo, AgentTypeInfo } from "../../types.js";
import type {
	AgentState,
	LogLine,
	StatsEntry,
} from "../../shared/dashboard-types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Select } from "../../components/ui/select.js";

function shortPath(p?: string): string {
	if (!p) return "";
	return p.length > 42 ? "…" + p.slice(-39) : p;
}

function statusVariant(
	status: AgentInfo["status"],
): "default" | "success" | "destructive" | "outline" {
	if (status === "idle") return "success";
	if (status === "error" || status === "exited") return "destructive";
	if (status === "streaming") return "default";
	return "outline";
}

function spawnNameFor(typeName?: string): string {
	const base =
		(typeName || "agent")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "agent";
	return `${base}-${Date.now().toString(36).slice(-5)}`;
}

function previewMarkdown(agent: AgentState): string {
	if (agent.text) return agent.text;
	if (agent.pendingSend) {
		return [
			`**You:** ${agent.pendingSend.message}`,
			"",
			"_waiting for response…_",
		].join("\n");
	}
	return "";
}

export function AgentsPanel({
	agents,
	stats: _stats,
	agentTypes = [],
	onInspect,
	onAgentKilled,
	onAgentSpawned,
	pushLog,
}: {
	agents: Record<string, AgentState>;
	stats: Record<string, StatsEntry>;
	agentTypes?: AgentTypeInfo[];
	onInspect: (name: string) => void;
	onAgentKilled?: (name: string) => void;
	onAgentSpawned?: (agent: AgentInfo) => void;
	pushLog: (text: string, level?: LogLine["level"]) => void;
}) {
	const entries = Object.entries(agents);
	const spawnableTypes = agentTypes.filter(
		(type) => type.agentClass !== "orchestrator",
	);
	return (
		<Card className="min-h-[70vh]">
			<CardHeader>
				<CardTitle>Active Agents</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<SpawnAgentForm
					agentTypes={spawnableTypes}
					onAgentSpawned={onAgentSpawned}
					pushLog={pushLog}
				/>
				{!entries.length ? (
					<div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
						No agents running.
					</div>
				) : (
					<div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
						{entries.map(([name, agent]) => (
							<AgentCard
								key={name}
								name={name}
								agent={agent}
								onInspect={onInspect}
								onAgentKilled={onAgentKilled}
								pushLog={pushLog}
							/>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function SpawnAgentForm({
	agentTypes,
	onAgentSpawned,
	pushLog,
}: {
	agentTypes: AgentTypeInfo[];
	onAgentSpawned?: (agent: AgentInfo) => void;
	pushLog: (text: string, level?: LogLine["level"]) => void;
}) {
	const firstTypeName = agentTypes[0]?.name || "";
	const [selectedType, setSelectedType] = useState(firstTypeName);
	const [name, setName] = useState(spawnNameFor(firstTypeName));
	const [model, setModel] = useState("");
	const [issueId, setIssueId] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (selectedType || !firstTypeName) return;
		setSelectedType(firstTypeName);
		setName((current) => current || spawnNameFor(firstTypeName));
	}, [firstTypeName, selectedType]);

	const spawn = async () => {
		const spawnName = name.trim();
		if (!spawnName) {
			pushLog("Agent name is required", "error");
			return;
		}
		setBusy(true);
		try {
			const body = {
				name: spawnName,
				parent: "self",
				type: selectedType || undefined,
				model: model.trim() || undefined,
				issueId: issueId.trim() || undefined,
			};
			const res = await fetch("/api/spawn", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(await res.text());
			const agent = (await res.json()) as AgentInfo;
			onAgentSpawned?.(agent);
			pushLog(`Spawned ${agent.name}`, "success");
			setName(spawnNameFor(selectedType || agent.definition));
		} catch (e: any) {
			pushLog(`Spawn failed: ${e.message}`, "error");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="rounded-md border border-border bg-card/40 p-3">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<div className="text-sm font-semibold">Spawn persistent agent</div>
					<div className="text-xs text-muted-foreground">
						Creates a live agent that stays inspectable until you kill it.
					</div>
				</div>
				<Button onClick={spawn} disabled={busy || !name.trim()}>
					{busy ? "Spawning…" : "Spawn Agent"}
				</Button>
			</div>
			<div className="grid gap-2 md:grid-cols-3">
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Agent name"
				/>
				<Select
					value={selectedType}
					onChange={(e) => {
						setSelectedType(e.target.value);
						if (!name.trim()) setName(spawnNameFor(e.target.value));
					}}
					aria-label="Agent type"
				>
					<option value="">No type / default</option>
					{agentTypes.map((type) => (
						<option key={type.name} value={type.name}>
							{type.name}
						</option>
					))}
				</Select>
				<Input
					value={model}
					onChange={(e) => setModel(e.target.value)}
					placeholder="Optional model override"
				/>
			</div>
			<Input
				className="mt-2"
				value={issueId}
				onChange={(e) => setIssueId(e.target.value)}
				placeholder="Optional Seeds issue id for handoff artifacts"
			/>
		</div>
	);
}

function AgentCard({
	name,
	agent,
	onInspect,
	onAgentKilled,
	pushLog,
}: {
	name: string;
	agent: AgentState;
	onInspect: (name: string) => void;
	onAgentKilled?: (name: string) => void;
	pushLog: (text: string, level?: LogLine["level"]) => void;
}) {
	const [message, setMessage] = useState("");
	const [localPendingMessage, setLocalPendingMessage] = useState("");
	const preview = previewMarkdown(
		localPendingMessage && !agent.text
			? {
					...agent,
					pendingSend: agent.pendingSend || {
						message: localPendingMessage,
						startedAt: Date.now(),
						timeoutMs: 300_000,
						status: "queued",
					},
				}
			: agent,
	);
	const send = async () => {
		if (!message.trim()) return;
		const body = message.trim();
		setMessage("");
		setLocalPendingMessage(body);
		try {
			const res = await fetch(`/api/agents/${encodeURIComponent(name)}/send`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ message: body }),
			});
			if (!res.ok) throw new Error(String(res.status));
			pushLog(`Queued message for ${name}`);
		} catch (e: any) {
			setLocalPendingMessage("");
			pushLog(`Send to ${name} failed: ${e.message}`, "error");
		}
	};
	useEffect(() => {
		if (agent.text || agent.status === "idle" || agent.status === "error") {
			setLocalPendingMessage("");
		}
	}, [agent.status, agent.text]);
	const kill = async () => {
		try {
			const res = await fetch(`/api/agents/${encodeURIComponent(name)}/kill`, {
				method: "POST",
			});
			if (!res.ok) throw new Error(String(res.status));
			onAgentKilled?.(name);
			pushLog(`Killed ${name}`, "warn");
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
	const copyArtifactPath = async () => {
		try {
			await navigator.clipboard.writeText(agent.artifactPath || "");
			pushLog(`Copied artifact path for ${name}`, "success");
		} catch {
			pushLog(`Artifact path: ${agent.artifactPath}`);
		}
	};
	return (
		<Card className={agent.status === "streaming" ? "border-primary/50" : ""}>
			<CardHeader className="border-b border-border">
				<div className="flex items-center justify-between gap-3">
					<CardTitle>{name}</CardTitle>
					<Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-3 pt-4">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
					<span>
						{agent.definition ? `type: ${agent.definition}` : "no type"}
					</span>
					<span>model: {agent.model || "default"}</span>
					<span>{agent.parent ? `parent: ${agent.parent}` : "root"}</span>
					<span>turns: {agent.turns || 0}</span>
					{agent.worktree && (
						<>
							<span title={agent.worktree}>
								worktree: {shortPath(agent.worktree)}
							</span>
							<Button
								variant="secondary"
								className="px-2 py-1 text-xs"
								onClick={copyPath}
							>
								Copy Path
							</Button>
						</>
					)}
					{agent.issueId && (
						<Badge variant="outline">issue: {agent.issueId}</Badge>
					)}
					{agent.artifactPath && (
						<>
							<span title={agent.artifactPath}>
								artifacts: {shortPath(agent.artifactPath)}
							</span>
							<Button
								variant="secondary"
								className="px-2 py-1 text-xs"
								onClick={copyArtifactPath}
							>
								Copy Artifacts
							</Button>
						</>
					)}
					<span
						title={
							agent.runtimeTools?.active.map((tool) => tool.name).join(", ") ||
							"No runtime tool snapshot reported yet"
						}
					>
						tools:{" "}
						{agent.runtimeTools
							? `${agent.runtimeTools.active.length} active / ${agent.runtimeTools.all.length} total`
							: "unknown"}
					</span>
					{!!agent.runtimeTools?.conflicts?.length && (
						<Badge
							variant="warning"
							title={agent.runtimeTools.conflicts
								.map(
									(conflict) =>
										`${conflict.name}: ${conflict.count} registrations (${conflict.sources.join(", ") || "unknown sources"})`,
								)
								.join("\n")}
						>
							tool conflicts: {agent.runtimeTools.conflicts.length}
						</Badge>
					)}
				</div>
				<div className="prose prose-invert max-h-72 min-h-28 max-w-none overflow-auto rounded-md bg-background p-3 text-sm leading-6">
					{preview ? (
						<ReactMarkdown remarkPlugins={[remarkGfm]}>{preview}</ReactMarkdown>
					) : null}
				</div>
				<div className="flex gap-2">
					<Input
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") send();
						}}
						placeholder="Message…"
					/>
					<Button onClick={send}>Send</Button>
					<Button variant="secondary" onClick={() => onInspect(name)}>
						Inspect
					</Button>
					<Button variant="destructive" onClick={kill}>
						Kill
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

export function HierarchyPanel({
	agents,
}: {
	agents: Record<string, AgentState>;
}) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const childrenByParent = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const agent of Object.values(agents)) {
			if (!agent.parent) continue;
			map.set(agent.parent, [...(map.get(agent.parent) || []), agent.name]);
		}
		return map;
	}, [agents]);
	const roots = Object.values(agents).filter(
		(a) => !a.parent || !agents[a.parent],
	);
	const renderNode = (agent: AgentState, depth = 0): React.ReactNode => {
		const children = Array.from(
			new Set([
				...(agent.children || []),
				...(childrenByParent.get(agent.name) || []),
			]),
		).filter((name) => agents[name]);
		const hasChildren = children.length > 0;
		const isExpanded = expanded.has(agent.name);
		return (
			<div key={agent.name}>
				<button
					className="w-full py-1 text-left text-sm"
					style={{ paddingLeft: depth * 16 }}
					onClick={() =>
						hasChildren &&
						setExpanded((prev) => {
							const next = new Set(prev);
							next.has(agent.name)
								? next.delete(agent.name)
								: next.add(agent.name);
							return next;
						})
					}
				>
					{hasChildren ? (isExpanded ? "▼ " : "▶ ") : "  "}
					<strong>{agent.name}</strong>{" "}
					<span className="text-xs text-muted-foreground">
						[{agent.definition || "custom"}]
					</span>{" "}
					<Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
				</button>
				{isExpanded &&
					children.map((child) => renderNode(agents[child], depth + 1))}
			</div>
		);
	};
	return (
		<Card className="min-h-[70vh]">
			<CardHeader>
				<CardTitle>Hierarchy</CardTitle>
			</CardHeader>
			<CardContent>
				{roots.length ? (
					roots.map((root) => renderNode(root))
				) : (
					<div className="text-sm text-muted-foreground">No agents yet.</div>
				)}
			</CardContent>
		</Card>
	);
}
