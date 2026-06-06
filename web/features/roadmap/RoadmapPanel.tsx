import { useEffect, useMemo, useState } from "react";
import type { RoadmapDependency, RoadmapOverview } from "../../types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../components/ui/card.js";
import { Dialog } from "../../components/ui/dialog.js";
import {
	buildRoadmapEpicBoard,
	buildRoadmapHierarchy,
	sortIssueViews,
	splitEpicGroups,
	type RoadmapEpicBoard,
	type RoadmapEpicBoardCard,
	type RoadmapEpicGroup,
	type RoadmapHierarchy,
	type RoadmapIssueView,
} from "./roadmap-view-model.js";

type EditableRoadmapStatus = "open" | "in_progress" | "closed";

interface RoadmapPanelProps {
	pushLog?: (
		text: string,
		level?: "info" | "success" | "warn" | "error",
	) => void;
}

export function RoadmapPanel({ pushLog }: RoadmapPanelProps) {
	const [overview, setOverview] = useState<RoadmapOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
	const [detailBackIssueId, setDetailBackIssueId] = useState<string | null>(
		null,
	);

	const refresh = async () => {
		setLoading(true);
		setError("");
		try {
			const res = await fetch("/api/roadmap");
			if (!res.ok) throw new Error(await res.text());
			setOverview(await res.json());
		} catch (err: any) {
			const message = err?.message || "Failed to load roadmap";
			setError(message);
			pushLog?.(`Failed to load roadmap: ${message}`, "error");
		} finally {
			setLoading(false);
		}
	};

	const updateIssuePatch = async (
		issueId: string,
		patch: { status?: EditableRoadmapStatus; description?: string },
	) => {
		const res = await fetch(
			`/api/roadmap/issues/${encodeURIComponent(issueId)}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch),
			},
		);
		if (!res.ok) throw new Error(await res.text());
		const nextOverview = (await res.json()) as RoadmapOverview;
		setOverview(nextOverview);
	};

	const updateIssueStatus = async (
		issueId: string,
		status: EditableRoadmapStatus,
	) => {
		await updateIssuePatch(issueId, { status });
		pushLog?.(
			`Updated Roadmap issue ${issueId} status to ${formatStatus(status)}`,
			"success",
		);
	};

	const updateIssueDescription = async (
		issueId: string,
		description: string,
	) => {
		await updateIssuePatch(issueId, { description });
		pushLog?.(`Updated Roadmap issue ${issueId} description`, "success");
	};

	useEffect(() => {
		refresh();
	}, []);

	const roadmapIssues = useMemo(
		() => (overview ? flattenHierarchy(buildRoadmapHierarchy(overview)) : []),
		[overview],
	);
	const selectedIssue = useMemo(
		() => roadmapIssues.find((issue) => issue.id === selectedIssueId),
		[roadmapIssues, selectedIssueId],
	);
	const detailBackIssue = useMemo(
		() => roadmapIssues.find((issue) => issue.id === detailBackIssueId),
		[roadmapIssues, detailBackIssueId],
	);
	const selectIssue = (id: string, backIssueId?: string) => {
		setSelectedIssueId(id);
		setDetailBackIssueId(backIssueId || null);
	};
	const closeIssue = () => {
		setSelectedIssueId(null);
		setDetailBackIssueId(null);
	};
	const backToIssue = () => {
		if (!detailBackIssueId) return;
		setSelectedIssueId(detailBackIssueId);
		setDetailBackIssueId(null);
	};

	return (
		<Card className="min-h-[70vh]">
			<CardHeader className="border-b border-border">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<CardTitle>Project Roadmap</CardTitle>
						<p className="mt-1 text-sm text-muted-foreground">
							Epic-first view of active project work. Open an issue to update
							its status.
						</p>
					</div>
					<Button
						variant="secondary"
						className="px-2 py-1 text-xs"
						onClick={refresh}
						disabled={loading}
					>
						Refresh
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4 pt-4">
				{loading && (
					<div className="rounded-md border border-border bg-card/50 p-4 text-sm text-muted-foreground">
						Loading roadmap…
					</div>
				)}
				{!loading && error && (
					<div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
						{error}
					</div>
				)}
				{!loading && !error && overview && (
					<RoadmapSummary
						overview={overview}
						onSelectIssue={selectIssue}
						pushLog={pushLog}
					/>
				)}
			</CardContent>
			{overview && (
				<IssueDetailDialog
					overview={overview}
					issue={selectedIssue}
					backIssue={detailBackIssue}
					onBack={backToIssue}
					onClose={closeIssue}
					onSelectIssue={selectIssue}
					onUpdateStatus={updateIssueStatus}
					pushLog={pushLog}
					onUpdateDescription={updateIssueDescription}
				/>
			)}
		</Card>
	);
}

// RoadmapPanel stays source-agnostic: it renders and mutates RoadmapOverview through
// /api/roadmap. Provider-specific details belong on the server side so the backing
// store can change without renaming this feature.
function RoadmapSummary({
	overview,
	onSelectIssue,
	pushLog,
}: {
	overview: RoadmapOverview;
	onSelectIssue: (id: string) => void;
	pushLog?: RoadmapPanelProps["pushLog"];
}) {
	const hierarchy = useMemo(() => buildRoadmapHierarchy(overview), [overview]);
	const focusEpic = useMemo(() => findFocusEpic(hierarchy), [hierarchy]);
	const [expandedEpicIds, setExpandedEpicIds] = useState<Set<string>>(
		new Set(),
	);

	useEffect(() => {
		setExpandedEpicIds(focusEpic ? new Set([focusEpic.epic.id]) : new Set());
	}, [focusEpic?.epic.id]);

	const toggleEpic = (id: string) => {
		setExpandedEpicIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<Badge variant="outline">{overview.counts.total} total</Badge>
				<Badge variant="default">
					{overview.counts.inProgress} in progress
				</Badge>
				<Badge variant="success">{overview.counts.nextUp} ready</Badge>
				<Badge variant="destructive">{overview.counts.blocked} blocked</Badge>
				<Badge variant="outline">{overview.counts.closed} closed</Badge>
				<span className="truncate">
					Source: {overview.source.exists ? "loaded" : "missing"} ·{" "}
					{overview.source.path}
				</span>
			</div>
			{focusEpic && (
				<FocusEpic
					group={focusEpic}
					onSelectIssue={onSelectIssue}
					onExpand={() => setExpandedEpicIds(new Set([focusEpic.epic.id]))}
					pushLog={pushLog}
				/>
			)}
			<RoadmapHierarchyView
				hierarchy={hierarchy}
				overview={overview}
				expandedEpicIds={expandedEpicIds}
				onToggleEpic={toggleEpic}
				onSelectIssue={onSelectIssue}
				pushLog={pushLog}
			/>
		</div>
	);
}

function FocusEpic({
	group,
	onSelectIssue,
	onExpand,
	pushLog,
}: {
	group: RoadmapEpicGroup;
	onSelectIssue: (id: string) => void;
	onExpand: () => void;
	pushLog?: RoadmapPanelProps["pushLog"];
}) {
	const activeCount = group.activeChildren.length;
	return (
		<div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-xs font-semibold uppercase tracking-wide text-primary">
						Focus epic
					</div>
					<button
						type="button"
						className="mt-1 text-left text-base font-semibold hover:text-primary"
						onClick={() => onSelectIssue(group.epic.id)}
					>
						{group.epic.title}
					</button>
					<div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
						<span>{group.epic.id}</span>
						<CopyIssueIdButton issueId={group.epic.id} pushLog={pushLog} />
						<Badge variant={statusBadgeVariant(group.epic.status)}>
							{formatStatus(group.epic.status)}
						</Badge>
						<Badge variant="outline">{activeCount} active children</Badge>
						<Badge variant="outline">
							updated {formatDate(group.epic.updatedAt) || "unknown"}
						</Badge>
					</div>
				</div>
				<Button
					variant="secondary"
					className="px-2 py-1 text-xs"
					onClick={onExpand}
				>
					Follow epic
				</Button>
			</div>
		</div>
	);
}

function RoadmapHierarchyView({
	hierarchy,
	overview,
	expandedEpicIds,
	onToggleEpic,
	onSelectIssue,
	pushLog,
}: {
	hierarchy: RoadmapHierarchy;
	overview: RoadmapOverview;
	expandedEpicIds: Set<string>;
	onToggleEpic: (id: string) => void;
	onSelectIssue: (id: string, backIssueId?: string) => void;
	pushLog?: RoadmapPanelProps["pushLog"];
}) {
	const { active, closed } = splitEpicGroups(hierarchy);
	return (
		<div className="space-y-3 rounded-md border border-border p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="text-sm font-semibold">Epic Roadmap</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						Focus epic opens automatically; other active epics stay collapsed
						until needed.
					</p>
				</div>
				<div className="flex flex-wrap gap-1">
					<Badge variant="outline">{active.length} active epics</Badge>
					<Badge variant="outline">{closed.length} closed</Badge>
				</div>
			</div>
			{active.length ? (
				<div className="space-y-2">
					{active.map((group) => (
						<EpicRow
							key={group.epic.id}
							group={group}
							overview={overview}
							expanded={expandedEpicIds.has(group.epic.id)}
							onToggleEpic={onToggleEpic}
							onSelectIssue={onSelectIssue}
							pushLog={pushLog}
						/>
					))}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					No active epics found in the roadmap source.
				</p>
			)}
			{!!closed.length && (
				<details className="border-t border-border pt-3">
					<summary className="cursor-pointer text-sm font-semibold">
						Closed epics <Badge variant="outline">{closed.length}</Badge>
					</summary>
					<div className="mt-2 space-y-2 opacity-75">
						{closed.map((group) => (
							<EpicRow
								key={group.epic.id}
								group={group}
								overview={overview}
								expanded={expandedEpicIds.has(group.epic.id)}
								onToggleEpic={onToggleEpic}
								onSelectIssue={onSelectIssue}
								pushLog={pushLog}
							/>
						))}
					</div>
				</details>
			)}
			<UngroupedIssues
				issues={hierarchy.ungrouped}
				onSelectIssue={onSelectIssue}
				pushLog={pushLog}
			/>
		</div>
	);
}

function EpicRow({
	group,
	overview,
	expanded,
	onToggleEpic,
	onSelectIssue,
	pushLog,
}: {
	group: RoadmapEpicGroup;
	overview: RoadmapOverview;
	expanded: boolean;
	onToggleEpic: (id: string) => void;
	onSelectIssue: (id: string, backIssueId?: string) => void;
	pushLog?: RoadmapPanelProps["pushLog"];
}) {
	const epicBoard = useMemo(
		() => buildRoadmapEpicBoard(group, overview),
		[group, overview],
	);
	const blockedCount = group.activeChildren.filter(
		(issue) => issue.unresolvedBlockers.length,
	).length;
	return (
		<div className="rounded-lg border border-border bg-background/40">
			<div className="flex flex-wrap items-center gap-3 p-3">
				<Button
					variant="secondary"
					className="px-2 py-1 text-xs"
					onClick={() => onToggleEpic(group.epic.id)}
				>
					{expanded ? "Collapse" : "Expand"}
				</Button>
				<div
					role="button"
					tabIndex={0}
					className="min-w-0 flex-1 cursor-pointer text-left"
					onClick={() => onSelectIssue(group.epic.id)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						onSelectIssue(group.epic.id);
					}}
				>
					<div className="truncate text-sm font-semibold hover:text-primary">
						{group.epic.title}
					</div>
					<div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
						<span>{group.epic.id}</span>
						<CopyIssueIdButton issueId={group.epic.id} pushLog={pushLog} />
						<Badge variant={statusBadgeVariant(group.epic.status)}>
							{formatStatus(group.epic.status)}
						</Badge>
						<Badge variant="outline">
							{group.activeChildren.length} active
						</Badge>
						<Badge variant="outline">
							{group.closedChildren.length} closed
						</Badge>
						{!!blockedCount && (
							<Badge variant="destructive">{blockedCount} blocked</Badge>
						)}
					</div>
				</div>
			</div>
			{expanded && (
				<div className="border-t border-border p-3">
					<EpicKanbanBoard
						board={epicBoard}
						onSelectIssue={(id) => onSelectIssue(id, group.epic.id)}
						pushLog={pushLog}
						compact
					/>
				</div>
			)}
		</div>
	);
}

function UngroupedIssues({
	issues,
	onSelectIssue,
	pushLog,
}: {
	issues: RoadmapIssueView[];
	onSelectIssue: (id: string) => void;
	pushLog?: RoadmapPanelProps["pushLog"];
}) {
	const active = sortIssueViews(
		issues.filter((issue) => issue.status !== "closed"),
	);
	const closed = sortIssueViews(
		issues.filter((issue) => issue.status === "closed"),
	);
	const total = active.length + closed.length;
	return (
		<details
			className="border-t border-border pt-3"
			open={total > 0 && active.length <= 3}
		>
			<summary className="cursor-pointer text-sm font-semibold">
				Ungrouped <Badge variant="outline">{total}</Badge>
			</summary>
			<div className="mt-2 space-y-2">
				{active.length ? (
					<div className="grid gap-2 md:grid-cols-2">
						{active.map((issue) => (
							<IssueCard
								key={issue.id}
								issue={issue}
								onSelectIssue={onSelectIssue}
								pushLog={pushLog}
							/>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						No ungrouped active issues.
					</p>
				)}
				{!!closed.length && (
					<div className="grid gap-2 opacity-70 md:grid-cols-2">
						{closed.map((issue) => (
							<IssueCard
								key={issue.id}
								issue={issue}
								compact
								onSelectIssue={onSelectIssue}
								pushLog={pushLog}
							/>
						))}
					</div>
				)}
			</div>
		</details>
	);
}

function IssueCard({
	issue,
	compact,
	onSelectIssue,
	pushLog,
}: {
	issue: RoadmapIssueView;
	compact?: boolean;
	onSelectIssue: (id: string) => void;
	pushLog?: RoadmapPanelProps["pushLog"];
}) {
	const blockerText = issue.unresolvedBlockers.map(formatDependency).join(", ");
	return (
		<div
			role="button"
			tabIndex={0}
			className={`block w-full cursor-pointer rounded border border-border/70 bg-card/40 text-left transition hover:border-primary/60 ${compact ? "p-2" : "p-3"} ${issue.status === "closed" ? "opacity-70" : ""}`}
			onClick={() => onSelectIssue(issue.id)}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				onSelectIssue(issue.id);
			}}
		>
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span>{issue.id}</span>
				<CopyIssueIdButton issueId={issue.id} pushLog={pushLog} />
				<Badge variant={statusBadgeVariant(issue.status)}>
					{formatStatus(issue.status)}
				</Badge>
				<Badge variant="outline">P{issue.priority}</Badge>
				{!!issue.dependentCount && (
					<Badge variant="default">blocks {issue.dependentCount}</Badge>
				)}
			</div>
			<div
				className={`${compact ? "mt-1 text-sm" : "mt-2 text-sm"} font-medium`}
			>
				{issue.title}
			</div>
			{!!issue.unresolvedBlockers.length && (
				<div className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
					Blocked by {blockerText}
				</div>
			)}
		</div>
	);
}

function IssueDetailDialog({
	overview,
	issue,
	backIssue,
	onBack,
	onClose,
	onSelectIssue,
	onUpdateStatus,
	onUpdateDescription,
	pushLog,
}: {
	overview: RoadmapOverview;
	issue?: RoadmapIssueView;
	backIssue?: RoadmapIssueView;
	onBack: () => void;
	onClose: () => void;
	onSelectIssue: (id: string, backIssueId?: string) => void;
	onUpdateStatus: (id: string, status: EditableRoadmapStatus) => Promise<void>;
	onUpdateDescription: (id: string, description: string) => Promise<void>;
	pushLog?: (
		text: string,
		level?: "info" | "success" | "warn" | "error",
	) => void;
}) {
	const [draftStatus, setDraftStatus] = useState<EditableRoadmapStatus>("open");
	const [statusSaving, setStatusSaving] = useState(false);
	const [statusError, setStatusError] = useState("");
	const [statusMessage, setStatusMessage] = useState("");
	const [startWorkIssueId, setStartWorkIssueId] = useState<string | null>(null);
	const [descriptionEditing, setDescriptionEditing] = useState(false);
	const [draftDescription, setDraftDescription] = useState("");
	const [descriptionSaving, setDescriptionSaving] = useState(false);
	const [descriptionError, setDescriptionError] = useState("");
	const [descriptionMessage, setDescriptionMessage] = useState("");
	const blockers = issue ? overview.dependencyMap.blockers[issue.id] || [] : [];
	const dependents = issue
		? overview.dependencyMap.dependents[issue.id] || []
		: [];
	const epicGroup = useMemo(() => {
		if (!issue || issue.type !== "epic") return undefined;
		return buildRoadmapHierarchy(overview).epics.find(
			(group) => group.epic.id === issue.id,
		);
	}, [overview, issue?.id, issue?.type]);
	const epicBoard = epicGroup
		? buildRoadmapEpicBoard(epicGroup, overview)
		: undefined;
	const isEpic = issue?.type === "epic";
	const returnEpicId = backIssue?.id || (isEpic ? issue?.id : undefined);

	useEffect(() => {
		if (!issue) return;
		setDraftStatus(toEditableStatus(issue.status));
	}, [issue?.id, issue?.status]);

	useEffect(() => {
		if (!issue) return;
		setDraftDescription(issue.description || "");
		setDescriptionEditing(false);
	}, [issue?.id, issue?.description]);

	useEffect(() => {
		setStatusError("");
		setStatusMessage("");
		setDescriptionError("");
		setDescriptionMessage("");
	}, [issue?.id]);

	const descriptionDirty =
		!!issue && draftDescription !== (issue.description || "");

	const saveStatus = async () => {
		if (!issue || draftStatus === issue.status) return;
		setStatusSaving(true);
		setStatusError("");
		setStatusMessage("");
		try {
			await onUpdateStatus(issue.id, draftStatus);
			setStatusMessage(`Status updated to ${formatStatus(draftStatus)}`);
		} catch (err: any) {
			const message = err?.message || "Failed to update status";
			setDraftStatus(toEditableStatus(issue.status));
			setStatusError(`Failed to update status: ${message}`);
			pushLog?.(
				`Failed to update Roadmap issue ${issue.id}: ${message}`,
				"error",
			);
		} finally {
			setStatusSaving(false);
		}
	};

	const startWork = async (targetIssue: RoadmapIssueView) => {
		if (!canStartWork(targetIssue)) return;
		setStartWorkIssueId(targetIssue.id);
		setStatusError("");
		setStatusMessage("");
		try {
			await onUpdateStatus(targetIssue.id, "in_progress");
			setStatusMessage("Status updated to in progress");
		} catch (err: any) {
			const message = err?.message || "Failed to start work";
			setStatusError(`Failed to start work: ${message}`);
			pushLog?.(
				`Failed to start work on Roadmap issue ${targetIssue.id}: ${message}`,
				"error",
			);
		} finally {
			setStartWorkIssueId(null);
		}
	};

	const startDescriptionEdit = () => {
		if (!issue) return;
		setDraftDescription(issue.description || "");
		setDescriptionEditing(true);
		setDescriptionError("");
		setDescriptionMessage("");
	};

	const cancelDescriptionEdit = () => {
		setDraftDescription(issue?.description || "");
		setDescriptionEditing(false);
		setDescriptionError("");
	};

	const saveDescription = async () => {
		if (!issue) return;
		setDescriptionSaving(true);
		setDescriptionError("");
		setDescriptionMessage("");
		try {
			await onUpdateDescription(issue.id, draftDescription);
			setDescriptionEditing(false);
			setDescriptionMessage("Description updated");
		} catch (err: any) {
			const message = err?.message || "Failed to update description";
			setDescriptionError(`Failed to update description: ${message}`);
			pushLog?.(
				`Failed to update Roadmap issue ${issue.id} description: ${message}`,
				"error",
			);
		} finally {
			setDescriptionSaving(false);
		}
	};

	return (
		<Dialog
			open={!!issue}
			title={issue ? detailTitle(issue.type) : "Issue Details"}
			onOpenChange={onClose}
			className={isEpic ? "max-w-6xl" : "max-w-4xl"}
			confirmOnClose={descriptionDirty}
			confirmCloseMessage="Discard unsaved description changes?"
		>
			{issue && (
				<div className="space-y-4">
					<div>
						{backIssue && (
							<button
								type="button"
								aria-label="Back to epic"
								title="Back to epic"
								className="mb-3 text-2xl leading-none text-muted-foreground transition hover:text-primary"
								onClick={onBack}
							>
								←
							</button>
						)}
						<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span>{issue.id}</span>
							<CopyIssueIdButton issueId={issue.id} pushLog={pushLog} />
							<Badge variant={statusBadgeVariant(issue.status)}>
								{formatStatus(issue.status)}
							</Badge>
							<Badge variant="outline">P{issue.priority}</Badge>
							<Badge variant="outline">{issue.type}</Badge>
						</div>
						<div className="mt-2 flex flex-wrap items-start justify-between gap-3">
							<h3 className="text-xl font-semibold">{issue.title}</h3>
							{canStartWork(issue) && (
								<Button
									type="button"
									variant="default"
									className="px-2 py-1 text-xs"
									disabled={startWorkIssueId === issue.id}
									onClick={() => startWork(issue)}
								>
									{startWorkIssueId === issue.id ? "Starting…" : "Start work"}
								</Button>
							)}
						</div>
					</div>
					<div className="rounded border border-border bg-card/40 p-3">
						<div className="flex flex-wrap items-end gap-2">
							<label className="text-sm font-semibold">
								Status
								<select
									aria-label="Issue status"
									className="mt-1 block rounded border border-border bg-background px-2 py-1 text-sm font-normal"
									value={draftStatus}
									disabled={statusSaving}
									onChange={(event) => {
										setDraftStatus(event.target.value as EditableRoadmapStatus);
										setStatusError("");
										setStatusMessage("");
									}}
								>
									<option value="open">Open</option>
									<option value="in_progress">In progress</option>
									<option value="closed">Closed</option>
								</select>
							</label>
							<Button
								type="button"
								variant="secondary"
								className="px-2 py-1 text-xs"
								disabled={statusSaving || draftStatus === issue.status}
								onClick={saveStatus}
							>
								{statusSaving ? "Saving…" : "Save status"}
							</Button>
						</div>
						{statusMessage && (
							<p className="mt-2 text-sm text-primary">{statusMessage}</p>
						)}
						{statusError && (
							<p className="mt-2 text-sm text-destructive">{statusError}</p>
						)}
					</div>
					<div
						className={
							isEpic
								? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]"
								: "space-y-4"
						}
					>
						<div className="space-y-4">
							<div className="grid gap-3 md:grid-cols-2">
								<Meta label="Created" value={formatDate(issue.createdAt)} />
								<Meta label="Updated" value={formatDate(issue.updatedAt)} />
								{issue.closedAt && (
									<Meta label="Closed" value={formatDate(issue.closedAt)} />
								)}
								{issue.closeReason && (
									<Meta label="Close reason" value={issue.closeReason} />
								)}
							</div>
							{!!issue.labels.length && (
								<div>
									<h4 className="mb-2 text-sm font-semibold">Labels</h4>
									<div className="flex flex-wrap gap-1">
										{issue.labels.map((label) => (
											<Badge key={label} variant="outline">
												{label}
											</Badge>
										))}
									</div>
								</div>
							)}
							<div>
								<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
									<h4 className="text-sm font-semibold">Description</h4>
									{descriptionEditing ? (
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												variant="secondary"
												className="px-2 py-1 text-xs"
												disabled={descriptionSaving || !descriptionDirty}
												onClick={saveDescription}
											>
												{descriptionSaving ? "Saving…" : "Save description"}
											</Button>
											<Button
												type="button"
												variant="ghost"
												className="px-2 py-1 text-xs"
												disabled={descriptionSaving}
												onClick={cancelDescriptionEdit}
											>
												Cancel
											</Button>
										</div>
									) : (
										<Button
											type="button"
											variant="secondary"
											className="px-2 py-1 text-xs"
											onClick={startDescriptionEdit}
										>
											Edit description
										</Button>
									)}
								</div>
								{descriptionEditing ? (
									<textarea
										aria-label="Issue description"
										className="min-h-48 w-full rounded border border-border bg-background/50 p-3 text-sm text-muted-foreground"
										value={draftDescription}
										disabled={descriptionSaving}
										onInput={(event) => {
											setDraftDescription(event.currentTarget.value);
											setDescriptionError("");
											setDescriptionMessage("");
										}}
									/>
								) : (
									<div className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/50 p-3 text-sm text-muted-foreground">
										{issue.description || "No description."}
									</div>
								)}
								{descriptionMessage && (
									<p className="mt-2 text-sm text-primary">
										{descriptionMessage}
									</p>
								)}
								{descriptionError && (
									<p className="mt-2 text-sm text-destructive">
										{descriptionError}
									</p>
								)}
							</div>
							<DependencyList
								title="Blockers"
								dependencies={blockers}
								backIssueId={returnEpicId}
								onSelectIssue={onSelectIssue}
								onClose={onClose}
								pushLog={pushLog}
							/>
							<DependencyList
								title="Dependents"
								dependencies={dependents}
								backIssueId={returnEpicId}
								onSelectIssue={onSelectIssue}
								onClose={onClose}
								pushLog={pushLog}
							/>
						</div>
						{isEpic && epicBoard && (
							<EpicKanbanBoard
								board={epicBoard}
								onSelectIssue={(id) => onSelectIssue(id, issue.id)}
								pushLog={pushLog}
							/>
						)}
					</div>
				</div>
			)}
		</Dialog>
	);
}

function EpicKanbanBoard({
	board,
	onSelectIssue,
	pushLog,
	compact,
}: {
	board: RoadmapEpicBoard;
	onSelectIssue: (id: string) => void;
	pushLog?: RoadmapPanelProps["pushLog"];
	compact?: boolean;
}) {
	const activeCount = board.columns
		.filter((column) => column.id !== "done")
		.reduce((sum, column) => sum + column.cards.length, 0);
	const doneCount =
		board.columns.find((column) => column.id === "done")?.cards.length || 0;

	return (
		<div
			className={`rounded-lg border border-border bg-card/30 ${compact ? "p-2" : "p-3"}`}
			aria-label="Epic Kanban board"
		>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h4 className="text-sm font-semibold">Epic board</h4>
					<p className="mt-1 text-xs text-muted-foreground">
						Read-only planning view. Select a card to inspect details.
					</p>
				</div>
				<div className="flex flex-wrap gap-1">
					<Badge variant="outline">{activeCount} active</Badge>
					<Badge variant="outline">{doneCount} done</Badge>
					<Badge variant="outline">{board.memberCount} members</Badge>
				</div>
			</div>
			{board.memberCount ? (
				<>
					<div
						className={`flex gap-3 overflow-x-auto pb-1 ${compact ? "max-h-[28rem]" : "max-h-[34rem]"}`}
					>
						{board.columns.map((column) => (
							<EpicKanbanColumn
								key={column.id}
								column={column}
								onSelectIssue={onSelectIssue}
								pushLog={pushLog}
								compact={compact}
							/>
						))}
					</div>
					<EpicDependencySummary
						board={board}
						onSelectIssue={onSelectIssue}
						compact={compact}
					/>
				</>
			) : (
				<p className="text-sm text-muted-foreground">
					No tasks are currently associated with this epic.
				</p>
			)}
		</div>
	);
}

function EpicKanbanColumn({
	column,
	onSelectIssue,
	pushLog,
	compact,
}: {
	column: RoadmapEpicBoard["columns"][number];
	onSelectIssue: (id: string) => void;
	pushLog?: RoadmapPanelProps["pushLog"];
	compact?: boolean;
}) {
	return (
		<section
			aria-label={`${column.title} column`}
			className={`flex min-w-[12.5rem] shrink-0 flex-col rounded border border-border/70 bg-background/30 ${compact ? "w-48" : "w-56"}`}
		>
			<div className="border-b border-border/70 px-2 py-2">
				<div className="flex items-center gap-2">
					<h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{column.title}
					</h5>
					<Badge variant="outline">{column.cards.length}</Badge>
				</div>
			</div>
			<div className="flex-1 space-y-2 overflow-y-auto p-2">
				{column.cards.length ? (
					column.cards.map((card) => (
						<EpicBoardCard
							key={card.issue.id}
							card={card}
							onSelectIssue={onSelectIssue}
							pushLog={pushLog}
							compact={compact}
						/>
					))
				) : (
					<p className="rounded border border-border/60 bg-background/20 p-2 text-[0.7rem] leading-snug text-muted-foreground">
						{column.description}
					</p>
				)}
			</div>
		</section>
	);
}

function EpicBoardCard({
	card,
	onSelectIssue,
	pushLog,
	compact,
}: {
	card: RoadmapEpicBoardCard;
	onSelectIssue: (id: string) => void;
	pushLog?: RoadmapPanelProps["pushLog"];
	compact?: boolean;
}) {
	const {
		issue,
		metadata,
		ready,
		dependents,
		externalUnresolvedBlockers,
		externalDependents,
	} = card;
	const blockerText = issue.unresolvedBlockers.map(formatDependency).join(", ");
	const dependentText = dependents.map(formatDependency).join(", ");
	return (
		<div
			role="button"
			tabIndex={0}
			className={`block w-full cursor-pointer rounded border border-border/70 bg-card/50 text-left transition hover:border-primary/60 ${compact ? "p-2" : "p-2.5"} ${issue.status === "closed" ? "opacity-70" : ""} ${metadata.currentFocus ? "border-primary/50 bg-primary/5" : ""}`}
			onClick={() => onSelectIssue(issue.id)}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				onSelectIssue(issue.id);
			}}
		>
			<div className="flex flex-wrap items-center gap-1 text-[0.65rem] text-muted-foreground">
				<span>{issue.id}</span>
				<CopyIssueIdButton issueId={issue.id} pushLog={pushLog} />
				<Badge variant={statusBadgeVariant(issue.status)}>
					{formatStatus(issue.status)}
				</Badge>
				<Badge variant="outline">P{issue.priority}</Badge>
				{metadata.currentFocus && <Badge variant="default">Focus</Badge>}
				{metadata.manualOrder !== undefined && (
					<Badge variant="outline">Order {metadata.manualOrder}</Badge>
				)}
				{ready && <Badge variant="success">Ready</Badge>}
				{!!issue.dependentCount && (
					<Badge variant="outline">blocks {issue.dependentCount}</Badge>
				)}
			</div>
			<div
				className={`${compact ? "mt-1 text-xs" : "mt-1.5 text-sm"} font-medium leading-snug`}
			>
				{issue.title}
			</div>
			{!!issue.unresolvedBlockers.length && (
				<div className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-1.5 text-[0.65rem] text-destructive">
					Blocked by {blockerText}
					{!!externalUnresolvedBlockers.length && " (outside epic)"}
				</div>
			)}
			{!!dependents.length && (
				<div className="mt-2 rounded border border-border/70 bg-background/30 p-1.5 text-[0.65rem] text-muted-foreground">
					Blocks {dependentText}
					{!!externalDependents.length && " (outside epic)"}
				</div>
			)}
		</div>
	);
}

function EpicDependencySummary({
	board,
	onSelectIssue,
	compact,
}: {
	board: RoadmapEpicBoard;
	onSelectIssue: (id: string) => void;
	compact?: boolean;
}) {
	const cards = board.columns.flatMap((column) => column.cards);
	const cardsWithDependencies = cards.filter(
		(card) => card.issue.unresolvedBlockers.length || card.dependents.length,
	);
	if (!cardsWithDependencies.length) return null;

	return (
		<div
			className="mt-3 rounded border border-border/70 bg-background/30 p-2"
			aria-label="Epic dependency map"
		>
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Dependency map
					</h5>
					<p className="mt-1 text-[0.7rem] text-muted-foreground">
						Read-only blocker/dependent relationships for cards in this epic.
					</p>
				</div>
				<Badge variant="outline">{cardsWithDependencies.length} linked</Badge>
			</div>
			<div className={`grid gap-2 ${compact ? "" : "md:grid-cols-2"}`}>
				{cardsWithDependencies.map((card) => (
					<EpicDependencySummaryItem
						key={card.issue.id}
						card={card}
						onSelectIssue={onSelectIssue}
					/>
				))}
			</div>
		</div>
	);
}

function EpicDependencySummaryItem({
	card,
	onSelectIssue,
}: {
	card: RoadmapEpicBoardCard;
	onSelectIssue: (id: string) => void;
}) {
	return (
		<div className="rounded border border-border/60 bg-card/30 p-2 text-xs">
			<div className="mb-1 flex flex-wrap items-center gap-2 font-medium">
				<span>{card.issue.title}</span>
				<Badge variant={statusBadgeVariant(card.issue.status)}>
					{formatStatus(card.issue.status)}
				</Badge>
			</div>
			{card.issue.unresolvedBlockers.length ? (
				<DependencySummaryLine
					label="Blocked by"
					dependencies={card.issue.unresolvedBlockers}
					externalDependencies={card.externalUnresolvedBlockers}
					onSelectIssue={onSelectIssue}
				/>
			) : null}
			{card.dependents.length ? (
				<DependencySummaryLine
					label="Blocks"
					dependencies={card.dependents}
					externalDependencies={card.externalDependents}
					onSelectIssue={onSelectIssue}
				/>
			) : null}
		</div>
	);
}

function DependencySummaryLine({
	label,
	dependencies,
	externalDependencies,
	onSelectIssue,
}: {
	label: string;
	dependencies: RoadmapDependency[];
	externalDependencies: RoadmapDependency[];
	onSelectIssue: (id: string) => void;
}) {
	const externalIds = new Set(
		externalDependencies.map((dependency) => dependency.id),
	);
	return (
		<div className="mt-1 flex flex-wrap items-center gap-1 text-muted-foreground">
			<span>{label}</span>
			{dependencies.map((dependency) => (
				<button
					key={`${label}-${dependency.id}`}
					type="button"
					className="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-left hover:border-primary/60 hover:text-primary"
					onClick={() => onSelectIssue(dependency.id)}
				>
					<span>{dependency.title || dependency.id}</span>
					{externalIds.has(dependency.id) && (
						<Badge variant="outline">outside epic</Badge>
					)}
				</button>
			))}
		</div>
	);
}

function DependencyList({
	title,
	dependencies,
	backIssueId,
	onSelectIssue,
	onClose,
	pushLog,
}: {
	title: string;
	dependencies: RoadmapDependency[];
	backIssueId?: string;
	onSelectIssue: (id: string, backIssueId?: string) => void;
	onClose: () => void;
	pushLog?: RoadmapPanelProps["pushLog"];
}) {
	return (
		<div>
			<h4 className="mb-2 text-sm font-semibold">{title}</h4>
			{dependencies.length ? (
				<div className="space-y-2">
					{dependencies.map((dependency) => (
						<div
							key={dependency.id}
							role="button"
							tabIndex={0}
							className="block w-full cursor-pointer rounded border border-border bg-card/40 p-2 text-left text-sm hover:border-primary/60"
							onClick={() => {
								onSelectIssue(dependency.id, backIssueId);
								if (dependency.status === "unknown") onClose();
							}}
							onKeyDown={(event) => {
								if (event.key !== "Enter" && event.key !== " ") return;
								event.preventDefault();
								onSelectIssue(dependency.id, backIssueId);
								if (dependency.status === "unknown") onClose();
							}}
						>
							<div className="flex flex-wrap items-center gap-2">
								<span>{dependency.title || dependency.id}</span>
								<Badge variant={statusBadgeVariant(dependency.status)}>
									{formatStatus(dependency.status)}
								</Badge>
								{dependency.priority !== undefined && (
									<Badge variant="outline">P{dependency.priority}</Badge>
								)}
							</div>
							<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
								<span>{dependency.id}</span>
								<CopyIssueIdButton issueId={dependency.id} pushLog={pushLog} />
							</div>
						</div>
					))}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">None.</p>
			)}
		</div>
	);
}

function CopyIssueIdButton({
	issueId,
	pushLog,
}: {
	issueId: string;
	pushLog?: RoadmapPanelProps["pushLog"];
}) {
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);

	useEffect(() => {
		if (copyState === "idle") return;
		const timeout = setTimeout(() => setCopyState("idle"), 1600);
		return () => clearTimeout(timeout);
	}, [copyState]);

	const copyIssueId = async (event: {
		preventDefault: () => void;
		stopPropagation: () => void;
	}) => {
		event.preventDefault();
		event.stopPropagation();
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error("Clipboard unavailable");
			}
			await navigator.clipboard.writeText(issueId);
			setCopyState("copied");
		} catch (err: any) {
			const message = err?.message || "Clipboard unavailable";
			setCopyState("failed");
			pushLog?.(`Failed to copy issue ID ${issueId}: ${message}`, "error");
		}
	};

	const feedbackText = copyState === "copied" ? "Copied" : "Copy failed";

	return (
		<span className="relative inline-flex items-center">
			<button
				type="button"
				aria-label={`Copy issue ID ${issueId}`}
				title={`Copy issue ID ${issueId}`}
				className={`inline-flex h-5 w-5 items-center justify-center rounded border border-border/70 text-muted-foreground transition hover:border-primary/60 hover:text-primary ${copyState === "copied" ? "border-primary/60 text-primary" : ""} ${copyState === "failed" ? "border-destructive/60 text-destructive" : ""}`}
				onClick={copyIssueId}
			>
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					className="h-3.5 w-3.5"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
				</svg>
			</button>
			{copyState !== "idle" && (
				<span
					role="status"
					className={`pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded px-2 py-1 text-[0.65rem] font-medium text-primary-foreground shadow-lg animate-bounce ${copyState === "failed" ? "bg-destructive" : "bg-primary"}`}
				>
					{feedbackText}
				</span>
			)}
		</span>
	);
}

function Meta({ label, value }: { label: string; value?: string }) {
	if (!value) return null;
	return (
		<div className="rounded border border-border bg-card/40 p-2">
			<div className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="mt-1 text-sm">{value}</div>
		</div>
	);
}

function findFocusEpic(
	hierarchy: RoadmapHierarchy,
): RoadmapEpicGroup | undefined {
	const activeGroups = hierarchy.epics.filter(
		(group) => group.epic.status !== "closed",
	);
	const candidates = activeGroups.length ? activeGroups : hierarchy.epics;
	return (
		candidates.find((group) => group.epic.status === "in_progress") ||
		[...candidates].sort((a, b) =>
			(b.epic.updatedAt ?? "").localeCompare(a.epic.updatedAt ?? ""),
		)[0]
	);
}

function flattenHierarchy(hierarchy: RoadmapHierarchy): RoadmapIssueView[] {
	return [
		...hierarchy.epics.flatMap((group) => [
			group.epic,
			...group.activeChildren,
			...group.closedChildren,
		]),
		...hierarchy.ungrouped,
	];
}

function detailTitle(type: string): string {
	if (type === "epic") return "Epic Details";
	return "Issue Details";
}

function formatDependency(dependency: RoadmapDependency): string {
	return `${dependency.title || dependency.id} (${dependency.status})`;
}

function formatStatus(status: string): string {
	return status.replace(/_/g, " ");
}

function toEditableStatus(status: string): EditableRoadmapStatus {
	if (status === "in_progress" || status === "closed") return status;
	return "open";
}

function canStartWork(issue: RoadmapIssueView): boolean {
	return issue.type !== "epic" && issue.status === "open";
}

function formatDate(value?: string): string | undefined {
	return value ? new Date(value).toLocaleString() : undefined;
}

function statusBadgeVariant(
	status: string,
): "default" | "success" | "warning" | "destructive" | "outline" {
	if (status === "in_progress") return "default";
	if (status === "closed") return "outline";
	if (status === "unknown") return "destructive";
	return "warning";
}
