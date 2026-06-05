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

export interface RoadmapTaskBuckets {
	inProgress: RoadmapIssueView[];
	ready: RoadmapIssueView[];
	blocked: RoadmapIssueView[];
	backlog: RoadmapIssueView[];
	closed: RoadmapIssueView[];
}

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

export function bucketEpicTasks(
	group: RoadmapEpicGroup,
	overview: RoadmapOverview,
): RoadmapTaskBuckets {
	const buckets: RoadmapTaskBuckets = {
		inProgress: [],
		ready: [],
		blocked: [],
		backlog: [],
		closed: [],
	};
	for (const issue of [...group.activeChildren, ...group.closedChildren]) {
		if (issue.status === "closed") buckets.closed.push(issue);
		else if (issue.status === "in_progress") buckets.inProgress.push(issue);
		else if (issue.unresolvedBlockers.length) buckets.blocked.push(issue);
		else if (
			overview.groups.ready.includes(issue.id) ||
			overview.groups.nextUp.includes(issue.id)
		)
			buckets.ready.push(issue);
		else buckets.backlog.push(issue);
	}
	return {
		inProgress: sortIssueViews(buckets.inProgress),
		ready: sortIssueViews(buckets.ready),
		blocked: sortIssueViews(buckets.blocked),
		backlog: sortIssueViews(buckets.backlog),
		closed: sortIssueViews(buckets.closed),
	};
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
