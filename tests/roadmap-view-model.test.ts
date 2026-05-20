import { describe, expect, it } from "bun:test";
import { buildRoadmapHierarchy } from "../web/features/roadmap/roadmap-view-model.js";
import type { RoadmapOverview } from "../web/types.js";

describe("roadmap hierarchy view model", () => {
  it("groups implementation work under epics using dependency relationships and keeps unrelated issues ungrouped", () => {
    const overview = roadmapOverview([
      issue({ id: "epic-a", title: "Epic A", type: "epic", blocks: ["child-a", "closed-child"] }),
      issue({ id: "child-a", title: "Child A", priority: 1, blockedBy: ["epic-a"], blocks: ["dependent-a"] }),
      issue({ id: "closed-child", title: "Closed child", status: "closed", priority: 2, blockedBy: ["epic-a"] }),
      issue({ id: "dependent-a", title: "Dependent A", priority: 3, blockedBy: ["child-a"] }),
      issue({ id: "solo", title: "Solo", priority: 0 }),
    ]);

    const hierarchy = buildRoadmapHierarchy(overview);

    expect(hierarchy.epics).toHaveLength(1);
    expect(hierarchy.epics[0].epic.id).toBe("epic-a");
    expect(hierarchy.epics[0].activeChildren.map((item) => item.id)).toEqual(["child-a"]);
    expect(hierarchy.epics[0].closedChildren.map((item) => item.id)).toEqual(["closed-child"]);
    expect(hierarchy.ungrouped.map((item) => item.id)).toEqual(["solo", "dependent-a"]);
  });

  it("groups tracer work under a matching epic by distinctive shared labels when dependency links are absent", () => {
    const overview = roadmapOverview([
      issue({ id: "roadmap-epic", title: "Epic: Read-only Roadmap dashboard backed by Seeds", type: "epic", labels: ["dashboard", "roadmap", "epic"] }),
      issue({ id: "tracer-4", title: "Roadmap tracer 4: add read-only issue detail panel and filters", labels: ["dashboard", "roadmap", "frontend", "tracer"] }),
      issue({ id: "dashboard-only", title: "Unrelated dashboard task", labels: ["dashboard"] }),
    ]);

    const hierarchy = buildRoadmapHierarchy(overview);

    expect(hierarchy.epics[0].activeChildren.map((item) => item.id)).toEqual(["tracer-4"]);
    expect(hierarchy.ungrouped.map((item) => item.id)).toEqual(["dashboard-only"]);
  });

  it("keeps empty epics visible when they have no children", () => {
    const overview = roadmapOverview([
      issue({ id: "empty-epic", title: "Epic: Empty", type: "epic", labels: ["empty"] }),
    ]);

    const hierarchy = buildRoadmapHierarchy(overview);

    expect(hierarchy.epics).toHaveLength(1);
    expect(hierarchy.epics[0].activeChildren).toEqual([]);
    expect(hierarchy.epics[0].closedChildren).toEqual([]);
    expect(hierarchy.ungrouped).toEqual([]);
  });

  it("surfaces blocker and dependent metadata for issue badges", () => {
    const overview = roadmapOverview([
      issue({ id: "blocker", title: "Open blocker", status: "open", blocks: ["blocked"] }),
      issue({ id: "blocked", title: "Blocked", blockedBy: ["blocker", "missing"] }),
      issue({ id: "done", title: "Done", status: "closed", blocks: ["blocked"] }),
    ]);

    const hierarchy = buildRoadmapHierarchy(overview);
    const blocked = hierarchy.ungrouped.find((item) => item.id === "blocked");
    const blocker = hierarchy.ungrouped.find((item) => item.id === "blocker");

    expect(blocked?.unresolvedBlockers.map((item) => `${item.id}:${item.status}`)).toEqual(["blocker:open", "missing:unknown"]);
    expect(blocked?.resolvedBlockerCount).toBe(1);
    expect(blocker?.dependentCount).toBe(1);
  });
});

function roadmapOverview(issues: RoadmapOverview["issues"]): RoadmapOverview {
  const blockers: RoadmapOverview["dependencyMap"]["blockers"] = {};
  const unresolvedBlockers: RoadmapOverview["dependencyMap"]["unresolvedBlockers"] = {};
  const dependents: RoadmapOverview["dependencyMap"]["dependents"] = {};
  const byId = new Map(issues.map((item) => [item.id, item]));

  for (const item of issues) {
    const blockerIds = new Set(item.blockedBy);
    for (const other of issues) {
      if (other.blocks.includes(item.id)) blockerIds.add(other.id);
    }
    blockers[item.id] = Array.from(blockerIds).map((id) => dependency(id, byId));
    unresolvedBlockers[item.id] = blockers[item.id].filter((dep) => dep.status !== "closed");

    const dependentIds = new Set(item.blocks);
    for (const other of issues) {
      if (other.blockedBy.includes(item.id)) dependentIds.add(other.id);
    }
    dependents[item.id] = Array.from(dependentIds).map((id) => dependency(id, byId));
  }

  return {
    source: { type: "seeds", path: ".seeds/issues.jsonl", exists: true },
    generatedAt: "2026-05-20T00:00:00.000Z",
    issues,
    counts: { total: issues.length, inProgress: 0, ready: 0, nextUp: 0, blocked: 0, backlog: 0, closed: 0 },
    groups: { inProgress: [], ready: [], nextUp: [], blocked: [], backlog: [], closed: [] },
    dependencyMap: { blockers, unresolvedBlockers, dependents },
  };
}

function issue(overrides: Partial<RoadmapOverview["issues"][number]>): RoadmapOverview["issues"][number] {
  return {
    id: "issue",
    title: "Issue",
    type: "task",
    status: "open",
    priority: 2,
    labels: [],
    description: "",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    blocks: [],
    blockedBy: [],
    ...overrides,
  };
}

function dependency(id: string, byId: Map<string, RoadmapOverview["issues"][number]>): RoadmapOverview["dependencyMap"]["blockers"][string][number] {
  const item = byId.get(id);
  if (!item) return { id, status: "unknown" };
  return { id, title: item.title, status: item.status, type: item.type, priority: item.priority };
}
