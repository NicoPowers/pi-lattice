import type { AgentState } from "./dashboard-types.js";

export function mergeAgentState(
	previous: AgentState | undefined,
	next: AgentState,
): AgentState {
	const merged = { ...previous, ...next };
	const status = merged.status;
	const hasPendingSend = Object.hasOwn(next, "pendingSend");
	const hasTurnDiagnostics = Object.hasOwn(next, "turnDiagnostics");
	const pendingSend = hasPendingSend
		? next.pendingSend
		: status === "idle" || status === "error" || status === "exited"
			? undefined
			: previous?.pendingSend;
	const setupPending =
		next.setupPending ??
		(!!previous?.setupPending &&
			!merged.runtimeTools &&
			status !== "error" &&
			status !== "exited");
	const removalPending = next.removalPending ?? previous?.removalPending;
	return {
		...merged,
		pendingSend,
		turnDiagnostics: hasTurnDiagnostics
			? next.turnDiagnostics
			: pendingSend
				? previous?.turnDiagnostics
				: undefined,
		setupPending: removalPending ? false : setupPending,
		removalPending,
		removalStartedAt: next.removalStartedAt ?? previous?.removalStartedAt,
	};
}
