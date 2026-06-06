# Roadmap Epic Board v1 Semantics

Roadmap Epic Board v1 is a visualization/planning surface for one expanded Seeds epic. It does not start work, spawn agents, perform handoffs, or mutate issue order through drag/drop.

## Membership

An issue is a board card for an epic only when it is a non-epic issue with explicit description text matching `Part of <epic-id>`. Seeds `blocks` / `blockedBy` edges are hard dependency blockers only; they are never epic membership, ordering, or focus.

## Column precedence

Each card renders in exactly one column. Apply this precedence:

1. **Done** — `status === "closed"`.
2. **Blocked** — non-closed card with one or more unresolved hard blockers. A blocker is unresolved when the referenced issue is missing/unknown or not closed.
3. **Current Focus** — open or in-progress card marked through Seeds extension metadata as current focus for this epic.
4. **In Progress** — `status === "in_progress"` and not current focus.
5. **Ready** — open card with no unresolved blockers and included in provider readiness/next-up results.
6. **Backlog / Open** — remaining open epic cards.

No Review/Validate column exists in v1. Review or validation work should be represented as normal explicit Seeds issues with `open`, `in_progress`, and `closed` status.

## Card fields

Board cards should include:

- issue id and title;
- Seeds status, type, priority, and labels;
- unresolved blocker count/list;
- dependent count/list;
- resolved blocker count when useful as compact progress context;
- compact acceptance/progress hints derived from the issue description when the UI needs a short preview;
- focus state and optional manual order metadata when present.

## Focus and ordering metadata

Current Focus is independent from Seeds status. A focused card may still be `open` or `in_progress`; closed and blocked cards do not render in Current Focus because terminal/blocker precedence wins.

Read focus/order from Seeds `extensions` metadata owned by Pi Lattice:

```json
{
  "piLattice": {
    "roadmap": {
      "epicBoards": {
        "<epic-id>": {
          "currentFocus": true,
          "order": 10
        }
      }
    }
  }
}
```

`order` is optional and numeric. When present, sort cards in a column by ascending `order`; unordered cards follow the computed order: status weight, priority, most-recent update, then issue id.

## Excluded from v1

Roadmap Epic Board v1 excludes:

- Review/Validate column semantics;
- Roadmap Start Work buttons or status-changing work-start actions;
- drag/drop mutation behavior;
- agent spawn, agent handoff, or workflow execution.

Work starts through the orchestrator/workflow engine. Roadmap only reflects Seeds and Pi Lattice metadata state after normal workflow/tooling updates it.
