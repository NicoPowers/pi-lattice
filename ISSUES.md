# pi-agent-orchestrator — Current State & Next Roadmap

## Current Vision

`pi-agent-orchestrator` is now an explicit orchestration mode for Pi.

Normal Pi usage stays normal. When the user runs:

```text
/orchestrate
```

the current Pi interactive session becomes the root orchestrator. The orchestrator can create isolated specialist agents, delegate work, monitor them, steer them if stuck, and report results back to the user.

The dashboard is not meant to be the primary driver of work. It is the human control surface for:

- editing agent type templates
- monitoring active agents
- inspecting what agents are doing
- copying/opening worktree paths
- watching token/context/cost usage
- emergency stopping the fleet

## Implemented Architecture

- Agents run as `pi --mode rpc --no-session` child processes.
- Every agent is isolated with `bwrap`.
- Root agents get their own git worktree under `/tmp/pi-worktree-*`.
- Child agents share their parent/root worktree.
- The orchestrator process owns all child processes and is the only place where agents are actually spawned.
- Sub-agent communication uses:
  - RPC stdin/stdout JSONL
  - per-worktree `.pi/comms/{requests,responses}` for the `delegate` tool
- Dashboard uses:
  - REST for actions
  - SSE for server → browser events
  - no WebSockets
- Dashboard port probing uses `18765–18767`, then OS ephemeral fallback.
- Terminal remains vanilla Pi — no widgets, no panels, no spinners.

## Current Features

### Orchestration Mode

- `/orchestrate` enables orchestration mode.
- `/orchestrate off` disables it.
- `/orchestrate status` reports current state.
- `create_sub_agent` refuses to run unless orchestration mode is enabled.

### Agent Management

- `agent_spawn` remains available for manual/dev use.
- `create_sub_agent` is the preferred orchestrator tool.
- `agent_send` queues normal tasks.
- `agent_steer` sends mid-turn steering messages to stuck/running agents.
- `agent_status` reports active agents.
- `agent_kill` kills one agent.
- `/kill all` kills all agents and removes worktrees.
- `/worktrees` lists active worktree paths and VS Code open commands.

### Dashboard

- Agent Type Library editor.
- Real model dropdown populated from `pi --list-models`.
- Thinking-level dropdown shown only for models that support reasoning.
- Agent hierarchy tree.
- Active agent cards with:
  - type
  - parent/root
  - turns
  - worktree path + Copy Path
  - context usage
  - token totals
  - running cost
- Inspect modal with:
  - status
  - worktree path
  - recent lifecycle/tool events
  - coalesced assistant text
- Emergency Stop button.

### Agent Definitions

Agent type `.md` frontmatter supports:

```yaml
name: implementer
description: Focused implementation specialist
model: kimi-k2.6
thinking: medium
tools: read, write, edit, bash, grep, find, ls
skills: tdd
```

Seeded package definitions:

- `orchestrator`
- `researcher`
- `implementer`
- `reviewer`

### Testing / Validation

- Unit tests cover:
  - definition discovery/saving
  - port probing
  - SSE formatting
  - model parser behavior with noisy extension startup output
- E2E manual test fixture:
  - `tests/fixtures/todo-project/`
  - `tests/e2e-todo-app.md`

## Important Lessons / Current Constraints

- Worktrees are ephemeral. If Pi exits with `/quit`, session shutdown removes active worktrees.
- Users should inspect active worktrees before killing agents, or we need an explicit export/apply workflow.
- `ISSUES.md` should stay short and current. Completed tracer bullets should be removed or summarized here, not left as long stale TODOs.

---

## Next Candidate Issues

### Issue 1: Export / Apply Agent Worktree

**Goal**: Make it safe and easy to preserve completed agent work before cleanup.

Possible shape:

- Dashboard button: `Export Worktree` or `Apply to Project`
- Terminal command: `/export-worktree <agent>`
- Options:
  - copy files back to source repo
  - create patch file
  - create branch from worktree
  - open worktree in VS Code

**Why**: Current worktrees disappear on shutdown/kill, which is dangerous once agents produce useful work.

---

### Issue 2: Better Agent Readiness / Health

**Goal**: Replace magic sleeps with explicit readiness/health checks.

Possible work:

- Detect RPC child readiness more reliably.
- Track last event timestamp.
- Mark agents stale if no events arrive for too long while streaming.
- Dashboard indicator for healthy / stale / exited.

---

### Issue 3: Agent Session Export / HTML Preview

**Goal**: Let users inspect an agent session like a Pi session transcript.

Possible work:

- Use RPC `export_html` per agent.
- Dashboard `Export Session` / `Open Transcript` button.
- Store exported transcript path in worktree or `/tmp`.

---

### Issue 4: Dashboard Steering UX

**Goal**: Expose safe human steering in the dashboard without turning the dashboard into the primary driver.

Possible work:

- Add optional `Steer` button in Inspect modal.
- Label it clearly as intervention/debug only.
- Log all steering events.

---

### Issue 5: Agent Type Editor Completeness

**Goal**: Finish type editing beyond model/thinking/prompt.

Possible work:

- Edit tools.
- Edit skills.
- Edit extensions.
- Delete custom types.
- Protect built-in/root types.

---

## How to Use Current Version

```bash
cd <some-git-repo>
pi
/orchestrate
/dashboard
```

Then ask Pi for a high-level task. The orchestrator can spawn specialists as needed.

Useful commands:

```text
/orchestrate status
/agents
/worktrees
/kill all
/logs
```
