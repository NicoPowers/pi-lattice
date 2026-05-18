import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function makePiHarness() {
  const tools: any[] = [];
  const commands: any[] = [];
  const handlers: Record<string, any[]> = {};
  return {
    tools,
    commands,
    pi: {
      on: (event: string, handler: any) => {
        handlers[event] = [...(handlers[event] || []), handler];
      },
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: (name: string, command: any) => commands.push({ name, command }),
      sendUserMessage: () => {},
      sendMessage: () => {},
    },
  };
}

describe("skill management tools", () => {
  it("creates, lists, reads, and updates editable project skills", async () => {
    const extension = (await import("../extensions/multi-agent/index.js")).default;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skill-tools-"));
    const harness = makePiHarness();
    extension(harness.pi as any);

    const tool = (name: string) => {
      const found = harness.tools.find((candidate) => candidate.name === name);
      expect(found).toBeDefined();
      return found;
    };

    try {
      const create = await tool("skill_create").execute("1", { scope: "project", name: "Tool Skill", description: "Created by tool" }, undefined, undefined, { cwd: tmpDir });
      expect(create.isError).toBeUndefined();
      expect(create.details.skill.name).toBe("tool-skill");

      const list = await tool("skill_list").execute("2", { editableOnly: true }, undefined, undefined, { cwd: tmpDir });
      expect(list.details.skills.some((skill: any) => skill.name === "tool-skill")).toBe(true);

      const read = await tool("skill_read").execute("3", { name: "tool-skill" }, undefined, undefined, { cwd: tmpDir });
      expect(read.details.detail.content).toContain("name: tool-skill");

      const updatedContent = read.details.detail.content.replace("## Workflow", "## Updated Workflow");
      const update = await tool("skill_update").execute("4", { id: read.details.detail.skill.id, content: updatedContent, expectedHash: read.details.detail.hash }, undefined, undefined, { cwd: tmpDir });
      expect(update.isError).toBeUndefined();
      expect(update.details.detail.body).toContain("Updated Workflow");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
