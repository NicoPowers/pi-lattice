# pi-agent-orchestrator — Roadmap

## Current Direction

The next major direction is to make the dashboard capable of managing richer orchestration templates without turning into a pile of hand-written DOM code.

We will migrate the dashboard to **React + TypeScript + Tailwind + shadcn-style local components** first, while preserving current behavior. After that foundation is stable, we will add skill templates and extension templates phase by phase.

## Current Working Architecture

- Pi starts in normal mode.
- `/orchestrate` explicitly enables orchestration mode.
- Only when orchestration mode is enabled can the root Pi session create sub-agents through `create_sub_agent`.
- Agents run as `pi --mode rpc --no-session` inside `bwrap` sandboxes.
- Root agents get ephemeral `/tmp/pi-worktree-*` git worktrees.
- Child agents share the parent/root worktree.
- Dashboard uses REST + SSE; no WebSockets.
- Dashboard is the human control surface for monitoring, templates, inspection, stats, and emergency stop.

## Key Decisions From Planning

- Dashboard migration should not change backend behavior.
- Use shadcn-style components locally; do not introduce Next.js or a runtime dev server dependency.
- Build output should stay static and be served by the existing extension HTTP server.
- Template changes will apply to **newly spawned agents only** for now.
- Skill and extension assignment will eventually happen via templates, not direct per-agent lists in the main UI.
- No hardcoded `common` template. Any template may later be marked `applyToAll`.
- Extension expected-tool metadata is not standardized in Pi. Treat static metadata as optional/best-effort.
- Actual running-agent tools should eventually be reported by the child agent itself and shown in the dashboard.

---

# Phase 1 — React/shadcn Dashboard Migration

## Goal

Replace the current hand-authored `web/dashboard.ts` DOM manipulation with a React + TypeScript dashboard, preserving the existing user-visible behavior.

This phase is intentionally a migration, not a feature expansion.

## Regression Checklist

Before Phase 1 is considered complete, verify:

- `/dashboard` serves the dashboard successfully.
- SSE connects and reconnects.
- Existing agents sync on page load.
- Agent cards show:
  - name
  - status
  - type
  - parent/root
  - turns
  - worktree path
  - Copy Path button
  - context/token/cost stats
- Hierarchy panel renders parent/child relationships.
- Agent Type editor still works:
  - list types
  - create/edit type
  - model dropdown populated from `/api/models`
  - thinking dropdown only appears for reasoning-capable models
  - save persists `.md` definition
- Inspect modal works:
  - lifecycle/tool events visible
  - text deltas coalesced
  - accumulated assistant text visible
- Emergency Stop button works.
- Event log still receives important dashboard/system events.
- `bun run check` passes.

---

## Tracer Bullet Issues

### Issue 1: React Build Scaffold

**Goal**: Add React/Tailwind/shadcn-style build foundation without changing dashboard behavior yet.

**What to do:**
- Add React + React DOM dependencies.
- Add Tailwind dependencies/config.
- Add minimal shadcn-style component structure under `web/components/ui/`.
- Add a React entrypoint, likely `web/app.tsx`.
- Keep `bun build` producing static assets into `web/`.
- Keep existing `web/index.html` served by the current HTTP server.
- Do not remove the old dashboard implementation yet.

**Validation:**
- `bun run build` works.
- Existing dashboard still works.
- No runtime server/framework dependency introduced.

---

### Issue 2: React Shell Mirrors Current Layout

**Goal**: Render the current dashboard layout in React with static/dummy data first.

**What to do:**
- Create top-level React app shell.
- Add tabs or layout slots for:
  - Live Agents
  - Agent Types
  - Hierarchy
  - Event Log
- Add basic local UI components:
  - Button
  - Card
  - Badge
  - Dialog
  - Tabs
  - Select
  - Textarea/Input
- Keep styles close to current dark UI, but cleaner.

**Validation:**
- React app renders without wiring APIs yet.
- Layout is visually comparable or better than current dashboard.

---

### Issue 3: Port Agent Data/SSE Logic to React

**Goal**: Move live agent state, SSE connection, and event handling into React state/hooks.

**What to do:**
- Port `/events` EventSource logic.
- Port initial `init` event handling.
- Port agent lifecycle handling:
  - `agent-spawned`
  - `agent-killed`
  - `agent-start`
  - `agent-end`
  - `agent-delta`
  - `agent-exit`
- Port event log state.
- Preserve reconnect behavior.

**Validation:**
- Spawn agents from terminal/orchestrator.
- Dashboard updates without refresh.
- Existing active agents appear on page load.

---

### Issue 4: Port Agent Cards, Stats, Worktree Helpers

**Goal**: Recreate current agent cards in React.

**What to do:**
- Show name/status/type/parent/turns/worktree.
- Copy Path button.
- Poll `/api/agent-stats` every 5 seconds.
- Render context usage + cost.
- Keep send/kill controls only if we still want them in current parity.

**Validation:**
- Agent metadata is no longer blank for tool-spawned agents.
- Stats populate after a few seconds.
- Copy Path works or logs fallback.

---

### Issue 5: Port Hierarchy View

**Goal**: Recreate collapsible parent/child hierarchy in React.

**What to do:**
- Derive children from both `children` arrays and `parent` fields.
- Support expand/collapse.
- Show type/status badge.

**Validation:**
- Root agents and children display correctly.
- Hierarchy remains accurate when agents spawn/exit.

---

### Issue 6: Port Agent Type Editor

**Goal**: Recreate the Agent Type Library editor in React.

**What to do:**
- Load `/api/agent-types`.
- Load `/api/models`.
- Create/edit agent type modal/dialog.
- Model dropdown uses rich model info.
- Thinking dropdown appears only when selected model supports thinking.
- Save via `POST /api/agent-types`.

**Validation:**
- Create a new type.
- Edit an existing type.
- Saved frontmatter includes model/thinking when selected.

---

### Issue 7: Port Inspect Modal

**Goal**: Recreate agent inspection in React.

**What to do:**
- Fetch `/api/agents/:name/events`.
- Show status/worktree.
- Show lifecycle/tool events.
- Coalesce text deltas into readable assistant text blocks.
- Show accumulated assistant text.

**Validation:**
- Inspect active `lead`/`reviewer` agents.
- No spammy per-token rows.

---

### Issue 8: Port Emergency Stop

**Goal**: Recreate safety controls in React.

**What to do:**
- Add prominent Emergency Stop button.
- Confirm before action.
- Call `POST /api/emergency-stop`.
- Clear local dashboard state after success.

**Validation:**
- Start multiple agents.
- Emergency stop kills agents and dashboard clears.

---

### Issue 9: Remove Old Dashboard Implementation

**Goal**: Once React parity is complete, delete old hand-written dashboard code.

**What to do:**
- Remove old DOM-driven `dashboard.ts` implementation or fully replace it.
- Ensure generated/built assets are correct.
- Update package scripts if needed.
- Update README/dashboard docs.

**Validation:**
- `bun run check` passes.
- Manual regression checklist passes.
- No stale DOM element IDs or dead code remain.

---

# Later Phases (Not Yet Broken Down)

## Phase 2 — Template Backend

- Project-local `.pi/skill-templates/`
- Project-local `.pi/extension-templates/`
- CRUD APIs
- `applyToAll`
- Separate modules for skills/extensions

## Phase 3 — Static Extension Metadata

- Optional static expected-tool metadata convention
- Unknown tools shown as unknown, not error
- No runtime extension introspection

## Phase 4 — Agent Definition Resolution

- `skillTemplates:` frontmatter
- `extensionTemplates:` frontmatter
- Resolve `applyToAll + selected templates`
- Apply only to newly spawned agents

## Phase 5 — Actual Runtime Tool Reporting

- Child agents report `pi.getActiveTools()` / `pi.getAllTools()` from inside their own Pi session
- Dashboard shows actual tools per running agent

## Phase 6 — Template UI

- Skill Templates tab
- Extension Templates tab
- Searchable lists/checklists, no drag/drop initially
- Preview resolved capabilities

## Phase 7 — Agent Type Capability Preview

- Show resolved templates, skills, extensions, expected tools, and actual runtime tools where available

---

## Current Useful Commands

```text
/orchestrate
/orchestrate off
/orchestrate status
/dashboard
/agents
/worktrees
/kill all
/logs
```
