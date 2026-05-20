import { useEffect, useMemo, useState } from "react";
import type { RoadmapDependency, RoadmapOverview } from "../../types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Dialog } from "../../components/ui/dialog.js";
import { buildRoadmapHierarchy, sortIssueViews, type RoadmapHierarchy, type RoadmapIssueView } from "./roadmap-view-model.js";

interface RoadmapPanelProps {
  pushLog?: (text: string, level?: "info" | "success" | "warn" | "error") => void;
}

type StatusFilterKey = "inProgress" | "ready" | "blocked" | "backlog" | "closed";
type StatusFilters = Record<StatusFilterKey, boolean>;

const defaultFilters: StatusFilters = { inProgress: true, ready: true, blocked: true, backlog: true, closed: false };

const summaryCards: Array<{ key: keyof RoadmapOverview["counts"]; label: string; tone: "default" | "success" | "warning" | "destructive" | "outline" }> = [
  { key: "inProgress", label: "In Progress", tone: "default" },
  { key: "nextUp", label: "Next Up", tone: "success" },
  { key: "blocked", label: "Blocked", tone: "destructive" },
  { key: "backlog", label: "Backlog / Open", tone: "warning" },
  { key: "closed", label: "Closed", tone: "outline" },
];

const filterOptions: Array<{ key: StatusFilterKey; label: string }> = [
  { key: "inProgress", label: "In Progress" },
  { key: "ready", label: "Ready" },
  { key: "blocked", label: "Blocked" },
  { key: "backlog", label: "Backlog / Open" },
  { key: "closed", label: "Closed" },
];

export function RoadmapPanel({ pushLog }: RoadmapPanelProps) {
  const [overview, setOverview] = useState<RoadmapOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<StatusFilters>(defaultFilters);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

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

  const selectedIssue = useMemo(() => {
    if (!overview || !selectedIssueId) return undefined;
    return flattenHierarchy(buildRoadmapHierarchy(overview)).find((issue) => issue.id === selectedIssueId);
  }, [overview, selectedIssueId]);

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
      {!loading && !error && overview && <RoadmapSummary overview={overview} filters={filters} onFiltersChange={setFilters} onSelectIssue={setSelectedIssueId} />}
    </CardContent>
    {overview && <IssueDetailDialog overview={overview} issue={selectedIssue} onClose={() => setSelectedIssueId(null)} onSelectIssue={setSelectedIssueId} />}
  </Card>;
}

// RoadmapPanel stays source-agnostic: it renders RoadmapOverview from /api/roadmap
// and does not expose Seeds mutation controls. Provider-specific details belong on
// the server side so the backing store can change without renaming this feature.
function RoadmapSummary({ overview, filters, onFiltersChange, onSelectIssue }: { overview: RoadmapOverview; filters: StatusFilters; onFiltersChange: (filters: StatusFilters) => void; onSelectIssue: (id: string) => void }) {
  const hierarchy = buildRoadmapHierarchy(overview);
  const filteredHierarchy = filterHierarchy(hierarchy, filters, overview);
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
    <FilterBar filters={filters} onChange={onFiltersChange} />
    <div className="grid gap-3 md:grid-cols-2">
      <QueuePreview title="Next Up" issueIds={overview.groups.nextUp} overview={overview} emptyText="No ready work found." onSelectIssue={onSelectIssue} />
      <QueuePreview title="Blocked" issueIds={overview.groups.blocked} overview={overview} emptyText="No blocked work found." onSelectIssue={onSelectIssue} />
    </div>
    <RoadmapHierarchyView hierarchy={filteredHierarchy} onSelectIssue={onSelectIssue} />
  </div>;
}

function FilterBar({ filters, onChange }: { filters: StatusFilters; onChange: (filters: StatusFilters) => void }) {
  return <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
    <span className="text-sm font-medium">Filters</span>
    {filterOptions.map((option) => <Button key={option.key} variant={filters[option.key] ? "default" : "secondary"} className="px-2 py-1 text-xs" onClick={() => onChange({ ...filters, [option.key]: !filters[option.key] })}>{option.label}: {filters[option.key] ? "On" : "Off"}</Button>)}
  </div>;
}

function QueuePreview({ title, issueIds, overview, emptyText, onSelectIssue }: { title: string; issueIds: string[]; overview: RoadmapOverview; emptyText: string; onSelectIssue: (id: string) => void }) {
  const hierarchy = buildRoadmapHierarchy(overview);
  const issueViewsById = new Map(flattenHierarchy(hierarchy).map((issue) => [issue.id, issue]));
  const visibleIssues = issueIds.map((id) => issueViewsById.get(id)).filter((issue): issue is RoadmapIssueView => !!issue).slice(0, 5);
  return <div className="rounded-md border border-border p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Badge variant="outline">{issueIds.length}</Badge>
    </div>
    {visibleIssues.length ? <div className="space-y-2">
      {visibleIssues.map((issue) => <IssueCard key={issue.id} issue={issue} compact onSelectIssue={onSelectIssue} />)}
      {issueIds.length > visibleIssues.length && <div className="text-xs text-muted-foreground">+ {issueIds.length - visibleIssues.length} more</div>}
    </div> : <p className="text-sm text-muted-foreground">{emptyText}</p>}
  </div>;
}

function RoadmapHierarchyView({ hierarchy, onSelectIssue }: { hierarchy: RoadmapHierarchy; onSelectIssue: (id: string) => void }) {
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
        <IssueCard issue={group.epic} epic onSelectIssue={onSelectIssue} />
        <div className="mt-3 space-y-2 border-l border-border pl-3">
          {group.activeChildren.length ? group.activeChildren.map((issue) => <IssueCard key={issue.id} issue={issue} onSelectIssue={onSelectIssue} />) : <p className="text-xs text-muted-foreground">No active child issues linked to this epic.</p>}
          {!!group.closedChildren.length && <details className="rounded border border-border/70 bg-card/30 p-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{group.closedChildren.length} closed child{group.closedChildren.length === 1 ? "" : "ren"}</summary>
            <div className="mt-2 space-y-2 opacity-70">
              {group.closedChildren.map((issue) => <IssueCard key={issue.id} issue={issue} compact onSelectIssue={onSelectIssue} />)}
            </div>
          </details>}
        </div>
      </div>)}
    </div> : <p className="text-sm text-muted-foreground">No epics found in the roadmap source.</p>}
    <UngroupedIssues issues={hierarchy.ungrouped} onSelectIssue={onSelectIssue} />
  </div>;
}

function UngroupedIssues({ issues, onSelectIssue }: { issues: RoadmapIssueView[]; onSelectIssue: (id: string) => void }) {
  const active = sortIssueViews(issues.filter((issue) => issue.status !== "closed"));
  const closed = sortIssueViews(issues.filter((issue) => issue.status === "closed"));
  return <div className="space-y-2 border-t border-border pt-3">
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">Ungrouped</h4>
      <Badge variant="outline">{issues.length}</Badge>
    </div>
    {active.length ? <div className="grid gap-2 md:grid-cols-2">{active.map((issue) => <IssueCard key={issue.id} issue={issue} onSelectIssue={onSelectIssue} />)}</div> : <p className="text-sm text-muted-foreground">No ungrouped active issues.</p>}
    {!!closed.length && <details className="rounded border border-border/70 bg-card/30 p-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer">{closed.length} closed ungrouped issue{closed.length === 1 ? "" : "s"}</summary>
      <div className="mt-2 grid gap-2 opacity-70 md:grid-cols-2">{closed.map((issue) => <IssueCard key={issue.id} issue={issue} compact onSelectIssue={onSelectIssue} />)}</div>
    </details>}
  </div>;
}

function IssueCard({ issue, compact, epic, onSelectIssue }: { issue: RoadmapIssueView; compact?: boolean; epic?: boolean; onSelectIssue: (id: string) => void }) {
  const blockerText = issue.unresolvedBlockers.map(formatDependency).join(", ");
  return <button type="button" className={`block w-full rounded border text-left transition hover:border-primary/60 ${epic ? "border-primary/40 bg-primary/5" : "border-border/70 bg-card/40"} ${compact ? "p-2" : "p-3"} ${issue.status === "closed" ? "opacity-70" : ""}`} onClick={() => onSelectIssue(issue.id)}>
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
  </button>;
}

function IssueDetailDialog({ overview, issue, onClose, onSelectIssue }: { overview: RoadmapOverview; issue?: RoadmapIssueView; onClose: () => void; onSelectIssue: (id: string) => void }) {
  const blockers = issue ? overview.dependencyMap.blockers[issue.id] || [] : [];
  const dependents = issue ? overview.dependencyMap.dependents[issue.id] || [] : [];
  return <Dialog open={!!issue} title="Issue Details" onOpenChange={onClose} className="max-w-4xl">
    {issue && <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{issue.id}</span><Badge variant={statusBadgeVariant(issue.status)}>{formatStatus(issue.status)}</Badge><Badge variant="outline">P{issue.priority}</Badge><Badge variant="outline">{issue.type}</Badge>
        </div>
        <h3 className="mt-2 text-xl font-semibold">{issue.title}</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Meta label="Created" value={formatDate(issue.createdAt)} />
        <Meta label="Updated" value={formatDate(issue.updatedAt)} />
        {issue.closedAt && <Meta label="Closed" value={formatDate(issue.closedAt)} />}
        {issue.closeReason && <Meta label="Close reason" value={issue.closeReason} />}
      </div>
      {!!issue.labels.length && <div><h4 className="mb-2 text-sm font-semibold">Labels</h4><div className="flex flex-wrap gap-1">{issue.labels.map((label) => <Badge key={label} variant="outline">{label}</Badge>)}</div></div>}
      <div><h4 className="mb-2 text-sm font-semibold">Description</h4><div className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/50 p-3 text-sm text-muted-foreground">{issue.description || "No description."}</div></div>
      <DependencyList title="Blockers" dependencies={blockers} onSelectIssue={onSelectIssue} onClose={onClose} />
      <DependencyList title="Dependents" dependencies={dependents} onSelectIssue={onSelectIssue} onClose={onClose} />
    </div>}
  </Dialog>;
}

function DependencyList({ title, dependencies, onSelectIssue, onClose }: { title: string; dependencies: RoadmapDependency[]; onSelectIssue: (id: string) => void; onClose: () => void }) {
  return <div>
    <h4 className="mb-2 text-sm font-semibold">{title}</h4>
    {dependencies.length ? <div className="space-y-2">{dependencies.map((dependency) => <button key={dependency.id} type="button" className="block w-full rounded border border-border bg-card/40 p-2 text-left text-sm hover:border-primary/60" onClick={() => { onSelectIssue(dependency.id); if (dependency.status === "unknown") onClose(); }}>
      <div className="flex flex-wrap items-center gap-2"><span>{dependency.title || dependency.id}</span><Badge variant={statusBadgeVariant(dependency.status)}>{formatStatus(dependency.status)}</Badge>{dependency.priority !== undefined && <Badge variant="outline">P{dependency.priority}</Badge>}</div>
      <div className="mt-1 text-xs text-muted-foreground">{dependency.id}</div>
    </button>)}</div> : <p className="text-sm text-muted-foreground">None.</p>}
  </div>;
}

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <div className="rounded border border-border bg-card/40 p-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm">{value}</div></div>;
}

function filterHierarchy(hierarchy: RoadmapHierarchy, filters: StatusFilters, overview: RoadmapOverview): RoadmapHierarchy {
  return {
    epics: hierarchy.epics.map((group) => ({
      epic: group.epic,
      activeChildren: group.activeChildren.filter((issue) => isVisible(issue, filters, overview)),
      closedChildren: filters.closed ? group.closedChildren.filter((issue) => isVisible(issue, filters, overview)) : [],
    })),
    ungrouped: hierarchy.ungrouped.filter((issue) => isVisible(issue, filters, overview)),
  };
}

function isVisible(issue: RoadmapIssueView, filters: StatusFilters, overview: RoadmapOverview): boolean {
  if (issue.type === "epic") return true;
  if (issue.status === "closed") return filters.closed;
  if (issue.status === "in_progress") return filters.inProgress;
  const blocked = (overview.dependencyMap.unresolvedBlockers[issue.id] || []).length > 0;
  if (blocked) return filters.blocked;
  if (overview.groups.ready.includes(issue.id)) return filters.ready;
  return filters.backlog;
}

function flattenHierarchy(hierarchy: RoadmapHierarchy): RoadmapIssueView[] {
  return [...hierarchy.epics.flatMap((group) => [group.epic, ...group.activeChildren, ...group.closedChildren]), ...hierarchy.ungrouped];
}

function formatDependency(dependency: RoadmapDependency): string {
  return `${dependency.title || dependency.id} (${dependency.status})`;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatDate(value?: string): string | undefined {
  return value ? new Date(value).toLocaleString() : undefined;
}

function statusBadgeVariant(status: string): "default" | "success" | "warning" | "destructive" | "outline" {
  if (status === "in_progress") return "default";
  if (status === "closed") return "outline";
  if (status === "unknown") return "destructive";
  return "warning";
}
