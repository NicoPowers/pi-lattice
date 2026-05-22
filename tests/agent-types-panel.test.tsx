import type React from "react";
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { TypeEditorDialog } from "../web/features/agent-types/AgentTypesPanel.js";

type TestFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

async function render(
	element: React.ReactElement,
	fetchImpl: TestFetch = async () => new Response("{}", { status: 200 }),
) {
	const window = new Window({ url: "http://localhost/dashboard" });
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
		fetch: globalThis.fetch,
		confirm: globalThis.confirm,
	};
	(window as any).SyntaxError = SyntaxError;
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
		fetch: fetchImpl,
		confirm: () => true,
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

const defaultModels = [
	{
		provider: "openai-codex",
		id: "gpt-5.5",
		pattern: "openai-codex/gpt-5.5",
		context: "272K",
		maxOut: "128K",
		thinking: true,
		images: true,
	},
];

const defaultType = {
	name: "test-researcher",
	description: "Research agent",
	agentClass: "scout" as const,
	model: "openai-codex/gpt-5.5",
	thinking: "medium" as const,
	source: "project",
};

describe("Agent Type editor", () => {
	it("uses a wide dialog so edit controls fit without tiny vertical scrolling", async () => {
		const { window, cleanup } = await render(
			<TypeEditorDialog
				open={true}
				typeDef={defaultType}
				models={defaultModels}
				skillTemplates={[]}
				extensionTemplates={[]}
				onClose={() => {}}
				onSaved={() => {}}
			/>,
		);
		try {
			const dialog = window.document.querySelector('[role="dialog"]');
			const panel = dialog?.firstElementChild;
			expect(panel?.className).toContain("max-w-4xl");
			const layout = window.document.querySelector(
				'[data-testid="agent-type-editor-layout"]',
			);
			expect(layout?.className).toContain("md:grid-cols-2");
			const promptColumn = window.document.querySelector(
				'[data-testid="agent-type-editor-prompt-column"]',
			);
			expect(promptColumn?.textContent).toContain("Prompt / Instructions");
			const promptTextarea = promptColumn?.querySelector("textarea");
			expect(promptTextarea?.getAttribute("rows")).toBe("16");
		} finally {
			await cleanup();
		}
	});

	it("initializes the prompt textarea from the saved agent definition", async () => {
		const { window, cleanup } = await render(
			<TypeEditorDialog
				open={true}
				typeDef={{ ...defaultType, prompt: "Saved drafted prompt." }}
				models={defaultModels}
				skillTemplates={[]}
				extensionTemplates={[]}
				onClose={() => {}}
				onSaved={() => {}}
			/>,
		);
		try {
			const promptColumn = window.document.querySelector(
				'[data-testid="agent-type-editor-prompt-column"]',
			);
			expect(promptColumn?.querySelector("textarea")?.value).toBe(
				"Saved drafted prompt.",
			);
		} finally {
			await cleanup();
		}
	});

	it("drafts prompt instructions from current agent configuration", async () => {
		let request: any;
		let resolveDraft!: (response: Response) => void;
		const fetchImpl: TestFetch = (input, init) => {
			request = { input, init };
			return new Promise((resolve) => {
				resolveDraft = resolve;
			});
		};
		const { window, cleanup } = await render(
			<TypeEditorDialog
				open={true}
				typeDef={{
					...defaultType,
					skillTemplates: ["codebase-research"],
					extensionTemplates: ["repo-tools"],
				}}
				models={defaultModels}
				skillTemplates={[]}
				extensionTemplates={[]}
				onClose={() => {}}
				onSaved={() => {}}
			/>,
			fetchImpl,
		);
		try {
			const draftButton = Array.from(
				window.document.querySelectorAll("button"),
			).find((button) => button.textContent?.includes("Draft prompt"));
			expect(draftButton).toBeDefined();
			draftButton?.click();
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(
				window.document.querySelector(
					'[data-testid="agent-type-prompt-skeleton"]',
				),
			).toBeTruthy();
			expect(String(request.input)).toBe("/api/agent-types/draft-prompt");
			const body = JSON.parse(String(request.init?.body));
			expect(body).toMatchObject({
				name: "test-researcher",
				description: "Research agent",
				agentClass: "scout",
				model: "openai-codex/gpt-5.5",
				thinking: "medium",
				skillTemplates: ["codebase-research"],
				extensionTemplates: ["repo-tools"],
			});
			resolveDraft(
				new Response(
					JSON.stringify({ success: true, prompt: "You are a focused scout." }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const promptColumn = window.document.querySelector(
				'[data-testid="agent-type-editor-prompt-column"]',
			);
			expect(promptColumn?.querySelector("textarea")?.value).toBe(
				"You are a focused scout.",
			);
		} finally {
			await cleanup();
		}
	});
});
