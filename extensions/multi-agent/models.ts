import { spawnSync } from "node:child_process";

export interface AvailableModelInfo {
	provider: string;
	id: string;
	/** Provider-qualified pattern to pass back to pi, e.g. openai-codex/gpt-5.5. */
	pattern: string;
	context: string;
	maxOut: string;
	thinking: boolean;
	images: boolean;
	thinkingLevels?: Array<
		"off" | "minimal" | "low" | "medium" | "high" | "xhigh"
	>;
}

/**
 * Discovers models available to the current Pi installation
 * by running `pi --list-models` and parsing the output table.
 */
let cachedModels: AvailableModelInfo[] | null = null;

export function getAvailableModelInfos(): AvailableModelInfo[] {
	if (cachedModels) {
		return cachedModels;
	}

	try {
		// Try common locations for the pi binary
		const candidates = [
			"pi",
			process.env.HOME + "/.bun/bin/pi",
			"/home/ubuntu/.bun/bin/pi",
			"/usr/local/bin/pi",
		];
		let stdout = "";
		for (const cmd of candidates) {
			const result = spawnSync(cmd, ["--list-models"], {
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 10_000,
			});
			if (
				result.status === 0 &&
				(result.stdout.trim().length > 0 || result.stderr.trim().length > 0)
			) {
				stdout =
					result.stdout.trim().length > 0 ? result.stdout : result.stderr;
				break;
			}
		}
		if (!stdout) {
			console.error("[models] Could not run pi --list-models");
			return [];
		}

		const models = parseListModelsOutput(stdout);
		cachedModels = models;
		return models;
	} catch (err) {
		console.error("[models] Failed to discover models:", err);
		return [];
	}
}

export function getAvailableModels(): string[] {
	return getAvailableModelInfos().map((m) => m.pattern);
}

export function parseListModelsOutput(output: string): AvailableModelInfo[] {
	const lines = output.split("\n");
	const headerIndex = lines.findIndex((line) => {
		const normalized = line.trim().replace(/\s+/g, " ");
		return normalized.startsWith("provider model context");
	});

	if (headerIndex === -1) return [];

	const models: AvailableModelInfo[] = [];
	const seen = new Set<string>();
	for (let i = headerIndex + 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const parts = line.split(/\s+/);
		// Real rows have: provider, model, context, max-out, thinking, images
		if (parts.length < 6) continue;

		const [provider, id, context, maxOut, thinkingRaw, imagesRaw] = parts;
		if (!/^(yes|no)$/.test(thinkingRaw) || !/^(yes|no)$/.test(imagesRaw))
			continue;
		const pattern = provider ? `${provider}/${id}` : id;
		if (!id || seen.has(pattern)) continue;

		const thinking = thinkingRaw === "yes";
		models.push({
			provider,
			id,
			pattern,
			context,
			maxOut,
			thinking,
			images: imagesRaw === "yes",
			thinkingLevels: thinking
				? ["off", "minimal", "low", "medium", "high", "xhigh"]
				: undefined,
		});
		seen.add(pattern);
	}
	return models;
}

export function clearModelCache() {
	cachedModels = null;
}
