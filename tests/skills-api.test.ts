import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("skill discovery API", () => {
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
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
