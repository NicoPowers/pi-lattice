import * as fs from "node:fs";
import * as path from "node:path";

export type RoadmapIssueStatus = "open" | "in_progress" | "closed" | string;
export type RoadmapIssueType = "task" | "bug" | "feature" | "epic" | string;

export interface RoadmapIssue {
  id: string;
  title: string;
  type: RoadmapIssueType;
  status: RoadmapIssueStatus;
  priority: number;
  labels: string[];
  description: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  closeReason?: string;
  blocks: string[];
  blockedBy: string[];
}

export interface RoadmapDependency {
  id: string;
  title?: string;
  status: RoadmapIssueStatus | "unknown";
  type?: RoadmapIssueType;
  priority?: number;
}

export interface RoadmapOverview {
  source: {
    type: "seeds";
    path: string;
    exists: boolean;
  };
  generatedAt: string;
  issues: RoadmapIssue[];
  counts: {
    total: number;
    inProgress: number;
    ready: number;
    nextUp: number;
    blocked: number;
    backlog: number;
    closed: number;
  };
  groups: {
    inProgress: string[];
    ready: string[];
    nextUp: string[];
    blocked: string[];
    backlog: string[];
    closed: string[];
  };
  dependencyMap: {
    blockers: Record<string, RoadmapDependency[]>;
    unresolvedBlockers: Record<string, RoadmapDependency[]>;
    dependents: Record<string, RoadmapDependency[]>;
  };
}

interface BuildOptions {
  sourcePath?: string;
  sourceExists?: boolean;
  generatedAt?: string;
}

// Roadmap v1 is intentionally read-only and provider-shaped: the dashboard consumes
// Roadmap* DTOs, while this module is the only place that knows Seeds is the current
// backing source. A future SQLite/task provider should replace this reader without
// renaming the /api/roadmap contract or the web/features/roadmap UI.
export function readRoadmapOverview(repoCwd: string): RoadmapOverview {
  const issuesPath = path.join(repoCwd, ".seeds", "issues.jsonl");
  if (!fs.existsSync(issuesPath)) {
    return buildRoadmapOverviewFromIssues([], { sourcePath: issuesPath, sourceExists: false });
  }

  const issues = fs.readFileSync(issuesPath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return buildRoadmapOverviewFromIssues(issues, { sourcePath: issuesPath, sourceExists: true });
}

export function buildRoadmapOverviewFromIssues(rawIssues: unknown[], options: BuildOptions = {}): RoadmapOverview {
  const issues = rawIssues.map(normalizeIssue).filter((issue): issue is RoadmapIssue => issue !== undefined);
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const blockerIdsByIssue = new Map<string, Set<string>>();
  const dependentIdsByIssue = new Map<string, Set<string>>();

  for (const issue of issues) {
    ensureSet(blockerIdsByIssue, issue.id);
    ensureSet(dependentIdsByIssue, issue.id);

    for (const blockerId of issue.blockedBy) {
      ensureSet(blockerIdsByIssue, issue.id).add(blockerId);
      ensureSet(dependentIdsByIssue, blockerId).add(issue.id);
    }
    for (const dependentId of issue.blocks) {
      ensureSet(dependentIdsByIssue, issue.id).add(dependentId);
      ensureSet(blockerIdsByIssue, dependentId).add(issue.id);
    }
  }

  const dependencyMap: RoadmapOverview["dependencyMap"] = {
    blockers: {},
    unresolvedBlockers: {},
    dependents: {},
  };

  for (const issue of issues) {
    const blockers = Array.from(blockerIdsByIssue.get(issue.id) ?? []).map((id) => toDependency(id, issueById));
    const dependents = Array.from(dependentIdsByIssue.get(issue.id) ?? []).map((id) => toDependency(id, issueById));
    dependencyMap.blockers[issue.id] = blockers;
    dependencyMap.unresolvedBlockers[issue.id] = blockers.filter((blocker) => blocker.status !== "closed");
    dependencyMap.dependents[issue.id] = dependents;
  }

  const inProgress = sortIssueIds(issues.filter((issue) => issue.status === "in_progress"), dependencyMap);
  const closed = sortIssueIds(issues.filter((issue) => issue.status === "closed"), dependencyMap);
  const backlog = sortIssueIds(issues.filter((issue) => issue.status === "open"), dependencyMap);
  const blocked = sortIssueIds(issues.filter((issue) => issue.status !== "closed" && dependencyMap.unresolvedBlockers[issue.id]?.length), dependencyMap);
  const ready = sortIssueIds(issues.filter((issue) => issue.status === "open" && (dependencyMap.unresolvedBlockers[issue.id]?.length ?? 0) === 0), dependencyMap);

  return {
    source: {
      type: "seeds",
      path: options.sourcePath ?? path.join(".seeds", "issues.jsonl"),
      exists: options.sourceExists ?? true,
    },
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    issues,
    counts: {
      total: issues.length,
      inProgress: inProgress.length,
      ready: ready.length,
      nextUp: ready.length,
      blocked: blocked.length,
      backlog: backlog.length,
      closed: closed.length,
    },
    groups: {
      inProgress,
      ready,
      nextUp: ready,
      blocked,
      backlog,
      closed,
    },
    dependencyMap,
  };
}

function normalizeIssue(raw: unknown): RoadmapIssue | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Record<string, unknown>;
  const id = asString(input.id);
  if (!id) return undefined;

  return {
    id,
    title: asString(input.title) || id,
    type: asString(input.type) || "task",
    status: asString(input.status) || "open",
    priority: asNumber(input.priority, 2),
    labels: asStringArray(input.labels),
    description: asString(input.description) || "",
    createdAt: asString(input.createdAt) || undefined,
    updatedAt: asString(input.updatedAt) || undefined,
    closedAt: asString(input.closedAt) || undefined,
    closeReason: asString(input.closeReason) || undefined,
    blocks: asStringArray(input.blocks),
    blockedBy: asStringArray(input.blockedBy),
  };
}

function toDependency(id: string, issueById: Map<string, RoadmapIssue>): RoadmapDependency {
  const issue = issueById.get(id);
  if (!issue) return { id, status: "unknown" };
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    type: issue.type,
    priority: issue.priority,
  };
}

function sortIssueIds(issues: RoadmapIssue[], dependencyMap: RoadmapOverview["dependencyMap"]): string[] {
  return [...issues]
    .sort((a, b) => {
      const priority = a.priority - b.priority;
      if (priority !== 0) return priority;
      const updated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      if (updated !== 0) return updated;
      const blockerDelta = (dependencyMap.unresolvedBlockers[b.id]?.length ?? 0) - (dependencyMap.unresolvedBlockers[a.id]?.length ?? 0);
      if (blockerDelta !== 0) return blockerDelta;
      return a.id.localeCompare(b.id);
    })
    .map((issue) => issue.id);
}

function ensureSet(map: Map<string, Set<string>>, key: string): Set<string> {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}
