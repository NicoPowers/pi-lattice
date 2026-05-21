import type { RoadmapDependency, RoadmapIssue, RoadmapOverview } from "../../types.js";

export interface RoadmapIssueView extends RoadmapIssue {
  unresolvedBlockers: RoadmapDependency[];
  resolvedBlockerCount: number;
  dependentCount: number;
}

export interface RoadmapEpicGroup {
  epic: RoadmapIssueView;
  activeChildren: RoadmapIssueView[];
  closedChildren: RoadmapIssueView[];
}

export interface RoadmapHierarchy {
  epics: RoadmapEpicGroup[];
  ungrouped: RoadmapIssueView[];
}

export interface RoadmapTaskBuckets {
  inProgress: RoadmapIssueView[];
  ready: RoadmapIssueView[];
  blocked: RoadmapIssueView[];
  backlog: RoadmapIssueView[];
  closed: RoadmapIssueView[];
}

export interface SplitEpicGroups {
  active: RoadmapEpicGroup[];
  closed: RoadmapEpicGroup[];
}

export function buildRoadmapHierarchy(overview: RoadmapOverview): RoadmapHierarchy {
  const issueViews = overview.issues.map((issue) => toIssueView(issue, overview));
  const byId = new Map(issueViews.map((issue) => [issue.id, issue]));
  const epics = issueViews.filter((issue) => issue.type === "epic");
  const assigned = new Set<string>();

  const epicGroups = epics.map((epic) => {
    assigned.add(epic.id);
    const childIds = new Set<string>();
    for (const dependent of overview.dependencyMap.dependents[epic.id] || []) childIds.add(dependent.id);
    for (const blocker of overview.dependencyMap.blockers[epic.id] || []) childIds.add(blocker.id);
    for (const blockedId of epic.blocks) childIds.add(blockedId);
    for (const blockerId of epic.blockedBy) childIds.add(blockerId);

    const children = Array.from(childIds)
      .map((id) => byId.get(id))
      .filter((issue): issue is RoadmapIssueView => !!issue && issue.id !== epic.id && issue.type !== "epic");
    for (const child of children) assigned.add(child.id);

    return {
      epic,
      activeChildren: children.filter((issue) => issue.status !== "closed"),
      closedChildren: children.filter((issue) => issue.status === "closed"),
    };
  });

  for (const issue of issueViews) {
    if (assigned.has(issue.id) || issue.type === "epic") continue;
    const group = bestInferredEpicGroup(issue, epicGroups);
    if (!group) continue;
    assigned.add(issue.id);
    if (issue.status === "closed") group.closedChildren.push(issue);
    else group.activeChildren.push(issue);
  }

  for (const group of epicGroups) {
    group.activeChildren = sortIssueViews(group.activeChildren);
    group.closedChildren = sortIssueViews(group.closedChildren);
  }

  const ungrouped = sortIssueViews(issueViews.filter((issue) => !assigned.has(issue.id)));
  return { epics: sortEpicGroups(epicGroups), ungrouped };
}

function toIssueView(issue: RoadmapIssue, overview: RoadmapOverview): RoadmapIssueView {
  const blockers = overview.dependencyMap.blockers[issue.id] || [];
  const unresolvedBlockers = overview.dependencyMap.unresolvedBlockers[issue.id] || [];
  return {
    ...issue,
    unresolvedBlockers,
    resolvedBlockerCount: Math.max(0, blockers.length - unresolvedBlockers.length),
    dependentCount: (overview.dependencyMap.dependents[issue.id] || []).length,
  };
}

function sortEpicGroups(groups: RoadmapEpicGroup[]): RoadmapEpicGroup[] {
  return [...groups].sort((a, b) => compareIssues(a.epic, b.epic));
}

function bestInferredEpicGroup(issue: RoadmapIssueView, groups: RoadmapEpicGroup[]): RoadmapEpicGroup | undefined {
  let best: { group: RoadmapEpicGroup; score: number } | undefined;
  for (const group of groups) {
    if (group.epic.status === "closed" && issue.status !== "closed") continue;
    const score = epicAffinityScore(issue, group.epic);
    if (score <= 0) continue;
    if (!best || score > best.score || (score === best.score && compareIssues(group.epic, best.group.epic) < 0)) best = { group, score };
  }
  return best?.group;
}

function epicAffinityScore(issue: RoadmapIssueView, epic: RoadmapIssueView): number {
  const issueLabels = distinctiveLabels(issue.labels);
  const epicLabels = distinctiveLabels(epic.labels);
  const sharedLabels = issueLabels.filter((label) => epicLabels.includes(label)).length;
  if (sharedLabels > 0) return sharedLabels * 10;

  const issueTokens = titleTokens(issue.title);
  const epicTokens = titleTokens(epic.title);
  const sharedTokens = issueTokens.filter((token) => epicTokens.includes(token)).length;
  return sharedTokens >= 2 ? sharedTokens : 0;
}

function distinctiveLabels(labels: string[]): string[] {
  const generic = new Set(["epic", "tracer", "dashboard", "frontend", "backend", "ux", "docs", "tests", "architecture", "dependencies", "next-up"]);
  return labels.map((label) => label.toLowerCase()).filter((label) => !generic.has(label));
}

function titleTokens(title: string): string[] {
  const generic = new Set(["epic", "tracer", "add", "read", "only", "with", "and", "the", "for"]);
  return title.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !generic.has(token));
}

export function sortIssueViews(issues: RoadmapIssueView[]): RoadmapIssueView[] {
  return [...issues].sort(compareIssues);
}

export function splitEpicGroups(hierarchy: RoadmapHierarchy): SplitEpicGroups {
  return {
    active: hierarchy.epics.filter((group) => group.epic.status !== "closed"),
    closed: hierarchy.epics.filter((group) => group.epic.status === "closed"),
  };
}

export function bucketEpicTasks(group: RoadmapEpicGroup, overview: RoadmapOverview): RoadmapTaskBuckets {
  const buckets: RoadmapTaskBuckets = { inProgress: [], ready: [], blocked: [], backlog: [], closed: [] };
  for (const issue of [...group.activeChildren, ...group.closedChildren]) {
    if (issue.status === "closed") buckets.closed.push(issue);
    else if (issue.status === "in_progress") buckets.inProgress.push(issue);
    else if (issue.unresolvedBlockers.length) buckets.blocked.push(issue);
    else if (overview.groups.ready.includes(issue.id) || overview.groups.nextUp.includes(issue.id)) buckets.ready.push(issue);
    else buckets.backlog.push(issue);
  }
  return {
    inProgress: sortIssueViews(buckets.inProgress),
    ready: sortIssueViews(buckets.ready),
    blocked: sortIssueViews(buckets.blocked),
    backlog: sortIssueViews(buckets.backlog),
    closed: sortIssueViews(buckets.closed),
  };
}

function compareIssues(a: RoadmapIssueView, b: RoadmapIssueView): number {
  const status = statusWeight(a.status) - statusWeight(b.status);
  if (status !== 0) return status;
  const priority = a.priority - b.priority;
  if (priority !== 0) return priority;
  const updated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  if (updated !== 0) return updated;
  return a.id.localeCompare(b.id);
}

function statusWeight(status: string): number {
  if (status === "in_progress") return 0;
  if (status === "open") return 1;
  if (status === "closed") return 2;
  return 3;
}
