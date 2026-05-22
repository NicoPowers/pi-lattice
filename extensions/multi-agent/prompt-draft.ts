import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { renderIssueArtifactInstructions } from "./artifacts.js";
import { getPiInvocation } from "./spawn.js";

export interface AgentPromptDraftInput {
	name?: string;
	description?: string;
	agentClass?: "lead" | "scout" | "implementer" | "reviewer" | "orchestrator";
	model?: string;
	thinking?: string;
	skillTemplates?: string[];
	extensionTemplates?: string[];
	existingPrompt?: string;
}

export interface DraftAgentPromptOptions extends AgentPromptDraftInput {
	repoCwd: string;
	model?: string;
	timeoutMs?: number;
}

function formatList(values?: string[]): string {
	const clean = (values || []).map((value) => value.trim()).filter(Boolean);
	return clean.length ? clean.join(", ") : "none";
}

function sampleArtifactInstructions(
	agentClass: AgentPromptDraftInput["agentClass"],
): string {
	return renderIssueArtifactInstructions({
		agentId: "{{name}}",
		agentClass,
		issueId: "{{issueId}}",
		artifactPath: "{{artifactPath}}",
		artifactFiles: {
			issueContext: "{{artifactPath}}/issue-context.json",
			leadPlan: "{{artifactPath}}/lead-plan.json",
			leadSummary: "{{artifactPath}}/lead-summary.md",
			scoutsDir: "{{artifactPath}}/scouts",
			researchersDir: "{{artifactPath}}/researchers",
			buildersDir: "{{artifactPath}}/builders",
		},
	}).trim();
}

export function buildAgentPromptDraftRequest(
	input: AgentPromptDraftInput,
): string {
	const name = input.name?.trim() || "unnamed-agent";
	const description = input.description?.trim() || "No description provided.";
	const agentClass = input.agentClass || "implementer";
	const existingPrompt = input.existingPrompt?.trim();

	return [
		"Draft a concise, production-ready system prompt for a spawned Pi child agent.",
		"Return only the drafted agent prompt. Do not wrap it in markdown fences. Do not explain your reasoning.",
		"",
		"Agent configuration:",
		`- Name: ${name}`,
		`- Description: ${description}`,
		`- Agent class: ${agentClass}`,
		`- Model: ${input.model?.trim() || "default/current"}`,
		`- Thinking level: ${input.thinking?.trim() || "default"}`,
		`- Skill templates: ${formatList(input.skillTemplates)}`,
		`- Extension templates: ${formatList(input.extensionTemplates)}`,
		"",
		"Prompt requirements:",
		"- Start with a clear role statement tailored to the agent class and description.",
		"- Describe the agent's responsibilities, boundaries, and expected output style.",
		"- Reference the selected skill and extension templates as capabilities to use when relevant, without inventing unavailable tool names.",
		"- Keep instructions operational and specific; avoid marketing language.",
		"- Emphasize concise evidence, exact file/symbol references, risks, and unknowns when doing research or review.",
		"- Reiterate the Issue Handoff Artifacts protocol so the agent writes role-appropriate handoff files when an issue artifact workspace is provided.",
		"- Tell the agent not to modify tracker state or durable knowledge unless explicitly instructed by the root orchestrator.",
		"",
		"Issue Handoff Artifacts protocol excerpt to incorporate consistently:",
		sampleArtifactInstructions(agentClass),
		existingPrompt ? `\nExisting prompt draft:\n${existingPrompt}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export function normalizeDraftPromptOutput(text: string): string {
	let result = text.trim();
	const fenced = result.match(
		/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i,
	);
	if (fenced) result = fenced[1].trim();
	return result;
}

export async function draftAgentPrompt(
	options: DraftAgentPromptOptions,
): Promise<string> {
	const systemPromptPath = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-prompt-draft-")),
		"system.md",
	);
	fs.writeFileSync(
		systemPromptPath,
		"You draft high-quality system prompts for specialized Pi child agents. Return only the requested prompt text.",
		{ encoding: "utf-8", mode: 0o600 },
	);

	const args = [
		"--mode",
		"rpc",
		"--no-session",
		"--no-extensions",
		"--system-prompt",
		systemPromptPath,
	];
	if (options.model?.trim()) args.push("--model", options.model.trim());
	const invocation = getPiInvocation(args);
	const request = buildAgentPromptDraftRequest(options);
	const timeoutMs = options.timeoutMs || 45_000;

	return new Promise<string>((resolve, reject) => {
		const proc = spawn(invocation.command, invocation.args, {
			cwd: options.repoCwd,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdoutBuffer = "";
		let stderr = "";
		let settled = false;
		let promptAccepted = false;
		const timer = setTimeout(() => {
			finish(new Error(`Prompt draft timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		function cleanup() {
			clearTimeout(timer);
			try {
				proc.kill("SIGTERM");
			} catch {
				/* ignore */
			}
			try {
				fs.rmSync(path.dirname(systemPromptPath), {
					recursive: true,
					force: true,
				});
			} catch {
				/* ignore */
			}
		}

		function finish(err?: Error, value?: string) {
			if (settled) return;
			settled = true;
			cleanup();
			if (err) reject(err);
			else resolve(value || "");
		}

		function handleLine(line: string) {
			if (!line.trim()) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type === "response" && event.id === "draft_prompt") {
				if (event.success) promptAccepted = true;
				else finish(new Error(event.error || "Prompt draft request failed"));
				return;
			}
			if (event.type === "agent_end") {
				const msgs = event.messages || [];
				const lastAssistant = [...msgs]
					.reverse()
					.find((message: any) => message.role === "assistant");
				const text =
					lastAssistant?.content
						?.filter((part: any) => part.type === "text")
						.map((part: any) => part.text)
						.join("") || "";
				finish(undefined, normalizeDraftPromptOutput(text));
			}
		}

		proc.stdout?.on("data", (data: Buffer) => {
			stdoutBuffer += data.toString();
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() || "";
			for (const line of lines) handleLine(line);
		});
		proc.stderr?.on("data", (data: Buffer) => {
			stderr += data.toString();
		});
		proc.on("error", (err) => finish(err));
		proc.on("close", (code) => {
			if (!settled && code !== 0) {
				finish(
					new Error(
						stderr.trim() || `Prompt draft process exited with code ${code}`,
					),
				);
			} else if (!settled && !promptAccepted) {
				finish(
					new Error("Prompt draft process exited before accepting the prompt"),
				);
			}
		});

		proc.stdin?.write(
			`${JSON.stringify({ type: "prompt", id: "draft_prompt", message: request })}\n`,
		);
	});
}
