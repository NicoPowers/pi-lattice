import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("agent prompt draft API", () => {
	it("passes agent configuration to the draft service and returns the drafted prompt", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-prompt-draft-api-"),
		);
		let received: any;
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({ agent: undefined as any, error: "disabled" }),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
			currentModel: () => "openai-codex/gpt-5.5",
			draftAgentPrompt: async (input) => {
				received = input;
				return "You are a focused scout agent.";
			},
		});

		try {
			const res = await fetch(`${handle.url}/api/agent-types/draft-prompt`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "test-researcher",
					description: "Find risky auth code",
					agentClass: "scout",
					model: "openai-codex/gpt-5.5",
					thinking: "medium",
					skillTemplates: ["codebase-research"],
					extensionTemplates: ["repo-tools"],
					existingPrompt: "Focus on evidence.",
				}),
			});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				success: true,
				prompt: "You are a focused scout agent.",
			});
			expect(received).toMatchObject({
				repoCwd: tmpDir,
				name: "test-researcher",
				agentClass: "scout",
				model: "openai-codex/gpt-5.5",
				skillTemplates: ["codebase-research"],
				extensionTemplates: ["repo-tools"],
			});
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
