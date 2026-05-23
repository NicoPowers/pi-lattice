import type React from "react";
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { InspectTimeline } from "../web/features/live-agents/InspectTimeline.js";

async function render(element: React.ReactElement) {
	const window = new Window({ url: "http://localhost/dashboard" });
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
	};
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
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

describe("InspectTimeline", () => {
	it("renders detailed context and cost telemetry for the inspected agent", async () => {
		const { window, cleanup } = await render(
			<InspectTimeline
				timeline={{
					metadata: {
						name: "lead",
						status: "idle",
						model: "test-model",
						worktree: "/tmp/pi-worktree-lead",
						children: [],
						turns: 2,
					},
					entries: [],
				}}
				stats={{
					stats: {
						cost: 0.123456,
						contextUsage: {
							tokens: 24_000,
							contextWindow: 120_000,
						},
						tokens: {
							input: 20_000,
							output: 4_000,
							total: 24_000,
						},
					},
					state: {
						model: { contextWindow: 120_000 },
					},
				}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("Context & cost");
			expect(text).toContain("20%");
			expect(text).toContain("24.0K / 120.0K");
			expect(text).toContain("input tokens");
			expect(text).toContain("20.0K");
			expect(text).toContain("output tokens");
			expect(text).toContain("4.0K");
			expect(text).toContain("$0.1235");
		} finally {
			await cleanup();
		}
	});
});
