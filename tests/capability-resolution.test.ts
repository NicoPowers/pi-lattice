import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AgentDefinition } from "../extensions/multi-agent/state.js";

describe("capability resolution", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cap-test-"));
    originalHome = process.env.HOME || "";
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("combines direct skills with applyToAll and selected skill templates", async () => {
    const { saveSkillTemplate } = await import("../extensions/multi-agent/skill-templates.js");
    const { resolveCapabilities } = await import("../extensions/multi-agent/capability-resolution.js");

    saveSkillTemplate({ name: "common", description: "Common", items: ["tdd"], applyToAll: true }, tmpDir);
    saveSkillTemplate({ name: "frontend", description: "Frontend", items: ["react", "tdd"] }, tmpDir);
    saveSkillTemplate({ name: "unused", description: "Unused", items: ["unused"] }, tmpDir);

    const definition: AgentDefinition = {
      name: "coder",
      description: "Coder",
      skills: ["direct"],
      skillTemplates: ["frontend"],
      systemPrompt: "",
      source: "project",
      filePath: path.join(tmpDir, ".pi", "agents", "coder.md"),
    };

    const result = resolveCapabilities({ cwd: tmpDir, definition, availableExtensions: [] });
    expect(result.skills?.map((skill) => path.basename(skill))).toEqual(["direct", "tdd", "react"]);
  });

  it("resolves Orchestrator Library skill refs to concrete skill paths", async () => {
    const { saveSkillTemplate } = await import("../extensions/multi-agent/skill-templates.js");
    const { resolveCapabilities } = await import("../extensions/multi-agent/capability-resolution.js");
    const { ORCHESTRATOR_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/orchestrator-library.js");

    const libraryRoot = path.join(tmpDir, "team-library");
    fs.mkdirSync(path.join(libraryRoot, "skills", "example-analysis"), { recursive: true });
    fs.writeFileSync(path.join(libraryRoot, "orchestrator-library.json"), JSON.stringify({ schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "team", resources: {} }));
    fs.writeFileSync(path.join(libraryRoot, "skills", "example-analysis", "SKILL.md"), "---\nname: example-analysis\ndescription: Example analysis\n---\n");
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), JSON.stringify({ piAgentOrchestrator: { libraries: ["./team-library"] } }));
    saveSkillTemplate({ name: "team-skills", description: "Team", items: ["team:skills/example-analysis"] }, tmpDir);

    const definition: AgentDefinition = {
      name: "coder",
      description: "Coder",
      skillTemplates: ["team-skills"],
      systemPrompt: "",
      source: "project",
      filePath: "",
    };

    const result = resolveCapabilities({ cwd: tmpDir, definition, availableExtensions: [] });
    expect(result.skills).toEqual([path.join(libraryRoot, "skills", "example-analysis", "SKILL.md")]);
    expect(result.skillConflicts).toEqual([]);
  });

  it("reports conflicting runtime skill names in resolved skill sets", async () => {
    const { resolveCapabilities } = await import("../extensions/multi-agent/capability-resolution.js");
    const one = path.join(tmpDir, "one");
    const two = path.join(tmpDir, "two");
    fs.mkdirSync(one, { recursive: true });
    fs.mkdirSync(two, { recursive: true });
    fs.writeFileSync(path.join(one, "SKILL.md"), "---\nname: duplicate\ndescription: One\n---\n");
    fs.writeFileSync(path.join(two, "SKILL.md"), "---\nname: duplicate\ndescription: Two\n---\n");

    const definition: AgentDefinition = {
      name: "coder",
      description: "Coder",
      skills: [one, two],
      systemPrompt: "",
      source: "project",
      filePath: "",
    };

    const result = resolveCapabilities({ cwd: tmpDir, definition, availableExtensions: [] });
    expect(result.skillConflicts).toEqual([{ name: "duplicate", paths: [one, two] }]);
  });

  it("combines requested extensions with applyToAll and selected extension templates", async () => {
    const { saveExtensionTemplate } = await import("../extensions/multi-agent/extension-templates.js");
    const { resolveCapabilities } = await import("../extensions/multi-agent/capability-resolution.js");

    saveExtensionTemplate({ name: "all", description: "All", items: ["logger"], applyToAll: true }, tmpDir);
    saveExtensionTemplate({ name: "web", description: "Web", items: ["browser", "missing"] }, tmpDir);

    const definition: AgentDefinition = {
      name: "researcher",
      description: "Researcher",
      extensionTemplates: ["web"],
      systemPrompt: "",
      source: "project",
      filePath: "",
    };

    const availableExtensions = [
      { name: "manual", path: "/ext/manual.ts", scope: "project" },
      { name: "logger", path: "/ext/logger.ts", scope: "project" },
      { name: "browser", path: "/ext/browser.ts", scope: "project" },
    ];

    const result = resolveCapabilities({ cwd: tmpDir, definition, requestedExtensions: ["manual", "browser"], availableExtensions });
    expect(result.extensions.map((extension) => extension.name)).toEqual(["manual", "browser", "logger"]);
    expect(result.missingExtensions).toEqual(["missing"]);
    expect(result.skillConflicts).toEqual([]);
  });
});
