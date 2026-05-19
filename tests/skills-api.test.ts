import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("skill discovery API", () => {
  it("returns discovery diagnostics for invalid skills", async () => {
    const { discoverSkillDiagnostics } = await import("../extensions/multi-agent/skill-discovery.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skills-diagnostics-"));
    try {
      const skillDir = path.join(tmpDir, ".pi", "skills", "bad");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: Bad Skill\ndescription: Bad name\n---\nBody.`, "utf-8");
      const diagnostics = await discoverSkillDiagnostics(tmpDir);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((diagnostic) => diagnostic.message.toLowerCase().includes("invalid"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("discovers Orchestrator Library skills", async () => {
    const { discoverSkills } = await import("../extensions/multi-agent/skill-discovery.js");
    const { ORCHESTRATOR_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/orchestrator-library.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-library-skill-discovery-"));
    try {
      const libraryRoot = path.join(tmpDir, "team-library");
      fs.mkdirSync(path.join(libraryRoot, "skills", "example-analysis"), { recursive: true });
      fs.writeFileSync(path.join(libraryRoot, "orchestrator-library.json"), JSON.stringify({ schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "team", resources: {} }));
      fs.writeFileSync(path.join(libraryRoot, "skills", "example-analysis", "SKILL.md"), "---\nname: example-analysis\ndescription: Example analysis\n---\n");
      fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), JSON.stringify({ piAgentOrchestrator: { libraries: ["./team-library"] } }));

      const skills = await discoverSkills(tmpDir);
      const skill = skills.find((candidate) => candidate.name === "example-analysis");
      expect(skill).toBeDefined();
      expect(skill?.source).toBe("orchestrator-library");
      expect(skill?.scope).toBe("team");
      expect(skill?.editable).toBe(true);
      expect(skill?.ref).toBe("team:skills/example-analysis/SKILL.md");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("discovers project skills", async () => {
    const { discoverSkills } = await import("../extensions/multi-agent/skill-discovery.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skills-api-"));
    try {
      const skillDir = path.join(tmpDir, ".pi", "skills", "demo");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: demo\ndescription: Demo skill\n---\nUse demo.`, "utf-8");
      const skills = await discoverSkills(tmpDir);
      const demo = skills.find((skill) => skill.name === "demo");
      expect(demo?.description).toBe("Demo skill");
      expect(demo?.path).toEndWith(path.join("demo", "SKILL.md"));
      expect(demo?.id).toBeString();
      expect(demo?.baseDir).toEndWith("demo");
      expect(demo?.kind).toBe("directory");
      expect(demo?.editable).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
