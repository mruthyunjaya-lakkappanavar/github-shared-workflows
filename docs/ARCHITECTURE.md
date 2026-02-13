# Architecture

> Design decisions and system architecture for GitHub Reusable Workflows.

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  github-shared-workflows                     │
│                    (Central Repository)                       │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  reusable-ci.yml │  │reusable-release  │                 │
│  │                  │  │     .yml         │                 │
│  │  • Checkout      │  │  • Checkout      │                 │
│  │  • Setup tool    │  │  • Version bump  │                 │
│  │  • Install deps  │  │  • Changelog     │                 │
│  │  • Lint          │  │  • GH Release    │                 │
│  │  • Test          │  │  • Slack notify  │                 │
│  │  • Trivy scan    │  │                  │                 │
│  │  • Slack notify  │  └──────────────────┘                 │
│  └──────────────────┘                                        │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ setup-toolchain  │  │  slack-notify    │                 │
│  │   (composite)    │  │   (composite)    │                 │
│  │  • Python setup  │  │  • Color-coded   │                 │
│  │  • Node setup    │  │  • Block Kit     │                 │
│  │  • Caching       │  │  • Webhooks      │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ┌──────────────────────────────────────────┐               │
│  │           Dashboard (GitHub Pages)        │               │
│  │  • Workflow status grid                   │               │
│  │  • Health summary                         │               │
│  │  • Activity feed                          │               │
│  │  • Repository cards                       │               │
│  └──────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
          ▲ workflow_call              ▲ workflow_call
          │                            │
┌─────────┴──────────┐    ┌──────────┴───────────┐
│ sample-app-python  │    │  sample-app-node     │
│                    │    │                      │
│  ci.yml (~15 LOC)  │    │  ci.yml (~15 LOC)   │
│  release.yml       │    │  release.yml        │
│  (~15 LOC)         │    │  (~15 LOC)          │
│                    │    │                      │
│  Flask app         │    │  Express app        │
│  pytest            │    │  Jest               │
│  flake8            │    │  ESLint             │
└────────────────────┘    └──────────────────────┘
          │                            │
          └──────────┬─────────────────┘
                     ▼
             ┌──────────────┐
             │    Slack      │
             │  #builds     │
             │  #releases   │
             └──────────────┘
```

## Design Decisions

### 1. Why Reusable Workflows over Composite Actions for CI/CD?

**Reusable workflows** (`workflow_call`) run as a complete job on their own runner, providing:
- Full `jobs` context with multiple steps
- Secret forwarding support
- Independent runner environment
- Support for conditional job execution

**Composite actions** are used for atomic, reusable steps within a workflow (like toolchain setup and Slack notification).

### 2. Why Public Repository?

GitHub requires the caller to have access to the workflow file. Options:
- **Public repo** — any GitHub repo can call the workflows
- **Internal repo** — only repos in the same GitHub Enterprise org
- **Private repo** — only repos in the same GitHub Enterprise org (requires paid plan)

For maximum portability and demo purposes, we use a public repo.

### 3. Why Release Please over Semantic Release?

| Feature | Release Please | Semantic Release |
|---|---|---|
| Maintainer | Google | Community |
| Release PR | ✅ Creates a PR for review | ❌ Releases directly |
| Changelog | ✅ Auto-generated | ✅ Auto-generated |
| Monorepo | ✅ Supported | ✅ Supported |
| Complexity | Low | Medium-High |
| Dependencies | None (GitHub Action) | npm packages needed |

Release Please is simpler, creates reviewable release PRs, and has zero runtime dependencies.

### 4. Why Vanilla JS Dashboard?

- **Zero build step** — no Node.js, no bundler, no framework
- **Zero dependencies** — just HTML + CSS + JS
- **Easy to host** — GitHub Pages, no server required
- **Easy to maintain** — anyone can read and modify
- **Fast to load** — no framework overhead

### 5. Why Trivy for Security Scanning?

- **Free and open source** (Apache 2.0)
- **Comprehensive** — scans OS packages, language packages, IaC, secrets
- **GitHub Action available** — first-class `aquasecurity/trivy-action`
- **Fast** — filesystem scan takes seconds
- **No account required** — unlike Snyk, Dependabot (though those are also good)

### 6. Slack vs Other Notification Options

| Option | Pros | Cons |
|---|---|---|
| **Slack (chosen)** | Free plan, rich formatting, widely used | Requires app setup |
| GitHub Notifications | Built-in, no setup | Limited formatting |
| Email | Universal | Slow, often ignored |
| Microsoft Teams | Enterprise-friendly | More complex webhook setup |
| Discord | Free, easy webhooks | Less professional for enterprise |

Slack was chosen for its rich Block Kit formatting, incoming webhook simplicity, and industry adoption.

## Data Flow

### CI Pipeline Flow

```
Developer pushes code
  → Consumer repo ci.yml triggers
    → Calls reusable-ci.yml via workflow_call
      → setup-toolchain composite action runs
      → Dependencies installed (cached)
      → Lint runs (flake8/eslint)
      → Tests run (pytest/jest)
      → Trivy security scan
      → Results uploaded as artifacts
      → slack-notify composite action (on failure/success)
        → Slack incoming webhook → Slack channel
```

### Release Flow

```
Developer merges PR with conventional commit
  → Consumer repo release.yml triggers
    → Calls reusable-release.yml via workflow_call
      → Release Please analyzes commits
      → Creates/updates release PR (version bump + changelog)
      → On PR merge: creates GitHub Release
      → slack-notify composite action
        → Slack incoming webhook → #releases channel
```

### Dashboard Update Flow

```
Schedule (every 6 hours) OR manual dispatch
  → update-dashboard.yml triggers
    → Fetches GitHub API data for all monitored repos
    → Generates data.json
    → Commits to gh-pages branch
    → GitHub Pages auto-deploys

User visits dashboard
  → index.html loads
  → app.js fetches GitHub API directly (real-time)
  → Renders status grid, health summary, activity feed
  → Auto-refreshes every 5 minutes
```

## Jenkins Shared Library Comparison

| Jenkins Concept | GitHub Actions Equivalent |
|---|---|
| Shared Library repository | `github-shared-workflows` repository |
| `vars/*.groovy` (pipeline steps) | Composite actions (`actions/*/action.yml`) |
| `Jenkinsfile` | `.github/workflows/*.yml` |
| `@Library('shared')` import | `uses: owner/repo/.github/workflows/file.yml@ref` |
| Library parameters | `workflow_call` inputs |
| Credentials binding | GitHub Secrets + `secrets:` passthrough |
| Jenkins Dashboard | GitHub Pages dashboard |
| Pipeline stages | Workflow jobs/steps |
