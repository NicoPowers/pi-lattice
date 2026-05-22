# Containerized orchestration runtime

This project is moving toward a trusted-local container runtime: Pi runs inside one Docker/devcontainer environment, and spawned agents run as normal child Pi RPC processes in that same container. The container is the outer reproducible boundary; do not add nested Docker containers or per-agent bwrap sandboxes for this runtime.

## Devcontainer quick start

1. Open this repository in a devcontainer-compatible editor.
2. Reopen in container.
3. The devcontainer runs `bun install` after creation.
4. Validate the package:

```bash
bun run check
```

The devcontainer forwards the dashboard port `18765`.

## Running Pi in the container

From inside the container:

```bash
pi
/reload
/orchestrate
/dashboard
```

The first Pi login/configuration writes under `/home/node/.pi`. The devcontainer maps that path to a named Docker volume (`pi-agent-orchestrator-home`) so Pi config, cache, and auth survive container rebuilds.

## External Orchestrator Libraries

Runtime paths inside the container are the source of truth. Repo-local libraries belong under:

```text
.pi/pi-agent-orchestrator/libraries/<library-name>/orchestrator-library.json
```

External team/user libraries should be bind-mounted before Pi starts under:

```text
.pi/pi-agent-orchestrator/external-libraries/<library-name>/orchestrator-library.json
```

For example, add an extra devcontainer mount for a host checkout:

```json
"mounts": [
  "source=/absolute/host/team-orchestrator-library,target=${containerWorkspaceFolder}/.pi/pi-agent-orchestrator/external-libraries/team,type=bind,consistency=cached"
]
```

External libraries are separately versioned repositories. This project ignores `.pi/pi-agent-orchestrator/external-libraries/` so normal project status is not polluted by mounted library contents.

## Notes

- Keep host paths out of library metadata; the dashboard and runtime should display container paths.
- The Dockerfile includes Bun, Node-compatible tooling, git, ripgrep, Python, and build essentials for this repository's tests/builds.
- Network hardening is intentionally deferred; this baseline is for a trusted local development environment.
