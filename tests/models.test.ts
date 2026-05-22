import { describe, expect, it } from "bun:test";
import { parseListModelsOutput } from "../extensions/multi-agent/models.js";

describe("model discovery parsing", () => {
	it("ignores extension startup noise before the model table", () => {
		const output = `🎛️  Multi-agent extension loaded. Normal Pi mode is active.
   Use /orchestrate to enter orchestration mode when you want Pi to spawn specialist agents.
   Dashboard: /dashboard  |  Emergency stop: 🛑 button or /kill all
provider      model                 context  max-out  thinking  images
google        gemini-2.5-flash       1.0M     65.5K    yes       yes
moonshotai    kimi-k2.6              262.1K   262.1K   yes       yes
`;

		expect(parseListModelsOutput(output)).toEqual([
			{
				provider: "google",
				id: "gemini-2.5-flash",
				pattern: "google/gemini-2.5-flash",
				context: "1.0M",
				maxOut: "65.5K",
				thinking: true,
				images: true,
				thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
			},
			{
				provider: "moonshotai",
				id: "kimi-k2.6",
				pattern: "moonshotai/kimi-k2.6",
				context: "262.1K",
				maxOut: "262.1K",
				thinking: true,
				images: true,
				thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
			},
		]);
	});

	it("keeps duplicate model IDs distinct by provider", () => {
		const output = `provider      model     context  max-out  thinking  images
openai-codex gpt-5.5   272K     128K     yes       yes
azure-openai-responses gpt-5.5  272K     128K     yes       yes
`;

		expect(parseListModelsOutput(output).map((model) => model.pattern)).toEqual(
			["openai-codex/gpt-5.5", "azure-openai-responses/gpt-5.5"],
		);
	});

	it("returns empty array when no table header is present", () => {
		expect(
			parseListModelsOutput("Use /orchestrate\nDashboard: /dashboard"),
		).toEqual([]);
	});
});
