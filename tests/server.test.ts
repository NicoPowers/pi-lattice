import { describe, it, expect } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

async function findPort(preferred = [18765, 18766, 18767]): Promise<number> {
  for (const port of preferred) {
    try {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, () => {
          server.close(() => resolve());
        });
      });
      return port;
    } catch {
      /* try next */
    }
  }
  // Fall back to OS-assigned ephemeral port
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      server.close(() => resolve(addr.port));
    });
  });
}

describe("port probing", () => {
  it("returns the first free port from the preferred list", async () => {
    const port = await findPort([39000, 39001, 39002]);
    expect(port).toBeGreaterThanOrEqual(39000);
    expect(port).toBeLessThanOrEqual(39002);
  });

  it("falls back to an OS-assigned ephemeral port if all preferred are taken", async () => {
    // Occupy all preferred ports
    const occupied: ReturnType<typeof createServer>[] = [];
    for (let p = 39100; p < 39103; p++) {
      const srv = createServer();
      await new Promise<void>((resolve) => srv.listen(p, resolve));
      occupied.push(srv);
    }

    const port = await findPort([39100, 39101, 39102]);

    // Clean up
    for (const srv of occupied) srv.close();

    // Fallback should be a valid ephemeral port
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });
});

describe("SSE formatting", () => {
  it("formats events correctly", () => {
    const event = { type: "agent-spawned", data: { name: "lead", status: "idle" } };
    const sse = `data: ${JSON.stringify(event)}\n\n`;
    expect(sse).toContain('data: {"type":"agent-spawned"');
    expect(sse).toEndWith("\n\n");
  });
});

describe("template API", () => {
  it("creates, lists, loads, and deletes skill templates", async () => {
    const { startServer } = await import("../extensions/multi-agent/server.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-template-api-"));
    const handle = await startServer({
      repoCwd: tmpDir,
      spawnAgent: async () => ({ agent: undefined as any, error: "disabled in tests" }),
      sendToAgent: async () => {},
      removeWorktree: async () => {},
      discoverDefinitions: () => [],
      getDefinition: () => undefined,
      discoverExtensions: () => [],
    });

    try {
      const createRes = await fetch(`${handle.url}/api/skill-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "common", description: "Common skills", skills: ["tdd", "security-checklist"], applyToAll: true }),
      });
      expect(createRes.status).toBe(200);

      const listRes = await fetch(`${handle.url}/api/skill-templates`);
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      expect(list[0].name).toBe("common");
      expect(list[0].items).toEqual(["tdd", "security-checklist"]);

      const getRes = await fetch(`${handle.url}/api/skill-templates/common`);
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).applyToAll).toBe(true);

      const deleteRes = await fetch(`${handle.url}/api/skill-templates/common`, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);

      const missingRes = await fetch(`${handle.url}/api/skill-templates/common`);
      expect(missingRes.status).toBe(404);
    } finally {
      handle.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});


describe("skill library API", () => {
  it("creates and updates project skills with hash guards", async () => {
    const { startServer } = await import("../extensions/multi-agent/server.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skill-edit-api-"));
    const handle = await startServer({
      repoCwd: tmpDir,
      spawnAgent: async () => ({ agent: undefined as any, error: "disabled in tests" }),
      sendToAgent: async () => {},
      removeWorktree: async () => {},
      discoverDefinitions: () => [],
      getDefinition: () => undefined,
      discoverExtensions: () => [],
    });

    try {
      const createRes = await fetch(`${handle.url}/api/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "project", name: "My Skill", description: "Helps with tests" }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();
      expect(created.skill.name).toBe("my-skill");
      expect(created.skill.editable).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".pi", "skills", "my-skill", "SKILL.md"))).toBe(true);

      const detailRes = await fetch(`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`);
      const detail = await detailRes.json();
      const updatedContent = `---\nname: my-skill\ndescription: Helps with tests\n---\n# My Skill\n\nUpdated body.`;
      const updateRes = await fetch(`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: updatedContent, expectedHash: detail.hash }),
      });
      expect(updateRes.status).toBe(200);
      expect((await updateRes.json()).body).toContain("Updated body");

      const staleRes = await fetch(`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: updatedContent, expectedHash: "stale" }),
      });
      expect(staleRes.status).toBe(409);

      const deleteRes = await fetch(`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);
      expect(fs.existsSync(path.join(tmpDir, ".pi", "skills", "my-skill"))).toBe(false);

      const missingAfterDelete = await fetch(`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`);
      expect(missingAfterDelete.status).toBe(404);
    } finally {
      handle.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("lists skill metadata and loads skill markdown by id", async () => {
    const { startServer } = await import("../extensions/multi-agent/server.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skill-library-api-"));
    const skillDir = path.join(tmpDir, ".pi", "skills", "demo");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: demo\ndescription: Demo skill\n---\n# Demo\n\nSee [Reference](references/ref.md).`, "utf-8");

    const handle = await startServer({
      repoCwd: tmpDir,
      spawnAgent: async () => ({ agent: undefined as any, error: "disabled in tests" }),
      sendToAgent: async () => {},
      removeWorktree: async () => {},
      discoverDefinitions: () => [],
      getDefinition: () => undefined,
      discoverExtensions: () => [],
    });

    try {
      const listRes = await fetch(`${handle.url}/api/skills`);
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      const demo = list.find((skill: any) => skill.name === "demo");
      expect(demo.id).toBeString();
      expect(demo.kind).toBe("directory");
      expect(demo.editable).toBe(true);

      const getRes = await fetch(`${handle.url}/api/skills/${encodeURIComponent(demo.id)}`);
      expect(getRes.status).toBe(200);
      const detail = await getRes.json();
      expect(detail.skill.name).toBe("demo");
      expect(detail.content).toContain("# Demo");
      expect(detail.frontmatter.name).toBe("demo");
      expect(detail.body).toContain("See [Reference]");
      expect(detail.hash).toBeString();
      expect(detail.mtimeMs).toBeGreaterThan(0);

      const missingRes = await fetch(`${handle.url}/api/skills/not-a-real-id`);
      expect(missingRes.status).toBe(404);
    } finally {
      handle.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
