import * as fs from "node:fs";
import * as path from "node:path";

export interface SeedsToolCallLike {
	toolName?: string;
	input?: Record<string, unknown>;
}

export interface SeedsGuardResult {
	block: boolean;
	reason?: string;
}

interface SeedsIssueSummary {
	id: string;
	title: string;
	type: string;
	description: string;
	labels: string[];
}

export function buildSeedsDependencyGuardPrompt(): string {
	return [
		"Seeds dependency rule: blocks/blockedBy represent hard dependencies only, never epic membership or parent/child ownership.",
		"For tracer bullets under an epic, use shared labels plus description text such as `Part of <epic-id>`; do not add dependency edges unless work is truly blocked.",
		"Before creating or modifying Seeds dependencies, verify blocker semantics: issue A blocks issue B only when B cannot proceed until A is done.",
		"Do not edit `.seeds/issues.jsonl` directly. Use Seeds tools (`sd_create`, `sd_update`, `sd_close`, `sd_dep`) so validation stays active.",
	].join("\n");
}

export function guardSeedsToolCall(
	event: SeedsToolCallLike,
	repoCwd: string,
): SeedsGuardResult {
	const toolName = String(event.toolName || "");
	const input = event.input || {};

	const directEditReason = directSeedsEditReason(toolName, input);
	if (directEditReason) return { block: true, reason: directEditReason };

	if (toolName !== "sd_dep") return { block: false };
	if (String(input.action || "") !== "add") return { block: false };

	const dependentId = asString(input.issue);
	const blockerId = asString(input.depends_on ?? input.dependsOn);
	if (!dependentId || !blockerId) return { block: false };

	const issues = readSeedsIssues(repoCwd);
	const dependent = issues.get(dependentId);
	const blocker = issues.get(blockerId);
	if (!dependent || !blocker) return { block: false };

	if (isEpicMembershipDependency(dependent, blocker)) {
		return {
			block: true,
			reason: [
				"Blocked suspicious Seeds dependency edge: this looks like epic membership, not a hard dependency.",
				`Do not make ${dependent.id} depend on epic ${blocker.id}.`,
				"Use shared labels and `Part of <epic-id>` text for epic membership; use `sd_dep` only for true blockers.",
			].join(" "),
		};
	}

	return { block: false };
}

function directSeedsEditReason(
	toolName: string,
	input: Record<string, unknown>,
): string | undefined {
	if (!["edit", "write", "bash"].includes(toolName)) return undefined;
	if (toolName === "bash") {
		const command = asString(input.command);
		if (!/\.seeds\/issues\.jsonl/.test(command)) return undefined;
		return "Direct edits to .seeds/issues.jsonl are blocked. Use Seeds tools so dependency and epic-membership guards run.";
	}

	const target = asString(input.path);
	if (!target.replace(/\\/g, "/").endsWith("/.seeds/issues.jsonl")) {
		return undefined;
	}
	return "Direct edits to .seeds/issues.jsonl are blocked. Use Seeds tools so dependency and epic-membership guards run.";
}

function isEpicMembershipDependency(
	dependent: SeedsIssueSummary,
	blocker: SeedsIssueSummary,
): boolean {
	if (blocker.type !== "epic") return false;
	const description = dependent.description.toLowerCase();
	const mentionsEpic =
		description.includes(`part of ${blocker.id.toLowerCase()}`) ||
		description.includes(`part of epic`) ||
		description.includes(`part of ${blocker.title.toLowerCase()}`);
	const sharedLabels = dependent.labels.filter((label) =>
		blocker.labels.includes(label),
	);
	return mentionsEpic || sharedLabels.length > 0;
}

function readSeedsIssues(repoCwd: string): Map<string, SeedsIssueSummary> {
	const issuesPath = path.join(repoCwd, ".seeds", "issues.jsonl");
	const issues = new Map<string, SeedsIssueSummary>();
	if (!fs.existsSync(issuesPath)) return issues;
	for (const line of fs.readFileSync(issuesPath, "utf-8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			const id = asString(parsed.id);
			if (!id) continue;
			issues.set(id, {
				id,
				title: asString(parsed.title) || id,
				type: asString(parsed.type) || "task",
				description: asString(parsed.description),
				labels: asStringArray(parsed.labels),
			});
		} catch {
			// Seeds parser owns detailed validation; guard ignores malformed lines.
		}
	}
	return issues;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}
