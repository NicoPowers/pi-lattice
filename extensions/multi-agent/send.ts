import { type Agent, log } from "./state.js";

function isBrokenInputError(err: any): boolean {
	return (
		err?.code === "EPIPE" ||
		err?.code === "ERR_STREAM_DESTROYED" ||
		err?.code === "ERR_STREAM_WRITE_AFTER_END"
	);
}

function agentInputClosedReason(agent: Agent): string | undefined {
	if (agent.status === "error" || agent.status === "exited") {
		return `Agent is ${agent.status}`;
	}

	const proc = agent.proc as any;
	if (proc.exitCode !== null && proc.exitCode !== undefined) {
		return `Agent process already exited with code ${proc.exitCode}`;
	}
	if (proc.signalCode) {
		return `Agent process already exited with signal ${proc.signalCode}`;
	}

	const stdin = agent.stdin as any;
	if (
		stdin.destroyed ||
		stdin.closed ||
		stdin.writableDestroyed ||
		stdin.writableEnded ||
		stdin.writableFinished
	) {
		return "Agent input stream is closed";
	}

	return undefined;
}

function normalizeInputError(agent: Agent, err: any): Error {
	const reason = err?.message || String(err);
	if (isBrokenInputError(err)) {
		return new Error(
			`Agent '${agent.id}' input stream is closed (${err.code}). The agent process likely exited; start a new test session and try again.`,
		);
	}
	return err instanceof Error ? err : new Error(reason);
}

export function markAgentInputError(agent: Agent, err: any): Error {
	const normalized = normalizeInputError(agent, err);
	log("send", `Agent '${agent.id}' stdin error: ${normalized.message}`);

	agent.status = isBrokenInputError(err) ? "exited" : "error";

	if (agent._nextTurn) {
		agent._nextTurn.reject(normalized);
		agent._nextTurn = undefined;
	}

	if (agent._rpcRequests) {
		for (const pending of agent._rpcRequests.values()) {
			clearTimeout(pending.timer);
			pending.reject(normalized);
		}
		agent._rpcRequests.clear();
	}

	return normalized;
}

export function writeAgentCommand(
	agent: Agent,
	command: Record<string, any>,
): Promise<void> {
	const closedReason = agentInputClosedReason(agent);
	if (closedReason) {
		return Promise.reject(new Error(closedReason));
	}

	const line = `${JSON.stringify(command)}\n`;
	const stdin = agent.stdin as any;

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (err?: Error | null) => {
			if (settled) return;
			settled = true;
			if (err) reject(markAgentInputError(agent, err));
			else resolve();
		};

		try {
			const acceptsCallback =
				typeof stdin.write === "function" && stdin.write.length >= 2;
			stdin.write(line, acceptsCallback ? finish : undefined);
			if (!acceptsCallback) finish();
		} catch (err: any) {
			finish(err);
		}
	});
}

export function rpcCommand<T = any>(
	agent: Agent,
	command: Record<string, any>,
	timeoutMs = 5_000,
): Promise<T> {
	const id = `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	agent._rpcRequests = agent._rpcRequests || new Map();
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			agent._rpcRequests?.delete(id);
			reject(new Error(`RPC command '${command.type}' timed out`));
		}, timeoutMs);
		agent._rpcRequests!.set(id, { resolve, reject, timer });
		writeAgentCommand(agent, { ...command, id }).catch((err) => {
			clearTimeout(timer);
			agent._rpcRequests?.delete(id);
			reject(err);
		});
	});
}

export async function sendToAgent(
	agent: Agent,
	message: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<void> {
	log("send", `Agent '${agent.id}' queuing send`);
	while (agent._currentSend) {
		if (signal?.aborted) throw new Error("Aborted");
		try {
			await agent._currentSend;
		} catch {
			/* ignore previous errors */
		}
	}

	const perform = async () => {
		const closedReason = agentInputClosedReason(agent);
		if (closedReason) {
			throw new Error(closedReason);
		}

		agent.accumulatedText = "";

		let rejectTurn: ((e: Error) => void) | undefined;
		let abortHandler: (() => void) | undefined;
		const turnPromise = new Promise<void>((resolve, reject) => {
			rejectTurn = reject;
			agent._nextTurn = { resolve, reject };
			agent._turnTimer = setTimeout(() => {
				reject(new Error(`Timeout after ${timeoutMs}ms`));
			}, timeoutMs);

			if (signal) {
				abortHandler = () => reject(new Error("Aborted"));
				signal.addEventListener("abort", abortHandler, { once: true });
			}
		});
		turnPromise.catch(() => {
			/* prevent unhandled rejection if the write fails before awaiting the turn */
		});

		try {
			const cmd = { type: "prompt", message };
			await rpcCommand(agent, cmd, Math.min(timeoutMs, 30_000));
			agent.history.push({ role: "user", text: message });
			log("send", `Agent '${agent.id}' prompt written`);
			await turnPromise;
			log("send", `Agent '${agent.id}' send resolved`);
		} catch (err: any) {
			rejectTurn?.(err instanceof Error ? err : new Error(String(err)));
			throw err;
		} finally {
			if (agent._turnTimer) {
				clearTimeout(agent._turnTimer);
				agent._turnTimer = undefined;
			}
			if (signal && abortHandler) {
				signal.removeEventListener("abort", abortHandler);
			}
			agent._nextTurn = undefined;
		}
	};

	agent._currentSend = perform();
	try {
		await agent._currentSend;
	} finally {
		agent._currentSend = undefined;
	}
}
