import type React from "react";
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { Dialog } from "../web/components/ui/dialog.js";

async function renderDialog(element: React.ReactElement) {
	const window = new Window({ url: "http://localhost/dashboard" });
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
		confirm: globalThis.confirm,
	};
	(window as any).event = undefined;
	(window as any).SyntaxError = SyntaxError;
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

describe("Dialog safety", () => {
	it("does not close on backdrop clicks or Escape by default", async () => {
		let closeCount = 0;
		const { window, cleanup } = await renderDialog(
			<Dialog
				open
				title="Safe modal"
				onOpenChange={(open) => {
					if (!open) closeCount += 1;
				}}
			>
				<div>modal body</div>
			</Dialog>,
		);
		try {
			const dialog = window.document.querySelector('[role="dialog"]')!;
			dialog.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			window.document.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			expect(closeCount).toBe(0);
		} finally {
			await cleanup();
		}
	});

	it("confirms before closing through the header close button when requested", async () => {
		let closeCount = 0;
		let confirmCount = 0;
		const { window, cleanup } = await renderDialog(
			<Dialog
				open
				title="Dirty modal"
				confirmOnClose
				confirmCloseMessage="Discard changes?"
				onOpenChange={(open) => {
					if (!open) closeCount += 1;
				}}
			>
				<div>dirty body</div>
			</Dialog>,
		);
		try {
			(globalThis as any).confirm = (message: string) => {
				confirmCount += 1;
				expect(message).toBe("Discard changes?");
				return false;
			};
			const closeButton = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) => button.getAttribute("aria-label") === "Close dialog")!;
			closeButton.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			expect(confirmCount).toBe(1);
			expect(closeCount).toBe(0);

			(globalThis as any).confirm = () => true;
			closeButton.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			expect(closeCount).toBe(1);
		} finally {
			await cleanup();
		}
	});
});
