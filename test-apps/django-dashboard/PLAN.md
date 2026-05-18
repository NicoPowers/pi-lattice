# Test App: Django Analytics Dashboard

## Goal
Build a real-world Django web application using the pi-agent-orchestrator multi-agent framework. This stress-tests the framework with a non-trivial codebase, revealing weak points in delegation, tool usage, async coordination, and agent specialization.

## App Overview

**Django Analytics Dashboard** — A simple web app for tracking and visualizing business metrics.

### Features
1. **Authentication** — User registration, login/logout, password reset
2. **Dashboard** — Main page with charts ( Chart.js ) showing key metrics
3. **CRUD: Projects** — Create, read, update, delete projects
4. **CRUD: Metrics** — Each project has time-series metrics (daily revenue, users, etc.)
5. **Data Import** — Upload CSV to bulk-import metrics
6. **API** — REST endpoints for all CRUD operations (Django REST Framework)
7. **Admin** — Django admin configured for all models
8. **Tests** — Unit tests for models, views, API, and auth

### Tech Stack
- **Backend**: Django 5.x + Django REST Framework
- **Database**: SQLite (dev) / PostgreSQL (prod-ready config)
- **Frontend**: Django templates + Chart.js + Tailwind CSS (via CDN)
- **Auth**: Django built-in auth + custom user model
- **Testing**: Django TestCase + pytest-django
- **Dev Tools**: django-debug-toolbar

---

## Agent Team Structure

### Project Lead (`lead`)
- **Type**: `architect` (new agent type — system design + coordination)
- **Role**: Breaks down tasks, delegates to specialists, integrates their work
- **Tools**: read, bash, edit, write, grep, find, ls, delegate
- **Skills**: `tdd`, `system-design` (new)
- **Parent**: `self`

### Backend Engineer (`backend`)
- **Type**: `coder`
- **Role**: Implements Django models, views, URLs, admin, tests
- **Tools**: read, bash, edit, write, grep, find, ls, delegate
- **Skills**: `tdd`
- **Parent**: `lead`

### Frontend Engineer (`frontend`)
- **Type**: `coder`
- **Role**: Templates, CSS, Chart.js integration, forms
- **Tools**: read, bash, edit, write, grep, find, ls, delegate
- **Skills**: `tdd`
- **Parent**: `lead`

### QA / Security Reviewer (`qa`)
- **Type**: `reviewer`
- **Role**: Reviews auth implementation, tests, security issues
- **Tools**: read, grep, find, ls, delegate
- **Skills**: `security-checklist`
- **Parent**: `lead`

### DevOps / Setup (`devops`)
- **Type**: `coder` (specialized for infra/setup)
- **Role**: Project scaffolding, requirements, settings, environment setup
- **Tools**: read, bash, edit, write, grep, find, ls, delegate
- **Skills**: `tdd`
- **Parent**: `lead`

---

## Build Phases

### Phase 1: Project Scaffolding
**Orchestrator**: `agent_send("lead", "Set up the Django project. Delegate to devops for scaffolding, then to backend for initial models.")`

- DevOps creates:
  - `requirements.txt` with Django, DRF, pytest-django, etc.
  - `manage.py`, `settings.py`, `urls.py`, `wsgi.py`, `asgi.py`
  - `.env.example`, `.gitignore`
  - Directory structure: `apps/`, `templates/`, `static/`, `tests/`
- Backend creates:
  - Custom User model
  - `Project` model (name, description, owner, created_at)
  - `Metric` model (project FK, date, revenue, users, orders)
  - Initial migrations
- QA reviews the auth setup

### Phase 2: Authentication
**Orchestrator**: `agent_send("lead", "Implement full auth flow: register, login, logout, password reset. Delegate auth views to backend and templates to frontend.")`

- Backend: auth views, forms, URL routes, email backend config
- Frontend: login.html, register.html, base template with nav
- QA: reviews for CSRF, session handling, password validation

### Phase 3: CRUD — Projects
**Orchestrator**: `agent_send("lead", "Build full CRUD for Projects. Backend does models/views/API, frontend does templates, QA reviews.")`

- Backend: ListView, DetailView, CreateView, UpdateView, DeleteView + DRF ViewSets
- Frontend: project_list.html, project_form.html, project_detail.html, project_confirm_delete.html
- QA: tests for all CRUD operations, permission checks

### Phase 4: CRUD — Metrics + Dashboard
**Orchestrator**: `agent_send("lead", "Build metrics CRUD and the dashboard with Chart.js. This is the complex one — coordinate backend, frontend, and qa carefully.")`

- Backend: Metric CRUD + API endpoints + data aggregation queries
- Frontend: Dashboard template with Chart.js charts, metric forms, CSV upload
- QA: tests for data import, chart data endpoints, edge cases

### Phase 5: Polish & Integration Testing
**Orchestrator**: `agent_send("lead", "Polish the app. Add tests, fix any issues QA found, ensure everything works end-to-end.")`

- Run full test suite
- Fix any bugs
- Add README with setup instructions
- QA does final security review

---

## Stress Tests for the Framework

These scenarios are designed to find weak points in the orchestrator:

### 1. Concurrent Delegation
**Scenario**: Lead delegates to backend AND frontend simultaneously for independent tasks.
**What we test**: Can the broker handle parallel delegate calls from the same agent?
**Expected issue**: Race conditions in request/response file naming or agent state.

### 2. Deep Delegation Chain
**Scenario**: Lead → Backend → DevOps (backend needs devops to fix a settings issue mid-task).
**What we test**: Can an agent delegate to a sibling of its parent? (uncle/aunt agent)
**Expected issue**: Agent lookup may fail for non-direct-lineage agents.

### 3. Long-Running Agent with Steering
**Scenario**: Backend is running migrations that take 30+ seconds. Orchestrator sends a steering message to cancel.
**What we test**: Can we abort a long-running sub-agent task?
**Expected issue**: No abort mechanism for `sendToAgent` currently.

### 4. Skill Injection Variations
**Scenario**: Give backend the `security-checklist` skill for auth phase, then swap to `tdd` for CRUD phase.
**What we test**: Can we dynamically change an agent's skills without respawning?
**Expected issue**: Skills are set at spawn time only — no hot-swap.

### 5. Error Recovery
**Scenario**: Frontend writes invalid HTML that crashes Django template rendering. QA finds it. Lead needs to coordinate fix.
**What we test**: How does the framework handle agent errors and retries?
**Expected issue**: No retry/backoff logic in `sendToAgent`.

### 6. File Conflicts
**Scenario**: Backend and frontend both try to edit `templates/base.html` at the same time.
**What we test**: Shared worktree with concurrent writes.
**Expected issue**: Git worktree has no file locking — last write wins.

### 7. Large Response Handling
**Scenario**: QA returns a 50KB review with 100 issues. Lead needs to process and delegate fixes.
**What we test**: Large delegate responses via comms files.
**Expected issue**: File I/O bottleneck, or response truncation.

---

## Expected Discoveries

| Area | Likely Weak Point | Potential Fix |
|------|------------------|---------------|
| **Concurrency** | Parallel delegate calls collide | Add request file locking or UUID-based isolation |
| **Abort** | No way to cancel a running agent | Add `agent_abort` tool + signal forwarding |
| **Skills** | Skills frozen at spawn | Support `agent_reconfigure` to hot-swap skills/prompts |
| **Retries** | No retry on transient failures | Add exponential backoff in `sendToAgent` |
| **Logs** | Hard to debug multi-agent flow | Write structured JSON logs per agent to disk |
| **State** | Agent history lost on crash | Persist agent state to session entries |
| **File Locks** | Concurrent edits in shared worktree | Add advisory file locks or git-based coordination |
| **Memory** | `accumulatedText` grows unbounded | Add truncation/rotation for long agent histories |

---

## Directory Structure

```
test-apps/django-dashboard/
├── PLAN.md                 # This file
├── README.md               # App setup instructions (generated by agents)
├── requirements.txt        # Python deps
├── manage.py               # Django entry point
├── config/                 # Django settings, URLs, WSGI
│   ├── __init__.py
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── apps/
│   ├── accounts/           # Custom user model + auth views
│   ├── projects/           # Project CRUD
│   ├── metrics/            # Metric CRUD + dashboard
│   └── api/                # DRF API endpoints
├── templates/              # Django templates
│   ├── base.html
│   ├── accounts/
│   ├── projects/
│   ├── metrics/
│   └── dashboard.html
├── static/                 # CSS, JS
│   ├── css/
│   └── js/
├── tests/                  # Test suites
│   ├── test_models.py
│   ├── test_views.py
│   ├── test_api.py
│   └── test_auth.py
└── .env.example
```

---

## How to Run the Test

1. Spawn the team:
```
/spawn lead self architect
/spawn devops lead coder
/spawn backend lead coder
/spawn frontend lead coder
/spawn qa lead reviewer
```

2. Send build commands via `agent_send` to lead

3. Observe delegation patterns, timing, errors

4. Document issues in `ISSUES.md` as they're discovered

5. Fix framework issues in `extensions/multi-agent.ts` as needed
