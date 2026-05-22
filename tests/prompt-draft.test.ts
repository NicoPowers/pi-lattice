import { describe, expect, it } from "bun:test";
import {
	buildAgentPromptDraftRequest,
	normalizeDraftPromptOutput,
} from "../extensions/multi-agent/prompt-draft.js";

describe("agent prompt drafting", () => {
	it("builds drafting instructions from agent configuration and handoff protocol", () => {
		const request = buildAgentPromptDraftRequest({
			name: "test-researcher",
			description: "Find risky auth code",
			agentClass: "scout",
			model: "openai-codex/gpt-5.5",
			thinking: "medium",
			skillTemplates: ["codebase-research", "security-checklist"],
			extensionTemplates: ["repo-tools"],
			existingPrompt: "Focus on evidence.",
		});

		expect(request).toContain("Agent class: scout");
		expect(request).toContain(
			"Skill templates: codebase-research, security-checklist",
		);
		expect(request).toContain("Extension templates: repo-tools");
		expect(request).toContain("Existing prompt draft:\nFocus on evidence.");
		expect(request).toContain("Issue Handoff Artifacts");
		expect(request).toContain("Area Dossier");
		expect(request).toContain(
			"files read, exact symbols/modules, risks, unknowns",
		);
		expect(request).toContain("Return only the drafted agent prompt");
	});

	it("normalizes model output by removing common fences", () => {
		expect(
			normalizeDraftPromptOutput("```markdown\nYou are a scout.\n```"),
		).toBe("You are a scout.");
	});
});
