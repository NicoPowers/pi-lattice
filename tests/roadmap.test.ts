import { describe, expect, it } from "bun:test";
import {
	buildRoadmapOverviewFromIssues,
	readRoadmapOverview,
	updateRoadmapIssue,
	validateRoadmapIssuePatch,
} from "../extensions/multi-agent/roadmap.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("roadmap overview", () => {
	it("normalizes issue fields and computes summary groups from roadmap issues", () => {
		const overview = buildRoadmapOverviewFromIssues([
			issue({
				id: "epic",
				title: "Epic",
				type: "epic",
				status: "open",
				priority: 1,
				blocks: ["feature"],
			}),
			issue({
				id: "feature",
				title: "Feature",
				status: "open",
				priority: 2,
				blockedBy: ["epic"],
			}),
			issue({ id: "ready", title: "Ready task", status: "open", priority: 0 }),
			issue({
				id: "active",
				title: "Active task",
				status: "in_progress",
				priority: 1,
			}),
			issue({
				id: "done",
				title: "Done task",
				status: "closed",
				priority: 3,
				closedAt: "2026-05-20T00:00:00.000Z",
				closeReason: "Finished",
			}),
		]);

		expect(overview.issues.find((item) => item.id === "feature")).toMatchObject(
			{
				id: "feature",
				title: "Feature",
				type: "task",
				status: "open",
				priority: 2,
				labels: [],
				blocks: [],
				blockedBy: ["epic"],
			},
		);
		expect(overview.counts).toMatchObject({
			total: 5,
			inProgress: 1,
			ready: 2,
			blocked: 1,
			backlog: 3,
			closed: 1,
		});
		expect(overview.groups.ready).toEqual(["ready", "epic"]);
		expect(overview.groups.nextUp).toEqual(["ready", "epic"]);
		expect(overview.groups.blocked).toEqual(["feature"]);
		expect(overview.groups.inProgress).toEqual(["active"]);
		expect(overview.groups.closed).toEqual(["done"]);
	});

	it("treats closed blockers as resolved but open and unknown blockers as unresolved", () => {
		const overview = buildRoadmapOverviewFromIssues([
			issue({
				id: "closed-blocker",
				title: "Closed blocker",
				status: "closed",
				blocks: ["released"],
			}),
			issue({
				id: "open-blocker",
				title: "Open blocker",
				status: "open",
				blocks: ["blocked"],
			}),
			issue({
				id: "released",
				title: "Released",
				status: "open",
				blockedBy: ["closed-blocker"],
			}),
			issue({
				id: "blocked",
				title: "Blocked",
				status: "open",
				blockedBy: ["open-blocker", "missing-blocker"],
			}),
		]);

		expect(overview.groups.ready).toContain("released");
		expect(overview.groups.blocked).not.toContain("released");
		expect(overview.dependencyMap.unresolvedBlockers.released).toEqual([]);
		expect(
			overview.dependencyMap.unresolvedBlockers.blocked.map((item) => item.id),
		).toEqual(["open-blocker", "missing-blocker"]);
		expect(overview.dependencyMap.unresolvedBlockers.blocked[1]).toMatchObject({
			id: "missing-blocker",
			status: "unknown",
		});
	});

	it("derives dependency maps from both blockedBy and blocks relationships", () => {
		const overview = buildRoadmapOverviewFromIssues([
			issue({
				id: "blocker-a",
				title: "Blocker A",
				status: "open",
				blocks: ["dependent-a"],
			}),
			issue({ id: "blocker-b", title: "Blocker B", status: "open" }),
			issue({
				id: "dependent-a",
				title: "Dependent A",
				status: "open",
				blockedBy: ["blocker-b"],
			}),
		]);

		expect(
			overview.dependencyMap.blockers["dependent-a"].map((item) => item.id),
		).toEqual(["blocker-a", "blocker-b"]);
		expect(
			overview.dependencyMap.dependents["blocker-a"].map((item) => item.id),
		).toEqual(["dependent-a"]);
		expect(
			overview.dependencyMap.dependents["blocker-b"].map((item) => item.id),
		).toEqual(["dependent-a"]);
	});

	it("keeps all-closed projects inspectable without reporting ready or blocked active work", () => {
		const overview = buildRoadmapOverviewFromIssues([
			issue({
				id: "done-a",
				title: "Done A",
				status: "closed",
				blocks: ["done-b"],
			}),
			issue({
				id: "done-b",
				title: "Done B",
				status: "closed",
				blockedBy: ["done-a"],
			}),
		]);

		expect(overview.counts).toMatchObject({
			total: 2,
			ready: 0,
			blocked: 0,
			backlog: 0,
			closed: 2,
		});
		expect(overview.groups.closed).toEqual(["done-a", "done-b"]);
		expect(overview.dependencyMap.unresolvedBlockers["done-b"]).toEqual([]);
	});

	it("keeps missing dependency targets visible as unknown dependencies", () => {
		const overview = buildRoadmapOverviewFromIssues([
			issue({
				id: "blocked",
				title: "Blocked",
				status: "open",
				blockedBy: ["deleted-issue"],
			}),
		]);

		expect(overview.counts).toMatchObject({ ready: 0, blocked: 1 });
		expect(overview.dependencyMap.blockers.blocked).toEqual([
			{ id: "deleted-issue", status: "unknown" },
		]);
		expect(overview.dependencyMap.unresolvedBlockers.blocked).toEqual([
			{ id: "deleted-issue", status: "unknown" },
		]);
	});

	it("preserves Seeds extension metadata for Roadmap view models", () => {
		const overview = buildRoadmapOverviewFromIssues([
			issue({
				id: "focus",
				title: "Focus",
				extensions: {
					piLattice: {
						roadmap: { epicBoards: { epic: { currentFocus: true, order: 1 } } },
					},
				},
			}),
		]);

		expect(overview.issues[0].extensions).toEqual({
			piLattice: {
				roadmap: { epicBoards: { epic: { currentFocus: true, order: 1 } } },
			},
		});
	});

	it("reads .seeds/issues.jsonl in read-only mode from the repository", () => {
		const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-roadmap-"));
		try {
			fs.mkdirSync(path.join(repo, ".seeds"), { recursive: true });
			fs.writeFileSync(
				path.join(repo, ".seeds", "issues.jsonl"),
				[
					JSON.stringify(issue({ id: "one", title: "One", status: "open" })),
					"",
					JSON.stringify(issue({ id: "two", title: "Two", status: "closed" })),
				].join("\n"),
			);

			const overview = readRoadmapOverview(repo);

			expect(overview.source).toMatchObject({ type: "seeds", exists: true });
			expect(overview.source.path).toEndWith(
				path.join(".seeds", "issues.jsonl"),
			);
			expect(overview.counts).toMatchObject({ total: 2, ready: 1, closed: 1 });
		} finally {
			fs.rmSync(repo, { recursive: true, force: true });
		}
	});
});

describe("roadmap issue mutation validation", () => {
	it("accepts supported status and description patches", () => {
		expect(validateRoadmapIssuePatch({ status: "open" })).toEqual({
			success: true,
			patch: { status: "open" },
		});
		expect(
			validateRoadmapIssuePatch({
				status: "in_progress",
				description: "Line 1\nLine 2",
			}),
		).toEqual({
			success: true,
			patch: { status: "in_progress", description: "Line 1\nLine 2" },
		});
		expect(validateRoadmapIssuePatch({ status: "closed" })).toEqual({
			success: true,
			patch: { status: "closed" },
		});
	});

	it("rejects empty patches, unsupported fields, invalid statuses, and non-string descriptions", () => {
		expect(validateRoadmapIssuePatch({})).toMatchObject({
			success: false,
			status: 400,
		});
		expect(validateRoadmapIssuePatch({ title: "Nope" })).toMatchObject({
			success: false,
			status: 400,
		});
		expect(validateRoadmapIssuePatch({ status: "blocked" })).toMatchObject({
			success: false,
			status: 400,
		});
		expect(validateRoadmapIssuePatch({ description: 123 })).toMatchObject({
			success: false,
			status: 400,
		});
	});
});

describe("roadmap issue mutations", () => {
	it("updates issues through an injected Seeds runner and returns a refreshed overview", async () => {
		const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-roadmap-update-"));
		try {
			const issuesPath = path.join(repo, ".seeds", "issues.jsonl");
			fs.mkdirSync(path.dirname(issuesPath), { recursive: true });
			fs.writeFileSync(
				issuesPath,
				JSON.stringify(
					issue({
						id: "one",
						title: "One",
						status: "open",
						description: "Before",
					}),
				),
			);
			const calls: string[][] = [];

			const result = await updateRoadmapIssue(
				repo,
				"one",
				{ status: "in_progress", description: "After" },
				{
					runSeedsCommand: async (args, options) => {
						calls.push(args);
						expect(options.cwd).toBe(repo);
						const rows = fs
							.readFileSync(issuesPath, "utf-8")
							.trim()
							.split(/\r?\n/)
							.map((line) => JSON.parse(line));
						fs.writeFileSync(
							issuesPath,
							rows
								.map((row) =>
									JSON.stringify({
										...row,
										status: "in_progress",
										description: "After",
									}),
								)
								.join("\n"),
						);
						return { success: true, stdout: JSON.stringify({ success: true }) };
					},
				},
			);

			expect(calls).toEqual([
				[
					"update",
					"one",
					"--status",
					"in_progress",
					"--description",
					"After",
					"--json",
				],
			]);
			if (!result.success) throw new Error(result.error);
			expect(
				result.overview.issues.find((item) => item.id === "one"),
			).toMatchObject({ status: "in_progress", description: "After" });
			expect(result.overview.counts).toMatchObject({ inProgress: 1, ready: 0 });
		} finally {
			fs.rmSync(repo, { recursive: true, force: true });
		}
	});

	it("rejects unknown issue IDs before invoking Seeds", async () => {
		const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-roadmap-missing-"));
		try {
			fs.mkdirSync(path.join(repo, ".seeds"), { recursive: true });
			fs.writeFileSync(
				path.join(repo, ".seeds", "issues.jsonl"),
				JSON.stringify(issue({ id: "one", title: "One" })),
			);
			let called = false;

			const result = await updateRoadmapIssue(
				repo,
				"missing",
				{ status: "closed" },
				{
					runSeedsCommand: async () => {
						called = true;
						return { success: true };
					},
				},
			);

			expect(called).toBe(false);
			expect(result).toMatchObject({ success: false, status: 404 });
		} finally {
			fs.rmSync(repo, { recursive: true, force: true });
		}
	});
});

function issue(overrides: Record<string, unknown>) {
	return {
		id: "issue",
		title: "Issue",
		status: "open",
		type: "task",
		priority: 2,
		createdAt: "2026-05-20T00:00:00.000Z",
		updatedAt: "2026-05-20T00:00:00.000Z",
		description: "",
		labels: [],
		...overrides,
	};
}
