import type React from "react";
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { AgentsPanel } from "../web/features/live-agents/LiveAgentsPanel.js";

async function render(element: React.ReactElement) {
	const window = new Window({ url: "http://localhost/dashboard" });
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
		fetch: globalThis.fetch,
	};
	(window as any).SyntaxError = SyntaxError;
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
		fetch: async () => new Response("{}", { status: 200 }),
	});
	const container = window.document.createElement("div");
	window.document.body.appendChild(container);
	const root = createRoot(container as unknown as Element);
	root.render(element);
	await window.happyDOM.waitUntilComplete();
	await new Promise((resolve) => setTimeout(resolve, 0));
	return {
		window,
		cleanup: async () => {
			root.unmount();
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));
			Object.assign(globalThis, previous);
		},
	};
}

describe("Live Agents dashboard", () => {
	it("shows issue handoff metadata on agent cards", async () => {
		const artifactPath =
			"/workspaces/repo/.pi/pi-agent-orchestrator/issues/pi-agent-orchestrator-f91c";
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "idle",
						definition: "lead",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-lead",
						issueId: "pi-agent-orchestrator-f91c",
						artifactPath,
					},
				}}
				stats={{}}
				onInspect={() => {}}
				pushLog={() => {}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("issue: pi-agent-orchestrator-f91c");
			expect(text).toContain("artifacts:");
			const artifact = Array.from(
				window.document.querySelectorAll("span"),
			).find((element) => element.textContent?.includes("artifacts:"));
			expect(artifact?.getAttribute("title")).toBe(artifactPath);
		} finally {
			await cleanup();
		}
	});
});
