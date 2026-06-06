import type {
	RoadmapDependency,
	RoadmapIssue,
	RoadmapOverview,
} from "../../types.js";

export interface RoadmapIssueView extends RoadmapIssue {
	unresolvedBlockers: RoadmapDependency[];
	resolvedBlockerCount: number;
	dependentCount: number;
}

export interface RoadmapEpicGroup {
	epic: RoadmapIssueView;
	activeChildren: RoadmapIssueView[];
	closedChildren: RoadmapIssueView[];
}

export interface RoadmapHierarchy {
	epics: RoadmapEpicGroup[];
	ungrouped: RoadmapIssueView[];
}

export type RoadmapEpicBoardColumn =
	| "backlog"
	| "ready"
	| "current_focus"
	| "in_progress"
	| "blocked"
	| "done";

export interface RoadmapEpicBoardCardMetadata {
	currentFocus: boolean;
	manualOrder?: number;
}

export interface RoadmapEpicBoardCard {
	issue: RoadmapIssueView;
	column: RoadmapEpicBoardColumn;
	metadata: RoadmapEpicBoardCardMetadata;
	ready: boolean;
	dependents: RoadmapDependency[];
	externalUnresolvedBlockers: RoadmapDependency[];
	externalDependents: RoadmapDependency[];
}

export interface RoadmapEpicBoardColumnView {
	id: RoadmapEpicBoardColumn;
	title: string;
	description: string;
	cards: RoadmapEpicBoardCard[];
}

export interface RoadmapEpicBoard {
	epic: RoadmapIssueView;
	columns: RoadmapEpicBoardColumnView[];
	memberCount: number;
	excludedCapabilities: typeof EPIC_BOARD_EXCLUDED_V1_CAPABILITIES;
}

export interface RoadmapTaskBuckets {
	inProgress: RoadmapIssueView[];
	ready: RoadmapIssueView[];
	blocked: RoadmapIssueView[];
	backlog: RoadmapIssueView[];
	closed: RoadmapIssueView[];
}

export const EPIC_BOARD_COLUMNS: ReadonlyArray<{
	id: RoadmapEpicBoardColumn;
	title: string;
	description: string;
}> = [
	{
		id: "backlog",
		title: "Backlog / Open",
		description:
			"Open epic children that are not blocked, not current focus, not in progress, and not highlighted as ready.",
	},
	{
		id: "ready",
		title: "Ready",
		description:
			"Open epic children with no unresolved hard blockers that the Seeds provider marks actionable.",
	},
	{
		id: "current_focus",
		title: "Current Focus",
		description:
			"Open or in-progress epic children marked as the operator/agent focus through Seeds extension metadata.",
	},
	{
		id: "in_progress",
		title: "In Progress",
		description: "Epic children with Seeds status in_progress.",
	},
	{
		id: "blocked",
		title: "Blocked",
		description: "Non-closed epic children with unresolved hard blockers.",
	},
	{
		id: "done",
		title: "Done",
		description: "Closed epic children.",
	},
];

export const EPIC_BOARD_EXCLUDED_V1_CAPABILITIES = [
	"review_validate_column",
	"roadmap_start_work",
	"drag_drop_mutation",
	"agent_spawn_or_handoff",
] as const;

export interface SplitEpicGroups {
	active: RoadmapEpicGroup[];
	closed: RoadmapEpicGroup[];
}

export function buildRoadmapHierarchy(
	overview: RoadmapOverview,
): RoadmapHierarchy {
	const issueViews = overview.issues.map((issue) =>
		toIssueView(issue, overview),
	);
	const epics = issueViews.filter((issue) => issue.type === "epic");
	const assigned = new Set<string>();

	const epicGroups = epics.map((epic) => {
		assigned.add(epic.id);
		const children = issueViews.filter(
			(issue) =>
				issue.id !== epic.id &&
				issue.type !== "epic" &&
				hasExplicitEpicMembership(issue, epic),
		);
		for (const child of children) assigned.add(child.id);

		return {
			epic,
			activeChildren: sortIssueViews(
				children.filter((issue) => issue.status !== "closed"),
			),
			closedChildren: sortIssueViews(
				children.filter((issue) => issue.status === "closed"),
			),
		};
	});

	const ungrouped = sortIssueViews(
		issueViews.filter((issue) => !assigned.has(issue.id)),
	);
	return { epics: sortEpicGroups(epicGroups), ungrouped };
}

function toIssueView(
	issue: RoadmapIssue,
	overview: RoadmapOverview,
): RoadmapIssueView {
	const blockers = overview.dependencyMap.blockers[issue.id] || [];
	const unresolvedBlockers =
		overview.dependencyMap.unresolvedBlockers[issue.id] || [];
	return {
		...issue,
		unresolvedBlockers,
		resolvedBlockerCount: Math.max(
			0,
			blockers.length - unresolvedBlockers.length,
		),
		dependentCount: (overview.dependencyMap.dependents[issue.id] || []).length,
	};
}

function sortEpicGroups(groups: RoadmapEpicGroup[]): RoadmapEpicGroup[] {
	return [...groups].sort((a, b) => compareIssues(a.epic, b.epic));
}

function hasExplicitEpicMembership(
	issue: RoadmapIssueView,
	epic: RoadmapIssueView,
): boolean {
	const description = issue.description || "";
	const pattern = new RegExp(
		`\\bpart\\s+of\\s+${escapeRegExp(epic.id)}\\b`,
		"i",
	);
	return pattern.test(description);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sortIssueViews(issues: RoadmapIssueView[]): RoadmapIssueView[] {
	return [...issues].sort(compareIssues);
}

export function splitEpicGroups(hierarchy: RoadmapHierarchy): SplitEpicGroups {
	return {
		active: hierarchy.epics.filter((group) => group.epic.status !== "closed"),
		closed: hierarchy.epics.filter((group) => group.epic.status === "closed"),
	};
}

export function buildRoadmapEpicBoard(
	group: RoadmapEpicGroup,
	overview: RoadmapOverview,
): RoadmapEpicBoard {
	const epicId = group.epic.id;
	const memberIds = new Set(
		[...group.activeChildren, ...group.closedChildren].map((issue) => issue.id),
	);
	const cardsByColumn = new Map<RoadmapEpicBoardColumn, RoadmapEpicBoardCard[]>(
		EPIC_BOARD_COLUMNS.map((column) => [column.id, []]),
	);

	for (const issue of [...group.activeChildren, ...group.closedChildren]) {
		const column = classifyEpicBoardCard(issue, overview, epicId);
		cardsByColumn
			.get(column)!
			.push(toEpicBoardCard(issue, overview, epicId, column, memberIds));
	}

	return {
		epic: group.epic,
		columns: EPIC_BOARD_COLUMNS.map((column) => ({
			...column,
			cards: sortEpicBoardCardViews(cardsByColumn.get(column.id)!, epicId),
		})),
		memberCount: memberIds.size,
		excludedCapabilities: EPIC_BOARD_EXCLUDED_V1_CAPABILITIES,
	};
}

export function buildRoadmapEpicBoardByEpicId(
	overview: RoadmapOverview,
	epicId: string,
): RoadmapEpicBoard | undefined {
	const group = buildRoadmapHierarchy(overview).epics.find(
		(item) => item.epic.id === epicId,
	);
	return group ? buildRoadmapEpicBoard(group, overview) : undefined;
}

export function bucketEpicTasks(
	group: RoadmapEpicGroup,
	overview: RoadmapOverview,
): RoadmapTaskBuckets {
	const board = buildRoadmapEpicBoard(group, overview);
	const cardsByColumn = new Map(
		board.columns.map((column) => [column.id, column.cards]),
	);
	const currentFocus = cardsByColumn.get("current_focus") || [];
	const inProgress = cardsByColumn.get("in_progress") || [];
	return {
		inProgress: [
			...currentFocus.map((card) => card.issue),
			...inProgress.map((card) => card.issue),
		],
		ready: (cardsByColumn.get("ready") || []).map((card) => card.issue),
		blocked: (cardsByColumn.get("blocked") || []).map((card) => card.issue),
		backlog: (cardsByColumn.get("backlog") || []).map((card) => card.issue),
		closed: (cardsByColumn.get("done") || []).map((card) => card.issue),
	};
}

export function classifyEpicBoardCard(
	issue: RoadmapIssueView,
	overview: RoadmapOverview,
	epicId: string,
): RoadmapEpicBoardColumn {
	// Precedence is exclusive for board rendering: terminal and blocked states win
	// over focus, then focus wins over in_progress so operators can distinguish
	// chosen work from background in-flight work.
	if (issue.status === "closed") return "done";
	if (issue.unresolvedBlockers.length) return "blocked";
	if (getEpicBoardCardMetadata(issue, epicId).currentFocus)
		return "current_focus";
	if (issue.status === "in_progress") return "in_progress";
	if (
		issue.status === "open" &&
		(overview.groups.ready.includes(issue.id) ||
			overview.groups.nextUp.includes(issue.id))
	)
		return "ready";
	return "backlog";
}

export function getEpicBoardCardMetadata(
	issue: RoadmapIssueView,
	epicId: string,
): RoadmapEpicBoardCardMetadata {
	const board = readEpicBoardMetadata(issue.extensions, epicId);
	return {
		currentFocus: board.currentFocus === true,
		manualOrder: typeof board.order === "number" ? board.order : undefined,
	};
}

export function sortEpicBoardCards(
	issues: RoadmapIssueView[],
	epicId: string,
): RoadmapIssueView[] {
	return [...issues].sort((a, b) => compareEpicBoardCardOrder(a, b, epicId));
}

function toEpicBoardCard(
	issue: RoadmapIssueView,
	overview: RoadmapOverview,
	epicId: string,
	column: RoadmapEpicBoardColumn,
	memberIds: Set<string>,
): RoadmapEpicBoardCard {
	const dependents = overview.dependencyMap.dependents[issue.id] || [];
	return {
		issue,
		column,
		metadata: getEpicBoardCardMetadata(issue, epicId),
		ready:
			overview.groups.ready.includes(issue.id) ||
			overview.groups.nextUp.includes(issue.id),
		dependents,
		externalUnresolvedBlockers: issue.unresolvedBlockers.filter(
			(dep) => !memberIds.has(dep.id),
		),
		externalDependents: dependents.filter((dep) => !memberIds.has(dep.id)),
	};
}

function sortEpicBoardCardViews(
	cards: RoadmapEpicBoardCard[],
	epicId: string,
): RoadmapEpicBoardCard[] {
	return [...cards].sort((a, b) =>
		compareEpicBoardCardOrder(a.issue, b.issue, epicId),
	);
}

function compareEpicBoardCardOrder(
	a: RoadmapIssueView,
	b: RoadmapIssueView,
	epicId: string,
): number {
	const aOrder = getEpicBoardCardMetadata(a, epicId).manualOrder;
	const bOrder = getEpicBoardCardMetadata(b, epicId).manualOrder;
	if (aOrder !== undefined || bOrder !== undefined) {
		if (aOrder === undefined) return 1;
		if (bOrder === undefined) return -1;
		if (aOrder !== bOrder) return aOrder - bOrder;
	}
	return compareIssues(a, b);
}

function readEpicBoardMetadata(
	extensions: Record<string, unknown> | undefined,
	epicId: string,
): Record<string, unknown> {
	const piLattice = readRecord(extensions?.piLattice);
	const roadmap = readRecord(piLattice.roadmap);
	const epicBoards = readRecord(roadmap.epicBoards);
	return readRecord(epicBoards[epicId]);
}

function readRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function compareIssues(a: RoadmapIssueView, b: RoadmapIssueView): number {
	const status = statusWeight(a.status) - statusWeight(b.status);
	if (status !== 0) return status;
	const priority = a.priority - b.priority;
	if (priority !== 0) return priority;
	const updated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
	if (updated !== 0) return updated;
	return a.id.localeCompare(b.id);
}

function statusWeight(status: string): number {
	if (status === "in_progress") return 0;
	if (status === "open") return 1;
	if (status === "closed") return 2;
	return 3;
}
