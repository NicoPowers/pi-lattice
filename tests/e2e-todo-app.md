# E2E Test: Build a Todo App (Agentic Workflow)

## Goal
Verify the full agentic orchestration pipeline:
1. Orchestrator spawns a **lead** agent
2. Lead analyzes the task and autonomously spawns sub-agents (implementer, reviewer, etc.)
3. Sub-agents collaborate via delegation
4. Final deliverable: a working todo app in the project

## Setup

```bash
cd tests/fixtures/todo-project
pi
```

## Test Steps

### Step 1 — Start the orchestrator
Inside Pi, the multi-agent extension should auto-load.

Verify:
```
/agents
```
Should show: `No active agents.`

### Step 2 — Spawn the lead
```
/spawn lead self implementer
```

Or ask the orchestrator to create it:
```
Create a sub-agent named 'lead' using the implementer type. We need to build a todo app.
```

### Step 3 — Assign the mission
Send the lead a high-level task:
```
/ask lead "Build a simple CLI todo app in this project. It should support: add, list, complete, and delete tasks. Use a JSON file for storage. Write clean, tested code. Spawn helper agents if you need research or review."
```

**Expected behavior:**
- Lead receives the task
- Lead decides scope
- Lead may call `create_sub_agent` to spawn:
  - `researcher` — explore best practices for CLI apps
  - `implementer_1` — write core logic
  - `reviewer` — review the code
- Lead delegates sub-tasks via `delegate` tool
- Sub-agents return results
- Lead synthesizes and writes final code

### Step 4 — Observe via dashboard
Open the dashboard in another terminal:
```
/dashboard
```

Watch:
- Hierarchy tree growing
- Agent statuses changing (idle → streaming → idle)
- Event log showing delegation chains

### Step 5 — Verify deliverable
After lead reports completion, check the worktree:

```bash
# In another terminal
ls /tmp/pi-worktree-lead-*/
```

Expected files:
- `todo.py` or `todo.js` — main CLI
- `tasks.json` — data file (maybe)
- `README.md` — updated with usage
- `test_todo.py` or similar — tests

### Step 6 — Review and accept
Ask the orchestrator:
```
Show me what lead built. Is it complete?
```

### Step 7 — Cleanup (or Emergency Stop)
```
/kill lead
```

Or if anything goes wrong, hit **🛑 Emergency Stop** in the dashboard.

## Success Criteria

| Check | Pass? |
|-------|-------|
| Lead spawned successfully | ☐ |
| Lead created at least 1 sub-agent autonomously | ☐ |
| Delegation worked (no deadlock) | ☐ |
| Files were written to worktree | ☐ |
| Code is runnable | ☐ |
| Dashboard showed hierarchy correctly | ☐ |
| Emergency stop works (optional test) | ☐ |

## Notes

- If the lead doesn't spawn sub-agents, check that:
  - The `create_sub_agent` tool is in its tool list
  - Its system prompt includes guidance on when to spawn
- If delegation hangs, check `/tmp/pi-multi-agent.log`
- The worktree path is logged on spawn — use it to inspect files
