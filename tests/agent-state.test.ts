import { describe, expect, it } from "bun:test";
import { mergeAgentState } from "../web/shared/agent-state.js";
import type { AgentState } from "../web/shared/dashboard-types.js";

const baseAgent: AgentState = {
	name: "lead",
	status: "waiting",
	children: [],
	turns: 0,
	worktree: "/tmp/lead",
	pendingSend: {
		message: "question",
		startedAt: 1,
		timeoutMs: 300_000,
		status: "waiting",
	},
	turnDiagnostics: {
		stuck: true,
		thresholdMs: 30_000,
		pendingStatus: "waiting",
		reasons: ["waiting"],
		likelyCauses: ["pending"],
		actions: ["inspect"],
	},
};

describe("mergeAgentState", () => {
	it("clears stale pending turn metadata when an agent becomes idle without explicit pendingSend", () => {
		const merged = mergeAgentState(baseAgent, {
			name: "lead",
			status: "idle",
			children: [],
			turns: 1,
			worktree: "/tmp/lead",
			text: "answer",
		});

		expect(merged.pendingSend).toBeUndefined();
		expect(merged.turnDiagnostics).toBeUndefined();
		expect(merged.text).toBe("answer");
	});

	it("preserves pending turn metadata across partial waiting updates", () => {
		const merged = mergeAgentState(baseAgent, {
			name: "lead",
			status: "waiting",
			children: [],
			turns: 0,
			worktree: "/tmp/lead",
		});

		expect(merged.pendingSend?.message).toBe("question");
		expect(merged.turnDiagnostics?.stuck).toBe(true);
	});
});
