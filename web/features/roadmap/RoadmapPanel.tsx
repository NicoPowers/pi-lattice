import { useEffect, useState } from "react";
import type { RoadmapDependency, RoadmapOverview } from "../../types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { buildRoadmapHierarchy, sortIssueViews, type RoadmapHierarchy, type RoadmapIssueView } from "./roadmap-view-model.js";

interface RoadmapPanelProps {
  pushLog?: (text: string, level?: "info" | "success" | "warn" | "error") => void;
}

const summaryCards: Array<{ key: keyof RoadmapOverview["counts"]; label: string; tone: "default" | "success" | "warning" | "destructive" | "outline" }> = [
  { key: "inProgress", label: "In Progress", tone: "default" },
  { key: "nextUp", label: "Next Up", tone: "success" },
  { key: "blocked", label: "Blocked", tone: "destructive" },
  { key: "backlog", label: "Backlog / Open", tone: "warning" },
  { key: "closed", label: "Closed", tone: "outline" },
];

export function RoadmapPanel({ pushLog }: RoadmapPanelProps) {
  const [overview, setOverview] = useState<RoadmapOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/roadmap");
      if (!res.ok) throw new Error(await res.text());
      setOverview(await res.json());
    } catch (err: any) {
      const message = err?.message || "Failed to load roadmap";
      setError(message);
      pushLog?.(`Failed to load roadmap: ${message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return <Card className="min-h-[70vh]">
    <CardHeader className="border-b border-border">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Project Roadmap</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Read-only project status derived from the current roadmap source.</p>
        </div>
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={refresh} disabled={loading}>Refresh</Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-4 pt-4">
      {loading && <div className="rounded-md border border-border bg-card/50 p-4 text-sm text-muted-foreground">Loading roadmap…</div>}
      {!loading && error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
      {!loading && !error && overview && <RoadmapSummary overview={overview} />}
    </CardContent>
  </Card>;
}

function RoadmapSummary({ overview }: { overview: RoadmapOverview }) {
  const hierarchy = buildRoadmapHierarchy(overview);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Badge variant="outline">{overview.counts.total} total</Badge>
      <span>Source: {overview.source.exists ? "loaded" : "missing"}</span>
      <span className="truncate">{overview.source.path}</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {summaryCards.map((item) => <div key={item.key} className="rounded-md border border-border bg-background/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{item.label}</div>
          <Badge variant={item.tone}>{overview.counts[item.key]}</Badge>
        </div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">{overview.counts[item.key]}</div>
      </div>)}
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <QueuePreview title="Next Up" issueIds={overview.groups.nextUp} overview={overview} emptyText="No ready work found." />
      <QueuePreview title="Blocked" issueIds={overview.groups.blocked} overview={overview} emptyText="No blocked work found." />
    </div>
    <RoadmapHierarchyView hierarchy={hierarchy} />
  </div>;
}

function QueuePreview({ title, issueIds, overview, emptyText }: { title: string; issueIds: string[]; overview: RoadmapOverview; emptyText: string }) {
  const hierarchy = buildRoadmapHierarchy(overview);
  const issueViewsById = new Map([...hierarchy.epics.flatMap((group) => [group.epic, ...group.activeChildren, ...group.closedChildren]), ...hierarchy.ungrouped].map((issue) => [issue.id, issue]));
  const visibleIssues = issueIds.map((id) => issueViewsById.get(id)).filter((issue): issue is RoadmapIssueView => !!issue).slice(0, 5);
  return <div className="rounded-md border border-border p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Badge variant="outline">{issueIds.length}</Badge>
    </div>
    {visibleIssues.length ? <div className="space-y-2">
      {visibleIssues.map((issue) => <IssueCard key={issue.id} issue={issue} compact />)}
      {issueIds.length > visibleIssues.length && <div className="text-xs text-muted-foreground">+ {issueIds.length - visibleIssues.length} more</div>}
    </div> : <p className="text-sm text-muted-foreground">{emptyText}</p>}
  </div>;
}

function RoadmapHierarchyView({ hierarchy }: { hierarchy: RoadmapHierarchy }) {
  return <div className="space-y-3 rounded-md border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">Epic Roadmap</h3>
        <p className="mt-1 text-xs text-muted-foreground">Epics are shown as top-level groups; direct dependency links become child roadmap items.</p>
      </div>
      <Badge variant="outline">{hierarchy.epics.length} epics</Badge>
    </div>
    {hierarchy.epics.length ? <div className="space-y-3">
      {hierarchy.epics.map((group) => <div key={group.epic.id} className="rounded-lg border border-border bg-background/40 p-3">
        <IssueCard issue={group.epic} epic />
        <div className="mt-3 space-y-2 border-l border-border pl-3">
          {group.activeChildren.length ? group.activeChildren.map((issue) => <IssueCard key={issue.id} issue={issue} />) : <p className="text-xs text-muted-foreground">No active child issues linked to this epic.</p>}
          {!!group.closedChildren.length && <details className="rounded border border-border/70 bg-card/30 p-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{group.closedChildren.length} closed child{group.closedChildren.length === 1 ? "" : "ren"}</summary>
            <div className="mt-2 space-y-2 opacity-70">
              {group.closedChildren.map((issue) => <IssueCard key={issue.id} issue={issue} compact />)}
            </div>
          </details>}
        </div>
      </div>)}
    </div> : <p className="text-sm text-muted-foreground">No epics found in the roadmap source.</p>}
    <UngroupedIssues issues={hierarchy.ungrouped} />
  </div>;
}

function UngroupedIssues({ issues }: { issues: RoadmapIssueView[] }) {
  const active = sortIssueViews(issues.filter((issue) => issue.status !== "closed"));
  const closed = sortIssueViews(issues.filter((issue) => issue.status === "closed"));
  return <div className="space-y-2 border-t border-border pt-3">
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">Ungrouped</h4>
      <Badge variant="outline">{issues.length}</Badge>
    </div>
    {active.length ? <div className="grid gap-2 md:grid-cols-2">{active.map((issue) => <IssueCard key={issue.id} issue={issue} />)}</div> : <p className="text-sm text-muted-foreground">No ungrouped active issues.</p>}
    {!!closed.length && <details className="rounded border border-border/70 bg-card/30 p-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer">{closed.length} closed ungrouped issue{closed.length === 1 ? "" : "s"}</summary>
      <div className="mt-2 grid gap-2 opacity-70 md:grid-cols-2">{closed.map((issue) => <IssueCard key={issue.id} issue={issue} compact />)}</div>
    </details>}
  </div>;
}

function IssueCard({ issue, compact, epic }: { issue: RoadmapIssueView; compact?: boolean; epic?: boolean }) {
  const blockerText = issue.unresolvedBlockers.map(formatDependency).join(", ");
  return <div className={`rounded border ${epic ? "border-primary/40 bg-primary/5" : "border-border/70 bg-card/40"} ${compact ? "p-2" : "p-3"} ${issue.status === "closed" ? "opacity-70" : ""}`}>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{issue.id}</span>
      <Badge variant={statusBadgeVariant(issue.status)}>{formatStatus(issue.status)}</Badge>
      <Badge variant="outline">P{issue.priority}</Badge>
      <Badge variant="outline">{issue.type}</Badge>
      {!!issue.dependentCount && <Badge variant="default">blocks {issue.dependentCount}</Badge>}
      {!!issue.resolvedBlockerCount && <Badge variant="outline">{issue.resolvedBlockerCount} resolved blocker{issue.resolvedBlockerCount === 1 ? "" : "s"}</Badge>}
    </div>
    <div className={`${compact ? "mt-1 text-sm" : "mt-2 text-sm"} font-medium`}>{issue.title}</div>
    {!!issue.unresolvedBlockers.length && <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">Blocked by {blockerText}</div>}
  </div>;
}

function formatDependency(dependency: RoadmapDependency): string {
  return `${dependency.title || dependency.id} (${dependency.status})`;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function statusBadgeVariant(status: string): "default" | "success" | "warning" | "destructive" | "outline" {
  if (status === "in_progress") return "default";
  if (status === "closed") return "outline";
  return "warning";
}
