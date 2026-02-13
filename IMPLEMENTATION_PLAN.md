# GitHub Reusable Workflows — Implementation Plan

> **Owner:** mruthyunjaya-lakkappanavar  
> **Date:** 2026-02-13  
> **Goal:** Demonstrate reusable GitHub Actions workflows as a migration path from Jenkins Shared Libraries

---

## Table of Contents

1. [Repository Overview](#1-repository-overview)
2. [Repo 1: github-shared-workflows (Central)](#2-repo-1-github-shared-workflows-central)
3. [Repo 2: sample-app-python (Consumer)](#3-repo-2-sample-app-python-consumer)
4. [Repo 3: sample-app-node (Consumer)](#4-repo-3-sample-app-node-consumer)
5. [Slack Integration](#5-slack-integration)
6. [Dashboard](#6-dashboard)
7. [Implementation Steps](#7-implementation-steps)
8. [Post-Setup Validation](#8-post-setup-validation)

---

## 1. Repository Overview

| Repository | Visibility | Purpose |
|---|---|---|
| `github-shared-workflows` | **Public** (required for cross-repo `workflow_call`) | Central reusable workflows, composite actions, dashboard |
| `sample-app-python` | Public | Consumer repo — Python Flask app using shared CI + Release workflows |
| `sample-app-node` | Public | Consumer repo — Node.js Express app using shared CI + Release workflows |

> **Why public?** Reusable workflows with `workflow_call` require the caller to have access. Public repos allow any repo to call them. Alternatively, all repos can be in the same GitHub org with internal visibility.

---

## 2. Repo 1: `github-shared-workflows` (Central)

### 2.1 Repository Structure

```
github-shared-workflows/
├── .github/
│   └── workflows/
│       ├── reusable-ci.yml              # Reusable CI: lint → test → security scan
│       ├── reusable-release.yml         # Reusable Release: semantic version → changelog → notify
│       └── update-dashboard.yml         # Workflow to update dashboard data
│
├── actions/
│   ├── slack-notify/
│   │   └── action.yml                   # Composite action: send Slack notifications
│   └── setup-toolchain/
│       └── action.yml                   # Composite action: setup Python/Node with caching
│
├── dashboard/
│   ├── index.html                       # Single-page dashboard (GitHub Pages)
│   ├── style.css                        # Dashboard styles
│   ├── app.js                           # Fetches GitHub API data, renders status
│   └── config.json                      # List of repos/workflows to monitor
│
├── docs/
│   ├── USAGE.md                         # How to use the reusable workflows
│   └── ARCHITECTURE.md                  # Architecture diagram and design decisions
│
├── IMPLEMENTATION_PLAN.md               # This file
├── README.md                            # Project overview, badges, quick start
└── LICENSE
```

### 2.2 Reusable Workflow: `reusable-ci.yml`

**Trigger:** `workflow_call`

**Inputs:**

| Input | Type | Default | Description |
|---|---|---|---|
| `language` | string | (required) | `python` or `node` |
| `language_version` | string | (required) | e.g., `3.11`, `20` |
| `working_directory` | string | `.` | Path to source code |
| `enable_lint` | boolean | `true` | Run linting step |
| `enable_security_scan` | boolean | `true` | Run Trivy vulnerability scan |
| `enable_test` | boolean | `true` | Run test suite |

**Secrets:**

| Secret | Required | Description |
|---|---|---|
| `SLACK_WEBHOOK_URL` | false | Slack incoming webhook for failure notifications |

**Job Steps:**

```
1. Checkout code
2. Setup toolchain (via composite action — Python or Node based on input)
3. Install dependencies (pip install / npm install with caching)
4. Lint (flake8 for Python, eslint for Node) — if enable_lint
5. Run tests (pytest for Python, jest/vitest for Node) — if enable_test
6. Security scan via Trivy (filesystem mode) — if enable_security_scan
7. Upload test results as artifact
8. Slack notification on failure — if SLACK_WEBHOOK_URL provided
```

### 2.3 Reusable Workflow: `reusable-release.yml`

**Trigger:** `workflow_call`

**Inputs:**

| Input | Type | Default | Description |
|---|---|---|---|
| `language` | string | (required) | `python` or `node` |
| `release_type` | string | `auto` | `auto` (conventional commits), `patch`, `minor`, `major` |
| `enable_changelog` | boolean | `true` | Auto-generate CHANGELOG.md |
| `enable_slack_notify` | boolean | `true` | Send release notification to Slack |

**Secrets:**

| Secret | Required | Description |
|---|---|---|
| `SLACK_WEBHOOK_URL` | false | Slack incoming webhook |

**Job Steps:**

```
1. Checkout code (full history for changelog)
2. Determine next version (using git tags + conventional commits)
3. Generate/update CHANGELOG.md — if enable_changelog
4. Create GitHub Release with auto-generated release notes
5. Slack notification with release details — if enable_slack_notify
```

**Versioning approach:** Use `googleapis/release-please-action` (free, maintained by Google) — it creates a "release PR" that bumps version + updates changelog. On merge, it creates the GitHub Release automatically.

### 2.4 Composite Action: `slack-notify`

```yaml
# actions/slack-notify/action.yml
inputs:
  status:        # success | failure | release
  webhook_url:   # Slack incoming webhook URL
  repo_name:     # Repository name
  run_url:       # Link to workflow run
  message:       # Optional custom message (for release notes, etc.)
```

Uses `slackapi/slack-github-action@v2` (official Slack action) with incoming webhooks.

**Slack message format:**
- Color-coded: green (success), red (failure), blue (release)
- Fields: repo name, branch, commit, status, link to run
- For releases: version number, changelog summary

### 2.5 Composite Action: `setup-toolchain`

```yaml
# actions/setup-toolchain/action.yml
inputs:
  language:         # python | node
  language_version: # version string
  cache:            # true | false (default: true)
```

Encapsulates:
- `actions/setup-python` or `actions/setup-node` based on language
- Dependency caching (pip cache / npm cache)
- Basic validation (print version, verify install)

### 2.6 Dashboard Update Workflow: `update-dashboard.yml`

**Trigger:** `schedule` (every 6 hours) + `workflow_dispatch` (manual)

**Steps:**
1. Fetch workflow run data from GitHub API for all monitored repos
2. Generate `dashboard/data.json` with latest status
3. Commit and push to `gh-pages` branch (auto-deploys via GitHub Pages)

---

## 3. Repo 2: `sample-app-python` (Consumer)

### 3.1 Structure

```
sample-app-python/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Calls shared CI workflow (~15 lines)
│       └── release.yml         # Calls shared Release workflow (~15 lines)
├── src/
│   ├── app.py                  # Simple Flask app (health endpoint + one feature)
│   └── __init__.py
├── tests/
│   └── test_app.py             # pytest tests
├── requirements.txt
├── requirements-dev.txt        # flake8, pytest
├── setup.py                    # or pyproject.toml
└── README.md
```

### 3.2 Caller Workflow: `ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    uses: mruthyunjaya-lakkappanavar/github-shared-workflows/.github/workflows/reusable-ci.yml@main
    with:
      language: python
      language_version: "3.11"
      enable_lint: true
      enable_security_scan: true
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### 3.3 Caller Workflow: `release.yml`

```yaml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    uses: mruthyunjaya-lakkappanavar/github-shared-workflows/.github/workflows/reusable-release.yml@main
    with:
      language: python
      enable_changelog: true
      enable_slack_notify: true
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### 3.4 Application

Minimal Flask app:
- `GET /health` → `{"status": "ok", "version": "x.y.z"}`
- `GET /api/greet?name=X` → `{"message": "Hello, X!"}`
- Tests using pytest with 3-4 test cases

---

## 4. Repo 3: `sample-app-node` (Consumer)

### 4.1 Structure

```
sample-app-node/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Calls shared CI workflow (~15 lines)
│       └── release.yml         # Calls shared Release workflow (~15 lines)
├── src/
│   └── index.js                # Simple Express app
├── tests/
│   └── app.test.js             # Jest tests
├── package.json
├── .eslintrc.json
└── README.md
```

### 4.2 Application

Minimal Express app:
- `GET /health` → `{"status": "ok", "version": "x.y.z"}`
- `GET /api/greet?name=X` → `{"message": "Hello, X!"}`
- Tests using Jest with 3-4 test cases

Caller workflows follow the same pattern as Python, just `language: node`, `language_version: "20"`.

---

## 5. Slack Integration

### 5.1 Setup (One-time, manual)

1. **Create a Slack workspace** (free plan) — or use an existing one
2. **Create a Slack App:**
   - Go to https://api.slack.com/apps → "Create New App" → "From scratch"
   - Name: `GitHub Actions Bot`
   - Workspace: your workspace
3. **Enable Incoming Webhooks:**
   - App settings → "Incoming Webhooks" → Toggle ON
   - "Add New Webhook to Workspace" → select channel (e.g., `#github-builds`)
   - Copy the webhook URL
4. **Add webhook as GitHub secret:**
   - In each consumer repo + shared-workflows repo:
   - Settings → Secrets → Actions → New secret
   - Name: `SLACK_WEBHOOK_URL`
   - Value: the webhook URL from step 3

### 5.2 Notification Events

| Event | Channel | Format |
|---|---|---|
| CI failure | `#github-builds` | :red_circle: **CI Failed** — repo, branch, commit, link |
| CI success (main only) | `#github-builds` | :green_circle: **CI Passed** — repo, branch, duration |
| New release | `#github-releases` | :rocket: **New Release** — repo, version, changelog summary |

### 5.3 Message Template (Slack Block Kit)

```json
{
  "attachments": [
    {
      "color": "#ff0000",
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": ":red_circle: *CI Failed*\n*Repo:* sample-app-python\n*Branch:* main\n*Commit:* abc1234\n*Author:* @user"
          }
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": { "type": "plain_text", "text": "View Run" },
              "url": "https://github.com/..."
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 6. Dashboard

### 6.1 Technology

- **Pure HTML + CSS + Vanilla JS** — zero dependencies, zero build step
- **Hosted on GitHub Pages** from the `github-shared-workflows` repo (`gh-pages` branch)
- **Data source:** GitHub REST API (unauthenticated = 60 req/hr, sufficient for demo)
- **Auto-refreshes** every 5 minutes via JS

### 6.2 Dashboard Sections

| Section | Data Source | Shows |
|---|---|---|
| **Workflow Status Grid** | `GET /repos/{owner}/{repo}/actions/runs` | Last 5 runs per repo: status badges, duration, timestamp |
| **Health Summary** | Computed from runs | Overall pass rate %, current streak, avg build time |
| **Recent Activity Feed** | `GET /repos/{owner}/{repo}/actions/runs?per_page=10` | Timeline of recent builds across all repos |
| **Repository Cards** | `GET /repos/{owner}/{repo}` | Repo name, description, last commit, open PRs |

### 6.3 Dashboard Config

```json
// dashboard/config.json
{
  "owner": "mruthyunjaya-lakkappanavar",
  "repos": [
    {
      "name": "sample-app-python",
      "workflows": ["CI", "Release"]
    },
    {
      "name": "sample-app-node",
      "workflows": ["CI", "Release"]
    }
  ],
  "refreshIntervalMs": 300000
}
```

### 6.4 GitHub Pages Setup

- Enable GitHub Pages on `github-shared-workflows` repo
- Source: `gh-pages` branch, `/` root
- URL: `https://mruthyunjaya-lakkappanavar.github.io/github-shared-workflows/`

---

## 7. Implementation Steps

### Phase 1: Create Repositories & Structure

| # | Task | Tool |
|---|---|---|
| 1.1 | Create `github-shared-workflows` repo on GitHub | GitHub MCP |
| 1.2 | Create `sample-app-python` repo on GitHub | GitHub MCP |
| 1.3 | Create `sample-app-node` repo on GitHub | GitHub MCP |
| 1.4 | Scaffold directory structure for all 3 repos | Local + Git push |

### Phase 2: Build Central Shared Workflows

| # | Task |
|---|---|
| 2.1 | Create `actions/setup-toolchain/action.yml` composite action |
| 2.2 | Create `actions/slack-notify/action.yml` composite action |
| 2.3 | Create `.github/workflows/reusable-ci.yml` reusable workflow |
| 2.4 | Create `.github/workflows/reusable-release.yml` reusable workflow |
| 2.5 | Create `README.md` with usage documentation |
| 2.6 | Push all to `github-shared-workflows` repo |

### Phase 3: Build Consumer Apps

| # | Task |
|---|---|
| 3.1 | Create Python Flask app with tests in `sample-app-python` |
| 3.2 | Create Node Express app with tests in `sample-app-node` |
| 3.3 | Add caller workflows (CI + Release) to both repos |
| 3.4 | Push both repos and verify workflows trigger |

### Phase 4: Slack Integration

| # | Task |
|---|---|
| 4.1 | Create Slack app + incoming webhook (manual step) |
| 4.2 | Add `SLACK_WEBHOOK_URL` secret to all 3 repos |
| 4.3 | Test notification by triggering a CI run |

### Phase 5: Dashboard

| # | Task |
|---|---|
| 5.1 | Create `dashboard/index.html`, `style.css`, `app.js`, `config.json` |
| 5.2 | Create `update-dashboard.yml` workflow |
| 5.3 | Enable GitHub Pages on `github-shared-workflows` |
| 5.4 | Verify dashboard loads and shows workflow data |

### Phase 6: Documentation & Polish

| # | Task |
|---|---|
| 6.1 | Create `docs/USAGE.md` — how consumer repos use the shared workflows |
| 6.2 | Create `docs/ARCHITECTURE.md` — design decisions, diagram |
| 6.3 | Add status badges to all README files |
| 6.4 | Final end-to-end test: push to consumer → CI runs → Slack notifies → dashboard updates |

---

## 8. Post-Setup Validation

### Checklist

- [ ] Push to `sample-app-python` main → reusable CI triggers → lint + test + scan pass → Slack notification
- [ ] Push to `sample-app-node` main → reusable CI triggers → lint + test + scan pass → Slack notification
- [ ] Merge a conventional commit PR → release-please creates release PR → merge → GitHub Release created → Slack notification
- [ ] Dashboard shows all workflow runs with correct status
- [ ] Intentionally break a test → CI fails → Slack failure notification sent
- [ ] `workflow_dispatch` on dashboard update → data refreshes

### Demo Script (for customer)

1. Show the central repo — explain reusable workflow concept
2. Show a consumer repo — highlight the ~15 line caller workflow
3. Push a commit to consumer repo — watch CI run in real-time
4. Show Slack channel receiving the notification
5. Open dashboard — show cross-repo visibility
6. Break a test intentionally — show failure notification flow
7. Show how to add a new consumer repo in 5 minutes
8. Compare with Jenkins Shared Library — show the 1:1 mapping

---

## Dependencies (All Free / Open Source)

| Tool | Purpose | License |
|---|---|---|
| [actions/setup-python](https://github.com/actions/setup-python) | Python runtime setup | MIT |
| [actions/setup-node](https://github.com/actions/setup-node) | Node.js runtime setup | MIT |
| [actions/cache](https://github.com/actions/cache) | Dependency caching | MIT |
| [aquasecurity/trivy-action](https://github.com/aquasecurity/trivy-action) | Vulnerability scanning | Apache 2.0 |
| [slackapi/slack-github-action](https://github.com/slackapi/slack-github-action) | Slack notifications | MIT |
| [googleapis/release-please-action](https://github.com/googleapis/release-please-action) | Automated releases | Apache 2.0 |
| GitHub Pages | Dashboard hosting | Free |
| GitHub REST API | Dashboard data | Free (60 req/hr unauth) |
