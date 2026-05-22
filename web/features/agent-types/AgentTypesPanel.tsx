import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
	AgentTypeInfo,
	AgentTypeTestSession,
	ModelInfo,
} from "../../types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../components/ui/card.js";
import { Dialog } from "../../components/ui/dialog.js";
import { Input, Textarea } from "../../components/ui/input.js";
import { Select } from "../../components/ui/select.js";

type TemplateAudience = "spawned" | "orchestrator" | "all";
type TemplateAutoApply = "none" | "spawned" | "all";
export type TemplateInfo = {
	name: string;
	description: string;
	items: string[];
	audience?: TemplateAudience;
	autoApply?: TemplateAutoApply;
	applyToAll?: boolean;
	validationErrors?: string[];
	source: string;
	filePath: string;
};

function templateAudience(template: TemplateInfo): TemplateAudience {
	return template.audience || "spawned";
}

function isSpawnedTemplate(template: TemplateInfo): boolean {
	const audience = templateAudience(template);
	return audience === "spawned" || audience === "all";
}

function splitItems(text: string): string[] {
	return text
		.split(/[\n,]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function toggleItemText(text: string, item: string): string {
	const items = splitItems(text);
	const exists = items.includes(item);
	const next = exists
		? items.filter((value) => value !== item)
		: [...items, item];
	return next.join("\n");
}

async function responseErrorText(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const data = JSON.parse(text);
		return data?.error || text;
	} catch {
		return text;
	}
}

function FieldLabel({
	children,
	required,
	optional,
}: {
	children: ReactNode;
	required?: boolean;
	optional?: boolean;
}) {
	return (
		<label className="block text-xs uppercase tracking-wide text-muted-foreground">
			{children} {required && <span className="text-destructive">*</span>}
			{optional && (
				<span className="normal-case text-muted-foreground/70">(optional)</span>
			)}
		</label>
	);
}

function FormMessage({
	children,
	tone = "muted",
}: {
	children: ReactNode;
	tone?: "muted" | "error" | "success";
}) {
	const className =
		tone === "error"
			? "text-destructive"
			: tone === "success"
				? "text-emerald-400"
				: "text-muted-foreground";
	return <p className={`text-xs ${className}`}>{children}</p>;
}

function ValidationSummary({
	errors,
	serverError,
}: {
	errors: string[];
	serverError?: string;
}) {
	if (!errors.length && !serverError) return null;
	return (
		<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
			{serverError && <div>{serverError}</div>}
			{!!errors.length && (
				<ul className="list-disc pl-5">
					{errors.map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			)}
		</div>
	);
}

const spawnableAgentClasses = [
	"lead",
	"scout",
	"implementer",
	"reviewer",
] as const;

export function AgentTypesPanel({
	types,
	onNew,
	onEdit,
	onTest,
	large,
}: {
	types: AgentTypeInfo[];
	onNew: () => void;
	onEdit: (type: AgentTypeInfo) => void;
	onTest?: (type: AgentTypeInfo) => void;
	large?: boolean;
}) {
	return (
		<Card className={large ? "min-h-[70vh]" : ""}>
			<CardHeader className="border-b border-border">
				<div className="flex items-center justify-between gap-3">
					<CardTitle>Agent Types</CardTitle>
					<Button
						variant="secondary"
						className="px-2 py-1 text-xs"
						onClick={onNew}
					>
						+ New Type
					</Button>
				</div>
			</CardHeader>
			<CardContent className="pt-4">
				{!types.length ? (
					<p className="text-sm text-muted-foreground">No agent types found.</p>
				) : (
					<div className="grid gap-3 md:grid-cols-2">
						{types.map((type) => (
							<div
								key={type.name}
								className="rounded-md border border-border p-3"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="truncate text-sm font-semibold">
												{type.name}
											</span>
											{type.agentClass && (
												<Badge variant="outline">{type.agentClass}</Badge>
											)}
										</div>
										<div className="mt-1 line-clamp-3 text-xs text-muted-foreground">
											{type.description}
										</div>
									</div>
									<div className="flex shrink-0 gap-1">
										<Button
											variant="secondary"
											className="px-2 py-1 text-xs"
											onClick={() => onTest?.(type)}
										>
											Test
										</Button>
										<Button
											variant="secondary"
											className="px-2 py-1 text-xs"
											onClick={() => onEdit(type)}
										>
											Edit
										</Button>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function TemplateChips({
	templates,
	selectedText,
	emptyText,
	onToggle,
}: {
	templates: TemplateInfo[];
	selectedText: string;
	emptyText: string;
	onToggle: (name: string) => void;
}) {
	const selected = new Set(splitItems(selectedText));
	return (
		<div className="space-y-2">
			<div className="text-xs text-muted-foreground">
				Click to assign/unassign existing templates.
			</div>
			<div className="flex flex-wrap gap-1">
				{templates.length ? (
					templates.map((template) => {
						const active = selected.has(template.name);
						return (
							<button
								key={template.name}
								type="button"
								title={template.description}
								className={`rounded-full border px-2 py-1 text-xs transition ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
								onClick={() => onToggle(template.name)}
							>
								{active ? "✓ " : ""}
								{template.name}
							</button>
						);
					})
				) : (
					<span className="text-xs text-muted-foreground">{emptyText}</span>
				)}
			</div>
		</div>
	);
}

export function AgentTypeTestDialog({
	open,
	typeDef,
	onClose,
	pushLog,
}: {
	open: boolean;
	typeDef?: AgentTypeInfo;
	onClose: () => void;
	pushLog?: (text: string, level?: "info" | "success" | "error") => void;
}) {
	const [session, setSession] = useState<AgentTypeTestSession>();
	const [messages, setMessages] = useState<
		Array<{ role: "user" | "assistant" | "system"; text: string }>
	>([]);
	const [message, setMessage] = useState("Smoke test ping: reply exactly OK.");
	const [busy, setBusy] = useState(false);
	const [serverError, setServerError] = useState("");

	const stopSession = async (current = session) => {
		if (!current) return;
		try {
			await fetch(
				`/api/agent-type-test-sessions/${encodeURIComponent(current.id)}`,
				{ method: "DELETE" },
			);
		} catch {
			/* best-effort cleanup */
		}
	};

	useEffect(() => {
		if (!open || !typeDef) return;
		let cancelled = false;
		setSession(undefined);
		setMessages([]);
		setMessage("Smoke test ping: reply exactly OK.");
		setServerError("");
		setBusy(true);
		fetch(`/api/agent-types/${encodeURIComponent(typeDef.name)}/test-session`, {
			method: "POST",
		})
			.then(async (res) => {
				const data = await res.json().catch(() => ({}));
				if (!res.ok)
					throw new Error(data?.error || "Failed to start test session");
				if (cancelled) {
					if (data?.session?.id)
						await fetch(
							`/api/agent-type-test-sessions/${encodeURIComponent(data.session.id)}`,
							{ method: "DELETE" },
						).catch(() => {});
					return;
				}
				setSession(data.session);
				setMessages([
					{
						role: "system",
						text: `Started disposable test session ${data.session.id}.`,
					},
				]);
				pushLog?.(`Started test session for ${typeDef.name}`, "success");
			})
			.catch((err) => {
				if (!cancelled) setServerError(err?.message || String(err));
			})
			.finally(() => {
				if (!cancelled) setBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, typeDef?.name]);

	const close = async () => {
		await stopSession();
		setSession(undefined);
		onClose();
	};

	const send = async () => {
		if (!session || !message.trim()) return;
		const text = message.trim();
		setMessages((prev) => [...prev, { role: "user", text }]);
		setMessage("");
		setBusy(true);
		setServerError("");
		try {
			const res = await fetch(
				`/api/agent-type-test-sessions/${encodeURIComponent(session.id)}/messages`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ message: text }),
				},
			);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data?.error || "Test message failed");
			setSession(data.session || session);
			setMessages((prev) => [
				...prev,
				{ role: "assistant", text: data.response || "(empty response)" },
			]);
		} catch (err: any) {
			setServerError(err?.message || String(err));
		} finally {
			setBusy(false);
		}
	};

	const diagnostics = session?.runtimeTools;
	return (
		<Dialog
			open={open}
			title={typeDef ? `Test ${typeDef.name}` : "Test Agent Type"}
			onOpenChange={close}
			closeOnBackdrop={false}
			closeOnEscape={false}
			className="max-w-4xl"
		>
			<div className="space-y-3">
				<div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
					<div>
						Status:{" "}
						<span className="text-foreground">
							{session?.status || (busy ? "starting" : "not started")}
						</span>
					</div>
					{session?.worktree && (
						<div>
							Worktree: <code>{session.worktree}</code>
						</div>
					)}
					{diagnostics && (
						<div>
							Runtime tools: {diagnostics.active.length} active /{" "}
							{diagnostics.all.length} total
							{diagnostics.conflicts?.length
								? `, ${diagnostics.conflicts.length} conflicts`
								: ""}
						</div>
					)}
					{!!diagnostics?.active.length && (
						<div>
							Active: {diagnostics.active.map((tool) => tool.name).join(", ")}
						</div>
					)}
					{!!diagnostics?.conflicts?.length && (
						<div className="text-destructive">
							Conflicts:{" "}
							{diagnostics.conflicts
								.map(
									(conflict) =>
										`${conflict.name} (${conflict.sources.join(", ")})`,
								)
								.join("; ")}
						</div>
					)}
				</div>
				<div className="max-h-80 space-y-2 overflow-auto rounded-md border border-border bg-background p-3">
					{messages.length ? (
						messages.map((entry, index) => (
							<div key={index} className="text-sm">
								<span className="font-semibold capitalize text-muted-foreground">
									{entry.role}:{" "}
								</span>
								<span className="whitespace-pre-wrap">{entry.text}</span>
							</div>
						))
					) : (
						<div className="text-sm text-muted-foreground">
							Starting disposable session…
						</div>
					)}
				</div>
				{session?.stderrTail && (
					<pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-xs text-destructive">
						{session.stderrTail}
					</pre>
				)}
				<ValidationSummary errors={[]} serverError={serverError} />
				<div className="flex gap-2">
					<Textarea
						rows={3}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						disabled={!session || busy}
					/>
					<Button onClick={send} disabled={!session || busy || !message.trim()}>
						{busy && session ? "⏳ Sending…" : "Send"}
					</Button>
				</div>
				<div className="flex justify-end">
					<Button variant="secondary" onClick={close}>
						Close & Cleanup
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

export function TypeEditorDialog({
	open,
	typeDef,
	models,
	skillTemplates,
	extensionTemplates,
	onClose,
	onSaved,
}: {
	open: boolean;
	typeDef?: AgentTypeInfo;
	models: ModelInfo[];
	skillTemplates: TemplateInfo[];
	extensionTemplates: TemplateInfo[];
	onClose: () => void;
	onSaved: () => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [agentClass, setAgentClass] =
		useState<(typeof spawnableAgentClasses)[number]>("implementer");
	const [model, setModel] = useState("");
	const [thinking, setThinking] = useState("");
	const [skillTemplatesText, setSkillTemplatesText] = useState("");
	const [extensionTemplatesText, setExtensionTemplatesText] = useState("");
	const [prompt, setPrompt] = useState("");
	const [serverError, setServerError] = useState("");
	useEffect(() => {
		if (!open) return;
		setName(typeDef?.name || "");
		setDescription(typeDef?.description || "");
		setAgentClass(
			spawnableAgentClasses.includes(typeDef?.agentClass as any)
				? (typeDef!.agentClass as (typeof spawnableAgentClasses)[number])
				: "implementer",
		);
		setModel(typeDef?.model || "");
		setThinking(typeDef?.thinking || "medium");
		setSkillTemplatesText((typeDef?.skillTemplates || []).join("\n"));
		setExtensionTemplatesText((typeDef?.extensionTemplates || []).join("\n"));
		setPrompt("");
		setServerError("");
	}, [open, typeDef]);
	const modelPattern = (m: ModelInfo) =>
		m.pattern || (m.provider ? `${m.provider}/${m.id}` : m.id);
	const selectedModel = models.find(
		(m) => modelPattern(m) === model || m.id === model,
	);
	const levels = selectedModel?.thinkingLevels || [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
	];
	const errors = [
		!name.trim() ? "Name is required." : undefined,
		!description.trim() ? "Description is required." : undefined,
	].filter(Boolean) as string[];
	const isDirty =
		name !== (typeDef?.name || "") ||
		description !== (typeDef?.description || "") ||
		agentClass !==
			(spawnableAgentClasses.includes(typeDef?.agentClass as any)
				? typeDef!.agentClass
				: "implementer") ||
		model !== (typeDef?.model || "") ||
		thinking !== (typeDef?.thinking || "medium") ||
		skillTemplatesText !== (typeDef?.skillTemplates || []).join("\n") ||
		extensionTemplatesText !== (typeDef?.extensionTemplates || []).join("\n") ||
		!!prompt.trim();
	const discardMessage = "Discard unsaved agent type changes?";
	const close = () => {
		if (!isDirty || confirm(discardMessage)) onClose();
	};
	const save = async () => {
		setServerError("");
		if (errors.length) return;
		const payload = {
			name: name.trim(),
			description: description.trim(),
			agentClass,
			model: model || undefined,
			thinking: selectedModel?.thinking ? thinking : undefined,
			skillTemplates: splitItems(skillTemplatesText),
			extensionTemplates: splitItems(extensionTemplatesText),
			prompt: prompt.trim() || undefined,
		};
		const res = await fetch("/api/agent-types", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok)
			return setServerError(
				"Failed to save: " + (await responseErrorText(res)),
			);
		onSaved();
	};
	const spawnedSkillTemplates = skillTemplates.filter(isSpawnedTemplate);
	const spawnedExtensionTemplates =
		extensionTemplates.filter(isSpawnedTemplate);
	return (
		<Dialog
			open={open}
			title={typeDef ? `Edit ${typeDef.name}` : "New Agent Type"}
			onOpenChange={onClose}
			confirmOnClose={isDirty}
			confirmCloseMessage={discardMessage}
		>
			<div className="space-y-3">
				<FieldLabel required>Name</FieldLabel>
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					readOnly={!!typeDef}
					aria-invalid={!name.trim()}
					className={!name.trim() ? "border-destructive/60" : undefined}
				/>
				<FieldLabel required>Description</FieldLabel>
				<Input
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					aria-invalid={!description.trim()}
					className={!description.trim() ? "border-destructive/60" : undefined}
				/>
				<FieldLabel required>Agent class</FieldLabel>
				<Select
					value={agentClass}
					onChange={(e) =>
						setAgentClass(
							e.target.value as (typeof spawnableAgentClasses)[number],
						)
					}
				>
					{spawnableAgentClasses.map((value) => (
						<option key={value} value={value}>
							{value}
						</option>
					))}
				</Select>
				<FormMessage>
					Choose what kind of child agent this type can spawn as. The root
					orchestrator role is reserved for the interactive /orchestrate session
					and is not spawnable.
				</FormMessage>
				<FieldLabel optional>Model</FieldLabel>
				<Select value={model} onChange={(e) => setModel(e.target.value)}>
					<option value="">-- default --</option>
					{models.map((m) => {
						const pattern = modelPattern(m);
						return (
							<option key={pattern} value={pattern}>
								{pattern}
							</option>
						);
					})}
				</Select>
				{selectedModel?.thinking && (
					<>
						<FieldLabel optional>Thinking Level</FieldLabel>
						<Select
							value={thinking}
							onChange={(e) => setThinking(e.target.value)}
						>
							{levels.map((level) => (
								<option key={level} value={level}>
									{level}
								</option>
							))}
						</Select>
					</>
				)}
				<FieldLabel optional>Skill Templates</FieldLabel>
				<Textarea
					rows={3}
					value={skillTemplatesText}
					onChange={(e) => setSkillTemplatesText(e.target.value)}
					placeholder={
						spawnedSkillTemplates.map((template) => template.name).join(", ") ||
						"common, frontend"
					}
				/>
				<TemplateChips
					templates={spawnedSkillTemplates}
					selectedText={skillTemplatesText}
					emptyText="No spawned-agent skill templates defined yet."
					onToggle={(name) =>
						setSkillTemplatesText((prev) => toggleItemText(prev, name))
					}
				/>
				<FieldLabel optional>Extension Templates</FieldLabel>
				<Textarea
					rows={3}
					value={extensionTemplatesText}
					onChange={(e) => setExtensionTemplatesText(e.target.value)}
					placeholder={
						spawnedExtensionTemplates
							.map((template) => template.name)
							.join(", ") || "browser-tools"
					}
				/>
				<TemplateChips
					templates={spawnedExtensionTemplates}
					selectedText={extensionTemplatesText}
					emptyText="No extension templates defined yet."
					onToggle={(name) =>
						setExtensionTemplatesText((prev) => toggleItemText(prev, name))
					}
				/>
				<FieldLabel optional>Prompt / Instructions</FieldLabel>
				<Textarea
					rows={7}
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
				/>
				<ValidationSummary errors={errors} serverError={serverError} />
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={close}>
						Cancel
					</Button>
					<Button onClick={save} disabled={!!errors.length}>
						Save Type
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
