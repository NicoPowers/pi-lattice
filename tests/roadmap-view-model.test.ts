import { describe, expect, it } from "bun:test";
import {
	EPIC_BOARD_COLUMNS,
	EPIC_BOARD_EXCLUDED_V1_CAPABILITIES,
	buildRoadmapEpicBoard,
	buildRoadmapEpicBoardByEpicId,
	buildRoadmapEpicDependencyTree,
	buildRoadmapHierarchy,
	bucketEpicTasks,
	classifyEpicBoardCard,
	getEpicBoardCardMetadata,
	splitEpicGroups,
} from "../web/features/roadmap/roadmap-view-model.js";
import type { RoadmapOverview } from "../web/types.js";

describe("roadmap hierarchy view model", () => {
	it("groups implementation work under epics using explicit Part of references", () => {
		const overview = roadmapOverview([
			issue({ id: "epic-a", title: "Epic A", type: "epic" }),
			issue({
				id: "child-a",
				title: "Child A",
				priority: 1,
				description: "Part of epic-a. Implements the first tracer.",
			}),
			issue({
				id: "closed-child",
				title: "Closed child",
				status: "closed",
				priority: 2,
				description: "Part of epic-a.",
			}),
			issue({
				id: "dependent-a",
				title: "Dependent A",
				priority: 3,
				blockedBy: ["child-a"],
			}),
			issue({ id: "solo", title: "Solo", priority: 0 }),
		]);

		const hierarchy = buildRoadmapHierarchy(overview);

		expect(hierarchy.epics).toHaveLength(1);
		expect(hierarchy.epics[0].epic.id).toBe("epic-a");
		expect(hierarchy.epics[0].activeChildren.map((item) => item.id)).toEqual([
			"child-a",
		]);
		expect(hierarchy.epics[0].closedChildren.map((item) => item.id)).toEqual([
			"closed-child",
		]);
		expect(hierarchy.ungrouped.map((item) => item.id)).toEqual([
			"solo",
			"dependent-a",
		]);
	});

	it("does not treat dependency links as epic membership", () => {
		const overview = roadmapOverview([
			issue({
				id: "epic-a",
				title: "Epic A",
				type: "epic",
				blocks: ["blocked-by-epic"],
			}),
			issue({
				id: "blocked-by-epic",
				title: "Blocked by epic",
				blockedBy: ["epic-a"],
			}),
			issue({ id: "blocks-epic", title: "Blocks epic", blocks: ["epic-a"] }),
		]);

		const hierarchy = buildRoadmapHierarchy(overview);

		expect(hierarchy.epics[0].activeChildren).toEqual([]);
		expect(hierarchy.epics[0].closedChildren).toEqual([]);
		expect(hierarchy.ungrouped.map((item) => item.id)).toEqual([
			"blocked-by-epic",
			"blocks-epic",
		]);
	});

	it("does not infer tracer work under a matching epic by shared labels or title tokens", () => {
		const overview = roadmapOverview([
			issue({
				id: "roadmap-epic",
				title: "Epic: Read-only Roadmap dashboard backed by Seeds",
				type: "epic",
				labels: ["dashboard", "roadmap", "epic"],
			}),
			issue({
				id: "tracer-4",
				title: "Roadmap tracer 4: add read-only issue detail panel and filters",
				labels: ["dashboard", "roadmap", "frontend", "tracer"],
			}),
			issue({
				id: "explicit-tracer",
				title: "Roadmap tracer with explicit membership",
				labels: ["dashboard", "roadmap", "frontend", "tracer"],
				description: "Part of roadmap-epic.",
			}),
		]);

		const hierarchy = buildRoadmapHierarchy(overview);

		expect(hierarchy.epics[0].activeChildren.map((item) => item.id)).toEqual([
			"explicit-tracer",
		]);
		expect(hierarchy.ungrouped.map((item) => item.id)).toEqual(["tracer-4"]);
	});

	it("keeps empty epics visible when they have no children", () => {
		const overview = roadmapOverview([
			issue({
				id: "empty-epic",
				title: "Epic: Empty",
				type: "epic",
				labels: ["empty"],
			}),
		]);

		const hierarchy = buildRoadmapHierarchy(overview);

		expect(hierarchy.epics).toHaveLength(1);
		expect(hierarchy.epics[0].activeChildren).toEqual([]);
		expect(hierarchy.epics[0].closedChildren).toEqual([]);
		expect(hierarchy.ungrouped).toEqual([]);
	});

	it("keeps shared-label issues ungrouped even when the matching epic is closed", () => {
		const overview = roadmapOverview([
			issue({
				id: "closed-epic",
				title: "Closed Epic",
				type: "epic",
				status: "closed",
				labels: ["lattice-library"],
			}),
			issue({
				id: "future-work",
				title: "Future Lattice Library work",
				labels: ["lattice-library"],
			}),
			issue({
				id: "explicit-child",
				title: "Explicit child",
				description: "Part of closed-epic.",
			}),
		]);

		const hierarchy = buildRoadmapHierarchy(overview);

		expect(hierarchy.epics[0].activeChildren.map((item) => item.id)).toEqual([
			"explicit-child",
		]);
		expect(hierarchy.ungrouped.map((item) => item.id)).toEqual(["future-work"]);
	});

	it("surfaces blocker and dependent metadata for issue badges", () => {
		const overview = roadmapOverview([
			issue({
				id: "blocker",
				title: "Open blocker",
				status: "open",
				blocks: ["blocked"],
			}),
			issue({
				id: "blocked",
				title: "Blocked",
				blockedBy: ["blocker", "missing"],
			}),
			issue({
				id: "done",
				title: "Done",
				status: "closed",
				blocks: ["blocked"],
			}),
		]);

		const hierarchy = buildRoadmapHierarchy(overview);
		const blocked = hierarchy.ungrouped.find((item) => item.id === "blocked");
		const blocker = hierarchy.ungrouped.find((item) => item.id === "blocker");

		expect(
			blocked?.unresolvedBlockers.map((item) => `${item.id}:${item.status}`),
		).toEqual(["blocker:open", "missing:unknown"]);
		expect(blocked?.resolvedBlockerCount).toBe(1);
		expect(blocker?.dependentCount).toBe(1);
	});

	it("buckets epic tasks by actionability for the epic detail panel", () => {
		const overview = roadmapOverview(
			[
				issue({ id: "epic", title: "Epic", type: "epic", labels: ["focus"] }),
				issue({
					id: "doing",
					title: "Doing",
					status: "in_progress",
					priority: 1,
					labels: ["focus"],
					description: "Part of epic.",
				}),
				issue({
					id: "ready",
					title: "Ready",
					priority: 0,
					labels: ["focus"],
					description: "Part of epic.",
				}),
				issue({
					id: "blocker",
					title: "Blocker",
					priority: 0,
					blocks: ["blocked"],
				}),
				issue({
					id: "blocked",
					title: "Blocked",
					priority: 2,
					labels: ["focus"],
					blockedBy: ["blocker"],
					description: "Part of epic.",
				}),
				issue({
					id: "later",
					title: "Later",
					priority: 3,
					labels: ["focus"],
					description: "Part of epic.",
				}),
				issue({
					id: "done",
					title: "Done",
					status: "closed",
					priority: 4,
					labels: ["focus"],
					description: "Part of epic.",
				}),
			],
			{ ready: ["ready"], nextUp: ["ready"] },
		);

		const hierarchy = buildRoadmapHierarchy(overview);
		const buckets = bucketEpicTasks(hierarchy.epics[0], overview);

		expect(buckets.inProgress.map((item) => item.id)).toEqual(["doing"]);
		expect(buckets.ready.map((item) => item.id)).toEqual(["ready"]);
		expect(buckets.blocked.map((item) => item.id)).toEqual(["blocked"]);
		expect(buckets.backlog.map((item) => item.id)).toEqual(["later"]);
		expect(buckets.closed.map((item) => item.id)).toEqual(["done"]);
	});

	it("classifies epic board cards with explicit v1 precedence and focus metadata", () => {
		const overview = roadmapOverview(
			[
				issue({ id: "epic", title: "Epic", type: "epic" }),
				issue({ id: "blocker", title: "Blocker", blocks: ["blocked-focus"] }),
				issue({
					id: "closed-focus",
					title: "Closed focus",
					status: "closed",
					description: "Part of epic.",
					extensions: {
						piLattice: {
							roadmap: {
								epicBoards: { epic: { currentFocus: true, order: 20 } },
							},
						},
					},
				}),
				issue({
					id: "blocked-focus",
					title: "Blocked focus",
					blockedBy: ["blocker"],
					description: "Part of epic.",
					extensions: {
						piLattice: {
							roadmap: {
								epicBoards: { epic: { currentFocus: true, order: 10 } },
							},
						},
					},
				}),
				issue({
					id: "doing-focus",
					title: "Doing focus",
					status: "in_progress",
					description: "Part of epic.",
					extensions: {
						piLattice: {
							roadmap: {
								epicBoards: { epic: { currentFocus: true, order: 5 } },
							},
						},
					},
				}),
				issue({
					id: "doing",
					title: "Doing",
					status: "in_progress",
					description: "Part of epic.",
				}),
				issue({ id: "ready", title: "Ready", description: "Part of epic." }),
			],
			{ ready: ["ready"], nextUp: ["ready"] },
		);
		const hierarchy = buildRoadmapHierarchy(overview);
		const byId = new Map(
			[
				...hierarchy.epics[0].activeChildren,
				...hierarchy.epics[0].closedChildren,
			].map((item) => [item.id, item]),
		);

		expect(
			classifyEpicBoardCard(byId.get("closed-focus")!, overview, "epic"),
		).toBe("done");
		expect(
			classifyEpicBoardCard(byId.get("blocked-focus")!, overview, "epic"),
		).toBe("blocked");
		expect(
			classifyEpicBoardCard(byId.get("doing-focus")!, overview, "epic"),
		).toBe("current_focus");
		expect(classifyEpicBoardCard(byId.get("doing")!, overview, "epic")).toBe(
			"in_progress",
		);
		expect(classifyEpicBoardCard(byId.get("ready")!, overview, "epic")).toBe(
			"ready",
		);
		expect(getEpicBoardCardMetadata(byId.get("doing-focus")!, "epic")).toEqual({
			currentFocus: true,
			manualOrder: 5,
		});
	});

	it("documents mutation and orchestration behaviors excluded from the v1 epic board", () => {
		expect(EPIC_BOARD_EXCLUDED_V1_CAPABILITIES).toEqual([
			"review_validate_column",
			"roadmap_start_work",
			"drag_drop_mutation",
			"agent_spawn_or_handoff",
		]);
	});

	it("builds a typed epic board DTO with exclusive column buckets and card metadata", () => {
		const overview = roadmapOverview(
			[
				issue({ id: "epic", title: "Epic", type: "epic" }),
				issue({ id: "blocker", title: "Blocker", blocks: ["blocked"] }),
				issue({
					id: "doing-focus",
					title: "Doing focus",
					status: "in_progress",
					priority: 1,
					description: "Part of epic.",
					extensions: {
						piLattice: {
							roadmap: {
								epicBoards: { epic: { currentFocus: true, order: 5 } },
							},
						},
					},
				}),
				issue({
					id: "doing",
					title: "Doing",
					status: "in_progress",
					priority: 2,
					description: "Part of epic.",
				}),
				issue({
					id: "ready",
					title: "Ready",
					priority: 0,
					description: "Part of epic.",
				}),
				issue({
					id: "blocked",
					title: "Blocked",
					priority: 3,
					blockedBy: ["blocker"],
					description: "Part of epic.",
				}),
				issue({
					id: "later",
					title: "Later",
					priority: 4,
					description: "Part of epic.",
				}),
				issue({
					id: "done",
					title: "Done",
					status: "closed",
					priority: 5,
					description: "Part of epic.",
				}),
				issue({
					id: "not-member",
					title: "Not a member",
				}),
			],
			{ ready: ["ready"], nextUp: ["ready"] },
		);
		const hierarchy = buildRoadmapHierarchy(overview);
		const board = buildRoadmapEpicBoard(hierarchy.epics[0], overview);

		expect(board.epic.id).toBe("epic");
		expect(board.excludedCapabilities).toEqual(
			EPIC_BOARD_EXCLUDED_V1_CAPABILITIES,
		);
		expect(board.columns.map((column) => column.id)).toEqual(
			EPIC_BOARD_COLUMNS.map((column) => column.id),
		);
		expect(
			board.columns.map((column) => column.cards.map((card) => card.issue.id)),
		).toEqual([
			["later"],
			["ready"],
			["doing-focus"],
			["doing"],
			["blocked"],
			["done"],
		]);

		const readyCard = board.columns.find((column) => column.id === "ready")
			?.cards[0];
		expect(readyCard?.ready).toBe(true);
		expect(readyCard?.column).toBe("ready");

		const focusCard = board.columns.find(
			(column) => column.id === "current_focus",
		)?.cards[0];
		expect(focusCard?.metadata).toEqual({
			currentFocus: true,
			manualOrder: 5,
		});

		const blockedCard = board.columns.find((column) => column.id === "blocked")
			?.cards[0];
		expect(
			blockedCard?.issue.unresolvedBlockers.map((item) => item.id),
		).toEqual(["blocker"]);
		expect(
			blockedCard?.externalUnresolvedBlockers.map((item) => item.id),
		).toEqual(["blocker"]);
		expect(blockedCard?.externalDependents).toEqual([]);
		expect(board.memberCount).toBe(6);
		expect(hierarchy.ungrouped.map((item) => item.id)).toEqual([
			"blocker",
			"not-member",
		]);
		expect(
			buildRoadmapEpicBoardByEpicId(overview, "epic")?.columns.length,
		).toBe(6);
		expect(buildRoadmapEpicBoardByEpicId(overview, "missing")).toBeUndefined();
	});

	it("keeps legacy epic task buckets aligned with the epic board DTO", () => {
		const overview = roadmapOverview(
			[
				issue({ id: "epic", title: "Epic", type: "epic" }),
				issue({
					id: "doing-focus",
					title: "Doing focus",
					status: "in_progress",
					description: "Part of epic.",
					extensions: {
						piLattice: {
							roadmap: {
								epicBoards: { epic: { currentFocus: true, order: 1 } },
							},
						},
					},
				}),
				issue({
					id: "doing",
					title: "Doing",
					status: "in_progress",
					description: "Part of epic.",
				}),
			],
			{ ready: [], nextUp: [] },
		);
		const hierarchy = buildRoadmapHierarchy(overview);
		const buckets = bucketEpicTasks(hierarchy.epics[0], overview);

		expect(buckets.inProgress.map((item) => item.id)).toEqual([
			"doing-focus",
			"doing",
		]);
	});

	it("builds dependency trees grouped by blocked epic card with external and resolved markers", () => {
		const overview = roadmapOverview([
			issue({ id: "epic", title: "Epic", type: "epic" }),
			issue({
				id: "blocked",
				title: "Blocked child",
				description: "Part of epic.",
				blockedBy: ["internal-blocker", "external-blocker", "done-blocker"],
			}),
			issue({
				id: "internal-blocker",
				title: "Internal blocker",
				description: "Part of epic.",
			}),
			issue({ id: "external-blocker", title: "External blocker" }),
			issue({
				id: "done-blocker",
				title: "Done blocker",
				status: "closed",
			}),
		]);
		const board = buildRoadmapEpicBoardByEpicId(overview, "epic")!;

		const tree = buildRoadmapEpicDependencyTree(board, overview);

		expect(tree.groups).toHaveLength(1);
		expect(tree.groups[0].blockedCard.issueId).toBe("blocked");
		expect(tree.groups[0].blockedCard.membership).toBe("member");
		expect(
			tree.groups[0].blockers.map((node) => [
				node.issueId,
				node.membership,
				node.resolved,
			]),
		).toEqual([
			["internal-blocker", "member", false],
			["external-blocker", "external", false],
			["done-blocker", "external", true],
		]);
	});

	it("keeps dependency trees bounded for dense dependency graphs", () => {
		const tasks = Array.from({ length: 12 }, (_, index) =>
			issue({
				id: `task-${index}`,
				title: `Task ${index}`,
				description: "Part of epic.",
				blockedBy: Array.from(
					{ length: index },
					(_unused, blockerIndex) => `task-${blockerIndex}`,
				),
			}),
		);
		const overview = roadmapOverview([
			issue({ id: "epic", title: "Epic", type: "epic" }),
			...tasks,
		]);
		const board = buildRoadmapEpicBoardByEpicId(overview, "epic")!;

		const tree = buildRoadmapEpicDependencyTree(board, overview);
		const countNode = (
			node: (typeof tree.groups)[number]["blockedCard"],
		): number =>
			1 +
			node.blockers.reduce((sum, child) => sum + countNode(child), 0) +
			node.dependents.reduce((sum, child) => sum + countNode(child), 0);
		const nodeCount = tree.groups.reduce(
			(sum, group) =>
				sum +
				countNode(group.blockedCard) +
				group.blockers.reduce(
					(blockerSum, blocker) => blockerSum + countNode(blocker),
					0,
				),
			0,
		);

		expect(nodeCount).toBeLessThan(500);
	});

	it("nests available blocker/dependent nodes without treating dependency-only links as epic members", () => {
		const overview = roadmapOverview([
			issue({ id: "epic", title: "Epic", type: "epic" }),
			issue({
				id: "blocked",
				title: "Blocked child",
				description: "Part of epic.",
				blockedBy: ["blocker"],
				blocks: ["external-dependent"],
			}),
			issue({
				id: "blocker",
				title: "Nested blocker",
				description: "Part of epic.",
				blockedBy: ["upstream"],
			}),
			issue({ id: "upstream", title: "Upstream external" }),
			issue({
				id: "external-dependent",
				title: "External dependent",
				blockedBy: ["blocked"],
			}),
		]);
		const board = buildRoadmapEpicBoardByEpicId(overview, "epic")!;

		const tree = buildRoadmapEpicDependencyTree(board, overview);

		expect(
			board.columns
				.flatMap((column) => column.cards)
				.map((card) => card.issue.id),
		).not.toContain("external-dependent");
		expect(tree.groups[0].blockers[0].blockers[0]).toMatchObject({
			issueId: "upstream",
			membership: "external",
		});
		expect(tree.groups[0].blockedCard.dependents).toEqual([
			expect.objectContaining({
				issueId: "external-dependent",
				membership: "external",
			}),
		]);
	});

	it("splits active and closed epics for the simplified roadmap view", () => {
		const overview = roadmapOverview([
			issue({
				id: "open-epic",
				title: "Open Epic",
				type: "epic",
				status: "open",
				priority: 2,
			}),
			issue({
				id: "doing-epic",
				title: "Doing Epic",
				type: "epic",
				status: "in_progress",
				priority: 1,
			}),
			issue({
				id: "closed-epic",
				title: "Closed Epic",
				type: "epic",
				status: "closed",
				priority: 0,
			}),
		]);

		const split = splitEpicGroups(buildRoadmapHierarchy(overview));

		expect(split.active.map((group) => group.epic.id)).toEqual([
			"doing-epic",
			"open-epic",
		]);
		expect(split.closed.map((group) => group.epic.id)).toEqual(["closed-epic"]);
	});
});

function roadmapOverview(
	issues: RoadmapOverview["issues"],
	groupOverrides: Partial<RoadmapOverview["groups"]> = {},
): RoadmapOverview {
	const blockers: RoadmapOverview["dependencyMap"]["blockers"] = {};
	const unresolvedBlockers: RoadmapOverview["dependencyMap"]["unresolvedBlockers"] =
		{};
	const dependents: RoadmapOverview["dependencyMap"]["dependents"] = {};
	const byId = new Map(issues.map((item) => [item.id, item]));

	for (const item of issues) {
		const blockerIds = new Set(item.blockedBy);
		for (const other of issues) {
			if (other.blocks.includes(item.id)) blockerIds.add(other.id);
		}
		blockers[item.id] = Array.from(blockerIds).map((id) =>
			dependency(id, byId),
		);
		unresolvedBlockers[item.id] = blockers[item.id].filter(
			(dep) => dep.status !== "closed",
		);

		const dependentIds = new Set(item.blocks);
		for (const other of issues) {
			if (other.blockedBy.includes(item.id)) dependentIds.add(other.id);
		}
		dependents[item.id] = Array.from(dependentIds).map((id) =>
			dependency(id, byId),
		);
	}

	return {
		source: { type: "seeds", path: ".seeds/issues.jsonl", exists: true },
		generatedAt: "2026-05-20T00:00:00.000Z",
		issues,
		counts: {
			total: issues.length,
			inProgress: 0,
			ready: 0,
			nextUp: 0,
			blocked: 0,
			backlog: 0,
			closed: 0,
		},
		groups: {
			inProgress: [],
			ready: [],
			nextUp: [],
			blocked: [],
			backlog: [],
			closed: [],
			...groupOverrides,
		},
		dependencyMap: { blockers, unresolvedBlockers, dependents },
	};
}

function issue(
	overrides: Partial<RoadmapOverview["issues"][number]>,
): RoadmapOverview["issues"][number] {
	return {
		id: "issue",
		title: "Issue",
		type: "task",
		status: "open",
		priority: 2,
		labels: [],
		description: "",
		createdAt: "2026-05-20T00:00:00.000Z",
		updatedAt: "2026-05-20T00:00:00.000Z",
		blocks: [],
		blockedBy: [],
		...overrides,
	};
}

function dependency(
	id: string,
	byId: Map<string, RoadmapOverview["issues"][number]>,
): RoadmapOverview["dependencyMap"]["blockers"][string][number] {
	const item = byId.get(id);
	if (!item) return { id, status: "unknown" };
	return {
		id,
		title: item.title,
		status: item.status,
		type: item.type,
		priority: item.priority,
	};
}
