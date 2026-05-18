import { spawnSync } from "node:child_process";

/**
 * Discovers models available to the current Pi installation
 * by running `pi --list-models` and parsing the output table.
 */
let cachedModels: string[] | null = null;

export function getAvailableModels(): string[] {
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
      if (result.status === 0 && (result.stdout.trim().length > 0 || result.stderr.trim().length > 0)) {
        stdout = result.stdout.trim().length > 0 ? result.stdout : result.stderr;
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

export function parseListModelsOutput(output: string): string[] {
  const lines = output.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const normalized = line.trim().replace(/\s+/g, " ");
    return normalized.startsWith("provider model context");
  });

  if (headerIndex === -1) return [];

  const models: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    // Real rows have: provider, model, context, max-out, thinking, images
    if (parts.length < 6) continue;

    const model = parts[1];
    const thinking = parts[4];
    const images = parts[5];
    if (!/^(yes|no)$/.test(thinking) || !/^(yes|no)$/.test(images)) continue;

    if (model && !models.includes(model)) {
      models.push(model);
    }
  }
  return models;
}

export function clearModelCache() {
  cachedModels = null;
}
