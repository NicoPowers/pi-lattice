# Pi Agent Orchestrator

Pi Agent Orchestrator helps a root Pi session coordinate spawned agents and user-owned orchestration resources through an explicit dashboard-backed workflow.

## Language

**Dashboard Shell**:
The browser UI frame that owns navigation, global session state, and cross-feature refresh wiring.
_Avoid_: Main app blob, UI root logic

**Live Agent**:
A currently running spawned Pi RPC agent tracked by the orchestrator session.
_Avoid_: Worker, child process when referring to the domain concept

**Agent Type**:
A spawnable markdown definition that describes how to launch a specialized agent.
_Avoid_: Agent profile, bot template

**Root Orchestrator Profile**:
A root-only markdown profile that configures the interactive `/orchestrate` session.
_Avoid_: Agent type, spawnable orchestrator

**Skill Library**:
The dashboard inventory for discovered skills and skill copy/edit workflows.
_Avoid_: Capability assignment UI

**Template**:
A reusable capability bundle that can reference skills or extensions for eligible agents or orchestrator sessions.
_Avoid_: Prompt template when referring to skill/extension templates

**Orchestrator Library**:
A user- or team-owned resource repository with an `orchestrator-library.json` manifest and namespaced orchestrator resources.
_Avoid_: Package resources, native Pi resource path

**Native Pi Resource Settings**:
The advanced raw Pi skill and extension path settings shown as an escape hatch inside Orchestrator Library management.
_Avoid_: Orchestrator Library resources

## Relationships

- The **Dashboard Shell** renders feature areas such as **Live Agents**, **Agent Types**, **Skill Library**, **Templates**, and **Orchestrator Libraries**.
- An **Orchestrator Library** can contain **Agent Types**, **Root Orchestrator Profiles**, **Templates**, skills, and extensions.
- **Native Pi Resource Settings** are visually managed inside **Orchestrator Libraries** but are not themselves **Orchestrator Library** resources.
- A **Root Orchestrator Profile** is not an **Agent Type** and must not be spawned as a **Live Agent**.

## Example dialogue

> **Dev:** "Should the **Skill Library** copy dialog let me target my team folder?"
> **Domain expert:** "Yes, if that folder is a configured **Orchestrator Library**; show it by manifest name and path so users know which resource repository will own the copied skill."

## Flagged ambiguities

- "Profile" has been used for both **Agent Type** and **Root Orchestrator Profile**; resolved: only root `/orchestrate` configuration is a **Root Orchestrator Profile**, while spawnable markdown definitions are **Agent Types**.
- "Resource settings" can mean **Orchestrator Library** manifest resources or **Native Pi Resource Settings**; resolved: native settings are an advanced escape hatch nested under library management but remain a separate concept.
