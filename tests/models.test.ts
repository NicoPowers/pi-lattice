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

    expect(parseListModelsOutput(output)).toEqual(["gemini-2.5-flash", "kimi-k2.6"]);
  });

  it("returns empty array when no table header is present", () => {
    expect(parseListModelsOutput("Use /orchestrate\nDashboard: /dashboard")).toEqual([]);
  });
});
