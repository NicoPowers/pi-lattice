import { describe, it, expect } from "bun:test";
import { rpcCommand, sendToAgent } from "../extensions/multi-agent/send.js";
import type { Agent } from "../extensions/multi-agent/state.js";

function makeAgent(
	overrides: Partial<Agent> = {},
	onWrite?: (agent: Agent, chunk: string) => void,
) {
	const writes: string[] = [];
	let agent: Agent;
	agent = {
		id: "lead",
		proc: { exitCode: null, signalCode: null } as any,
		stdin: {
			destroyed: false,
			closed: false,
			writableDestroyed: false,
			writableEnded: false,
			writableFinished: false,
			write(chunk: string, callback?: (err?: Error | null) => void) {
				writes.push(chunk);
				onWrite?.(agent, chunk);
				callback?.();
				return true;
			},
		} as any,
		status: "idle",
		accumulatedText: "previous answer",
		history: [],
		events: [],
		buffer: "",
		worktreePath: "/tmp/pi-worktree-lead",
		children: [],
		_rpcRequests: new Map(),
		...overrides,
	};
	if (!onWrite) {
		onWrite = (a, chunk) => {
			const command = JSON.parse(chunk);
			if (command.type !== "prompt") return;
			queueMicrotask(() => {
				const pending = a._rpcRequests?.get(command.id);
				if (!pending) return;
				clearTimeout(pending.timer);
				a._rpcRequests?.delete(command.id);
				pending.resolve(true);
			});
		};
	}
	return { agent, writes };
}

async function waitForNextTurn(agent: Agent) {
	for (let i = 0; i < 20; i++) {
		if (agent._nextTurn) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("agent turn was not started");
}

describe("sendToAgent", () => {
	it("writes prompt RPC, records user history, and clears previous text", async () => {
		const { agent, writes } = makeAgent();

		const send = sendToAgent(agent, "hello", 1_000);
		await waitForNextTurn(agent);
		agent._nextTurn!.resolve();
		await send;

		expect(writes).toHaveLength(1);
		const command = JSON.parse(writes[0]!.trim());
		expect(command).toMatchObject({ type: "prompt", message: "hello" });
		expect(command.id).toStartWith("rpc_");
		expect(agent.history).toEqual([{ role: "user", text: "hello" }]);
		expect(agent.accumulatedText).toBe("");
		expect(agent._currentSend).toBeUndefined();
		expect(agent._nextTurn).toBeUndefined();
	});

	it("serializes concurrent sends so prompts do not overlap", async () => {
		const { agent, writes } = makeAgent();

		const first = sendToAgent(agent, "first", 1_000);
		await waitForNextTurn(agent);
		const firstTurn = agent._nextTurn!;

		const second = sendToAgent(agent, "second", 1_000);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(writes).toHaveLength(1);

		firstTurn.resolve();
		await first;
		await waitForNextTurn(agent);
		expect(writes).toHaveLength(2);
		expect(JSON.parse(writes[1]!.trim())).toMatchObject({
			type: "prompt",
			message: "second",
		});

		agent._nextTurn!.resolve();
		await second;
		expect(agent.history.map((entry) => entry.text)).toEqual([
			"first",
			"second",
		]);
	});

	it("rejects immediately for exited agents without writing", async () => {
		const { agent, writes } = makeAgent({ status: "exited" });

		await expect(sendToAgent(agent, "hello", 1_000)).rejects.toThrow(
			"Agent is exited",
		);
		expect(writes).toHaveLength(0);
	});

	it("turns broken stdin writes into API errors instead of uncaught exceptions", async () => {
		const brokenPipe = Object.assign(new Error("write EPIPE"), {
			code: "EPIPE",
		});
		const { agent } = makeAgent({
			stdin: {
				write(_chunk: string, callback?: (err?: Error | null) => void) {
					callback?.(brokenPipe);
					return false;
				},
			} as any,
		});

		await expect(sendToAgent(agent, "hello", 1_000)).rejects.toThrow(
			"input stream is closed (EPIPE)",
		);
		expect(agent.status).toBe("exited");
		expect(agent._nextTurn).toBeUndefined();
	});

	it("clears pending RPC requests when stdin is broken", async () => {
		const brokenPipe = Object.assign(new Error("write EPIPE"), {
			code: "EPIPE",
		});
		const { agent } = makeAgent({
			stdin: {
				write(_chunk: string, callback?: (err?: Error | null) => void) {
					callback?.(brokenPipe);
					return false;
				},
			} as any,
		});

		await expect(
			rpcCommand(agent, { type: "get-runtime-tools" }, 1_000),
		).rejects.toThrow("input stream is closed (EPIPE)");
		expect(agent.status).toBe("exited");
		expect(agent._rpcRequests?.size).toBe(0);
	});

	it("rejects immediately when the RPC prompt preflight response fails", async () => {
		let commandId: string | undefined;
		const { agent } = makeAgent({}, (a, chunk) => {
			const command = JSON.parse(chunk);
			commandId = command.id;
			queueMicrotask(() => {
				const pending = a._rpcRequests?.get(command.id);
				if (!pending) return;
				clearTimeout(pending.timer);
				a._rpcRequests?.delete(command.id);
				pending.reject(new Error("No API key found for moonshotai."));
			});
		});

		await expect(sendToAgent(agent, "hello", 10_000)).rejects.toThrow(
			"No API key found for moonshotai.",
		);
		expect(commandId).toStartWith("rpc_");
		expect(agent._nextTurn).toBeUndefined();
		expect(agent._currentSend).toBeUndefined();
	});

	it("waits for agent_end after RPC prompt preflight succeeds", async () => {
		const { agent } = makeAgent({}, (a, chunk) => {
			const command = JSON.parse(chunk);
			queueMicrotask(() => {
				const pending = a._rpcRequests?.get(command.id);
				if (!pending) return;
				clearTimeout(pending.timer);
				a._rpcRequests?.delete(command.id);
				pending.resolve(true);
			});
			setTimeout(() => {
				a.accumulatedText = "OK";
				a._nextTurn?.resolve();
			}, 5);
		});

		await sendToAgent(agent, "hello", 10_000);

		expect(agent.history).toContainEqual({ role: "user", text: "hello" });
		expect(agent.accumulatedText).toBe("OK");
	});
});
