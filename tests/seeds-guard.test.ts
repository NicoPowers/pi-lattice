import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildSeedsDependencyGuardPrompt,
	guardSeedsToolCall,
} from "../extensions/multi-agent/seeds-guard.js";

describe("Seeds dependency guard", () => {
	it("blocks using an epic dependency edge as ownership for a child issue", () => {
		withSeedsRepo(
			[
				issue({ id: "epic", type: "epic", title: "Epic", labels: ["rename"] }),
				issue({
					id: "child",
					type: "task",
					title: "Child",
					description: "Part of epic. Implement slice.",
					labels: ["rename"],
				}),
			],
			(repo) => {
				const result = guardSeedsToolCall(
					{
						toolName: "sd_dep",
						input: {
							action: "add",
							issue: "child",
							depends_on: "epic",
						},
					},
					repo,
				);

				expect(result.block).toBe(true);
				expect(result.reason).toContain("dependency edge");
				expect(result.reason).toContain("epic membership");
			},
		);
	});

	it("allows normal dependencies between non-epic work items", () => {
		withSeedsRepo(
			[
				issue({ id: "design", type: "task", title: "Design" }),
				issue({ id: "build", type: "task", title: "Build" }),
			],
			(repo) => {
				const result = guardSeedsToolCall(
					{
						toolName: "sd_dep",
						input: {
							action: "add",
							issue: "build",
							depends_on: "design",
						},
					},
					repo,
				);

				expect(result.block).toBe(false);
			},
		);
	});

	it("blocks direct edits to .seeds/issues.jsonl so agents use Seeds tools", () => {
		const result = guardSeedsToolCall(
			{
				toolName: "edit",
				input: { path: "/repo/.seeds/issues.jsonl", edits: [] },
			},
			"/repo",
		);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("Use Seeds tools");
	});

	it("documents dependency vs epic-membership rules for prompt injection", () => {
		const prompt = buildSeedsDependencyGuardPrompt();

		expect(prompt).toContain("blocks/blockedBy");
		expect(prompt).toContain("hard dependencies");
		expect(prompt).toContain("epic membership");
	});
});

function withSeedsRepo(
	issues: Array<Record<string, unknown>>,
	fn: (repo: string) => void,
) {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-seeds-guard-"));
	try {
		fs.mkdirSync(path.join(repo, ".seeds"), { recursive: true });
		fs.writeFileSync(
			path.join(repo, ".seeds", "issues.jsonl"),
			issues.map((item) => JSON.stringify(item)).join("\n"),
		);
		fn(repo);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
}

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
