import type { AgentInfo } from "../types.js";

export type AgentState = AgentInfo & {
	text?: string;
	setupPending?: boolean;
	setupStartedAt?: number;
	removalPending?: boolean;
	removalStartedAt?: number;
};
export type LogLine = {
	id: number;
	text: string;
	level: "info" | "success" | "warn" | "error";
};
export type StatsEntry = { error?: string; stats?: any; state?: any };
