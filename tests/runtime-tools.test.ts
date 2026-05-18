import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("runtime tool snapshots", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-runtime-tools-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined for missing snapshots", async () => {
    const { readRuntimeToolSnapshot } = await import("../extensions/multi-agent/runtime-tools.js");
    expect(readRuntimeToolSnapshot(tmpDir)).toBeUndefined();
  });

  it("parses and dedupes valid snapshots", async () => {
    const { readRuntimeToolSnapshot, runtimeToolsPath } = await import("../extensions/multi-agent/runtime-tools.js");
    const filePath = runtimeToolsPath(tmpDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      active: [{ name: "read", description: "Read" }, { name: "read" }, { name: "bash" }],
      all: [{ name: "read" }, { name: "bash" }, { name: "custom", sourceInfo: { source: "extension" } }],
      reportedAt: 123,
      source: "child-agent",
    }), "utf-8");

    const snapshot = readRuntimeToolSnapshot(tmpDir);
    expect(snapshot?.active.map((tool) => tool.name)).toEqual(["read", "bash"]);
    expect(snapshot?.all.map((tool) => tool.name)).toEqual(["read", "bash", "custom"]);
    expect(snapshot?.reportedAt).toBe(123);
  });

  it("tolerates malformed snapshots", async () => {
    const { readRuntimeToolSnapshot, runtimeToolsPath } = await import("../extensions/multi-agent/runtime-tools.js");
    const filePath = runtimeToolsPath(tmpDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "not json", "utf-8");
    expect(readRuntimeToolSnapshot(tmpDir)).toBeUndefined();
  });
});
