# pi-agent-orchestrator — Development Roadmap

## Architecture Overview

Multi-agent orchestration extension for Pi. The orchestrator (broker LLM in your interactive Pi session) spawns specialized sub-agents, each running in an isolated `bwrap` sandbox with a shared git worktree per issue.

### Key Concepts

- **Root agent**: `parent: "self"`. Gets its own `git worktree`.
- **Sub-agent**: `parent: "<some-agent>"`. Shares the parent's worktree (same bwrap `/workspace`).
- **Broker extension**: TypeScript extension in the orchestrator's Pi session. Holds all agent pipes, routes messages.
- **Async messaging**: `agent_send` returns immediately. Results delivered to orchestrator via `sendUserMessage({deliverAs: "steer"})`.
- **Delegation chain**: Sub-agents call a `delegate` tool. Broker extension routes through parent chain.

---

## Completed

### Issue 1: Bwrap + Shared Worktree Per Root Agent ✅

**Status**: Implemented, committed, needs testing in a real git repo.

**What works:**
- `agent_spawn` creates root agents with `git worktree add <path> HEAD`
- Sub-agents reuse parent's worktree
- Every agent spawned inside `bwrap`:
  ```
  bwrap --ro-bind / / --tmpfs /tmp --bind <worktree> /workspace --chdir /workspace --share-net pi --mode rpc ...
  ```
- Prompts written into worktree at `/workspace/.pi/prompts/<name>.md`
- Comms directory created: `/workspace/.pi/comms/{requests,responses}/`
- Orphaned worktree cleanup on startup (`cleanupOrphanedWorktrees`)
- Worktree removal on `agent_kill` (root) and `session_shutdown`
- Serialized worktree creation with mutex (`worktreeLock`)
- `hasBwrap()` detection using `spawnSync("which", ["bwrap"])`

**Bug fixed:**
- `spawn.sync` → `spawnSync` (Node API difference)

**Test command:**
```
# Must be run inside a git repo (not ~/.pi/)
/spawn lead self coder
/ask lead "Create a file called hello.txt with 'hello world'"
```

**Verify:**
```bash
# Check worktree exists
ls -la /tmp/pi-worktree-lead-*

# Check file was created inside bwrap
cat /tmp/pi-worktree-lead-*/hello.txt
```

---

## Pending Issues

### Issue 2: Async `agent_send`

**Goal**: `agent_send` tool should return immediately, not block the orchestrator.

**Current behavior**: `sendToAgent` blocks until `agent_end`. Orchestrator can't chat while agent works.

**Desired behavior**:
1. `agent_send(name, message)` → returns `"Queued task for lead"`
2. Extension fires off RPC prompt in background
3. When agent responds, extension calls:
   ```ts
   pi.sendUserMessage(`[${name}] ${result}`, { deliverAs: "steer" })
   ```
4. Orchestrator receives result as a new message after its current turn

**Implementation notes**:
- Need `PendingTask` queue in extension state
- `sendToAgent` stays as internal blocking helper
- `agent_send` tool wraps it in `Promise.resolve().then(...)` and returns immediately
- Result delivery uses `pi.sendUserMessage` with `deliverAs: "steer"`

---

### Issue 3: Per-Agent `delegate` Extension

**Goal**: Agents inside bwrap can call `delegate(target, task)` to route work to sibling agents.

**Current state**: No per-agent extension exists.

**Design**:
Create `extensions/delegate-agent.ts`:
```typescript
pi.registerTool({
  name: "delegate",
  parameters: { target: string, task: string },
  execute: async (toolCallId, params) => {
    const reqFile = `/workspace/.pi/comms/requests/${toolCallId}.json`;
    await fs.writeFile(reqFile, JSON.stringify(params));
    
    // Poll for response from broker extension
    const respFile = `/workspace/.pi/comms/responses/${toolCallId}.json`;
    while (!fs.existsSync(respFile)) {
      await sleep(500);
    }
    const response = await fs.readFile(respFile, "utf-8");
    return { content: [{ type: "text", text: response }] };
  }
});
```

**Integration**:
- Load via `--extension /path/to/delegate-agent.ts` when spawning agents
- Or place in package `extensions/` and reference it

---

### Issue 4: Broker Extension Routes `delegate` Requests

**Goal**: Broker extension detects `delegate` tool calls and routes them.

**Design**:
1. Monitor JSONL stream for `tool_execution_start` with `toolName: "delegate"`
2. Parse `args: { target, task }`
3. Call `sendToAgent(targetAgent, task)` (blocks)
4. Write response to `/workspace/.pi/comms/responses/<toolCallId>.json`
5. Original agent's `delegate` tool unblocks and continues

**Parent chain routing**:
- If target is a child of the calling agent → direct send
- If target has its own children → recursive delegation
- When final agent responds, route back up the chain

---

### Issue 5: End-to-End MVP

**Goal**: Orchestrator → Lead → Scout → Lead → Orchestrator works end-to-end.

**Test scenario**:
```
Orchestrator: agent_spawn(name="lead", type="coder", parent="self")
Orchestrator: agent_spawn(name="scout", type="reviewer", parent="lead")
Orchestrator: agent_send("lead", "Find auth bugs. Use @scout if needed.")
  → Returns immediately (async)
  
  [Background]
  Lead calls delegate("scout", "Find all auth-related code")
    Broker routes to Scout
    Scout responds with findings
    Broker writes response, Lead continues
  Lead calls delegate("scout", "Check src/login.js for SQL injection")
    Same cycle...
  Lead gives final: "Found 2 issues. Details: ..."
  
  Broker delivers to Orchestrator:
  "[lead] Found 2 issues. Details: ..."
```

---

## Architectural Decisions Log

| Decision | Rationale |
|----------|-----------|
| One worktree per root agent | All sub-agents share filesystem. Scout writes analysis.md, Lead reads it. No text-snippet relay needed. |
| Separate bwrap per agent | Full context isolation. Broker can kill any agent directly. TUI visibility. |
| `--ro-bind / /` + `--tmpfs /tmp` | Simple, robust. Agents can read host FS but can't write outside worktree. |
| Broker extension as message router | Broker LLM is unburdened. All relay happens in TypeScript. Full logging. |
| `agent_send` async, `delegate` blocking | Orchestrator stays interactive. Sub-agents complete their reasoning in one turn. |
| `"self"` for root parent | Explicit. No magic defaults. |

---

## Known Limitations / Future Work

- **No team support yet**: Deferred in favor of parent-child hierarchy
- **No health checking**: `agent_status` shows status but no staleness detection
- **No logs inspection**: Communication logs not yet written to disk
- **No PR/push**: Agents are read-write-local only
- **WSL not tested**: Bwrap requires WSL2 (Linux kernel)
- **No per-agent extension loading**: `delegate-agent.ts` not yet created or loaded

---

## How to Resume

1. `cd` into a **git repository** (not `~/.pi/`)
2. Start `pi`
3. `/reload` to load the extension
4. Test Issue 1 with `/spawn lead self coder`
5. Continue with Issue 2 (async `agent_send`)

## Git History

```
abc9648 Initial commit: multi-agent orchestration extension
f887248 Fix skills: add YAML frontmatter with description field
9cef6a3 Issue 1: Bwrap + shared worktree per root agent
```
