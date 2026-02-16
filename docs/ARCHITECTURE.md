# Architecture

> Design decisions and system architecture for GitHub Reusable Workflows.

## System Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           github-shared-workflows                                   │
│                             (Central Repository)                                    │
│                                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────┐     │
│  │   reusable-ci.yml   │  │ reusable-release.yml│  │ reusable-matrix-ci.yml  │     │
│  │                     │  │                     │  │                         │     │
│  │  • Lint             │  │  • Release Please   │  │  • Version × OS matrix  │     │
│  │  • Test             │  │  • Changelog        │  │  • Parallel test types  │     │
│  │  • Security Scan    │  │  • GH Release       │  │  • Build verification   │     │
│  │  • CI Summary       │  │  • Slack notify     │  │  • fromJSON() dynamic   │     │
│  │  • Slack notify     │  │                     │  │  • Matrix summary       │     │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────────┘     │
│                                                                                     │
│  ┌──────────────────────────┐  ┌───────────────────────────┐                       │
│  │ reusable-integration-ci  │  │   reusable-publish.yml    │                       │
│  │         .yml             │  │                           │                       │
│  │  • Service containers    │  │  • Build → Package        │                       │
│  │    (PostgreSQL, Redis)   │  │  • Staging (@next tag)    │                       │
│  │  • Sanity tests          │  │  • Production (@latest)   │                       │
│  │  • Regression matrix     │  │  • Environment gates      │                       │
│  │  • Performance tests     │  │  • GitHub Releases        │                       │
│  │  • Docker build/push     │  │  • OIDC token support     │                       │
│  │  • Deploy staging/prod   │  │                           │                       │
│  └──────────────────────────┘  └───────────────────────────┘                       │
│                                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐                                  │
│  │  setup-toolchain    │  │   slack-notify      │                                  │
│  │   (composite)       │  │   (composite)       │                                  │
│  │  • Python/Node/Go   │  │  • Color-coded      │                                  │
│  │  • Dep caching      │  │  • Block Kit        │                                  │
│  └─────────────────────┘  └─────────────────────┘                                  │
│                                                                                     │
│  ┌──────────────────────────────────────────────────────┐                           │
│  │                Dashboard (GitHub Pages)               │                           │
│  │  • Workflow status grid  • Repository cards           │                           │
│  │  • Health summary        • Activity feed              │                           │
│  └──────────────────────────────────────────────────────┘                           │
└────────────────────────────────────────────────────────────────────────────────────┘
          ▲ workflow_call              ▲ workflow_call              ▲ workflow_call
          │                            │                            │
┌─────────┴──────────┐    ┌──────────┴───────────┐    ┌──────────┴───────────┐
│ sample-app-python  │    │  sample-app-node     │    │  sample-app-go      │
│                    │    │                      │    │                      │
│  ci.yml calls:     │    │  ci.yml (~15 LOC)   │    │  ci.yml (~15 LOC)   │
│  • reusable-ci     │    │  release.yml        │    │  release.yml        │
│  • reusable-       │    │                      │    │                      │
│    integration-ci  │    │  Express+TS app     │    │  Go HTTP server     │
│  release.yml       │    │  Jest               │    │  go test            │
│                    │    │  ESLint             │    │  golangci-lint      │
│  FastAPI + SQLAlch │    │                      │    │                      │
│  PostgreSQL (CI)   │    └──────────────────────┘    └──────────────────────┘
│  Dockerfile        │
│  Sanity/Regression/│               ┌──────────────────────────┐
│  Performance tests │               │   sample-lib-node (NEW)  │
└────────────────────┘               │                          │
          │                          │  ci.yml calls:           │
          │                          │  • reusable-matrix-ci    │
          │                          │  publish.yml calls:      │
          │                          │  • reusable-publish      │
          │                          │  release.yml             │
          │                          │                          │
          │                          │  HTTP client library     │
          │                          │  Node 18/20/22 × 3 OS   │
          │                          │  Unit + Integration      │
          │                          │  npm package publishing  │
          │                          └──────────────────────────┘
          │                                      │
          └──────────────┬───────────────────────┘
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

### 7. Why `fromJSON()` for Dynamic Matrix?

GitHub Actions `strategy.matrix` accepts a static YAML list OR a JSON string via `fromJSON()`. By accepting `language_versions`, `os_matrix`, and `test_types` as JSON-array strings from consumer workflows, the reusable workflow becomes fully dynamic — consumers control the matrix dimensions without forking or modifying the shared workflow. This is the GHA equivalent of Jenkins' `matrix {}` axis declarations but more flexible since axes are runtime inputs.

### 8. Why Service Containers over Docker Compose?

| Approach | Pros | Cons |
|---|---|---|
| **Service containers (chosen)** | Native GHA, auto-networking, health checks | Linux runners only |
| Docker Compose | Full control, local parity | Requires manual setup, slower startup |
| Testcontainers | Programmatic, language-native | Requires DinD or special runner config |

Service containers are the idiomatic GHA approach — the runner manages lifecycle, networking (localhost ports), and health checks automatically. They map directly to Jenkins' `agent { docker {} }` with linked services.

### 9. Why GitHub Environments for Deployment Gates?

GitHub Environments provide UI-based approval gates, deployment history, and environment-specific secrets — all without plugins. In Jenkins, achieving the same requires the Input step, Role Strategy plugin, and manual credential scoping. GHA environments also integrate with OIDC for cloud provider authentication, eliminating long-lived secrets entirely.

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

### Matrix CI Pipeline Flow

```
Developer pushes code
  → Consumer repo ci.yml triggers
    → Calls reusable-matrix-ci.yml via workflow_call
      → Lint job runs (single runner)
      → Matrix test job expands via fromJSON():
        ┌─ Node 18 × ubuntu  × unit
        ├─ Node 18 × ubuntu  × integration
        ├─ Node 18 × macos   × unit
        ├─ Node 18 × macos   × integration
        ├─ Node 20 × ubuntu  × unit
        ├─ ... (N versions × M OSes × K test types)
        └─ Node 22 × windows × integration
      → Each cell: setup → deps → run tests → upload result artifact
      → Security scan job (single runner)
      → Build verification job (optional, single runner)
      → Summary job:
        → Downloads all result artifacts
        → Aggregates into markdown table
        → Posts as PR comment via github-script
```

### Integration CI Pipeline Flow

```
Developer pushes code (sample-app-python)
  → Consumer ci.yml triggers
    → Calls reusable-integration-ci.yml via workflow_call
      → Parallel stage 1:
        ┌─ Sanity tests (PostgreSQL + Redis service containers)
        ├─ Regression tests (version matrix × PostgreSQL)
        └─ Performance tests (response time, throughput, stress)
      → Docker build job (depends on all test stages)
        → docker/build-push-action with BuildX + GHA cache
        → Push to GHCR
      → Deploy staging (environment: staging)
      → Deploy production (environment: production, manual approval)
      → Integration summary job
```

### Publish Pipeline Flow

```
Manual dispatch or release tag
  → Consumer publish.yml triggers
    → Calls reusable-publish.yml via workflow_call
      → Build job:
        → Extract version from package.json / setup.py
        → Build package (npm pack / python -m build)
        → Upload artifact
      → Publish staging (environment: staging):
        → Download artifact
        → Publish with @next / --index-url test.pypi.org
      → Publish production (environment: production, approval gate):
        → Download artifact
        → Publish with @latest / --index-url pypi.org
        → Create GitHub Release
```

## Jenkins Shared Library Comparison

| Jenkins Concept | GitHub Actions Equivalent | Where Demonstrated |
|---|---|---|
| Shared Library repository | `github-shared-workflows` repository | This repo |
| `vars/*.groovy` (pipeline steps) | Composite actions (`actions/*/action.yml`) | setup-toolchain, slack-notify |
| `Jenkinsfile` | `.github/workflows/*.yml` | Consumer repos |
| `@Library('shared')` import | `uses: owner/repo/.github/workflows/file.yml@ref` | All consumer workflows |
| Library parameters | `workflow_call` inputs | All reusable workflows |
| Credentials binding | GitHub Secrets + `secrets:` passthrough | reusable-ci, reusable-publish |
| Jenkins Dashboard | GitHub Pages dashboard | dashboard/ |
| Pipeline stages | Workflow jobs/steps | All workflows |
| **Matrix builds** (`matrix {}` axis) | `strategy.matrix` with `fromJSON()` for dynamic axes | reusable-matrix-ci |
| **Docker agent / `agent { docker {} }`** | `services:` block (PostgreSQL, Redis as sidecars) | reusable-integration-ci |
| **`stage('Deploy to Staging')`** | `environment:` with protection rules + approval gates | reusable-publish, reusable-integration-ci |
| **Docker build/push plugin** | `docker/build-push-action` with BuildX + GHA layer cache | reusable-integration-ci |
| **Jenkins credentials (OIDC)** | `id-token: write` permission (native OIDC, no plugins) | reusable-publish |
| **`parallel { }` block** | Multiple jobs in same workflow (DAG via `needs:`) | reusable-integration-ci |
| **`lock()` / throttle** | `concurrency:` groups with `cancel-in-progress` | Consumer ci.yml files |
| **Shared Lib `call()` method** | `workflow_call` with typed inputs/secrets | All reusable workflows |
| **Build artifacts archiving** | `actions/upload-artifact` / `download-artifact` v4 | reusable-matrix-ci, reusable-publish |
| **Pipeline `post { always {} }`** | `if: always()` on jobs/steps | All reusable workflows |
| **`timeout(time: 30, unit: 'MINUTES')`** | `timeout-minutes:` on jobs | All reusable workflows |
| **`disableConcurrentBuilds()`** | `concurrency:` + `cancel-in-progress: true` | Consumer ci.yml files |
| **`triggers { cron('0 2 * * *') }`** | `schedule:` with cron syntax | Consumer ci.yml files |
| **`parameters { choice() }`** | `workflow_dispatch.inputs` with `type: choice` | Consumer ci.yml files |
| **`when { changeset "src/**" }`** | `on.push.paths` filter | Consumer ci.yml files |
| **`failFast false`** | `strategy.fail-fast: false` | reusable-matrix-ci |
| **`retry(3) { }`** | Retry-logic in setup-toolchain composite action | setup-toolchain |

### GHA Capabilities Beyond Jenkins

| Feature | GitHub Actions | Jenkins |
|---|---|---|
| **OIDC Federation** | Native (`id-token: write`) — no stored secrets | Requires plugin + credential store |
| **Hosted runners** | Free (ubuntu/macos/windows), zero maintenance | Self-hosted only (or CloudBees) |
| **Concurrency groups** | Built-in `concurrency:` key with cancel-in-progress | Requires Lockable Resources plugin |
| **Dynamic matrix** | `fromJSON()` generates axes at runtime | Scripted pipeline or Matrix plugin |
| **Environment gates** | UI-based approvals with reviewers + wait timers | Requires Input step or Role Strategy |
| **Starter workflows** | Org-wide templates in `.github` repo | Shared Library + job-dsl |
| **Dependency caching** | `actions/cache` or built-in (`setup-node`, etc.) | Plugin-based (e.g., Artifactory cache) |
| **Dependabot** | Native dependency update PRs — zero config | No built-in equivalent |
| **Cancel-in-progress** | Auto-cancel redundant runs on same branch | No built-in equivalent |
| **Path-based triggers** | `on.push.paths` — skip CI when irrelevant files change | Requires changeset condition (limited) |
| **GITHUB_TOKEN** | Auto-scoped, auto-rotated, per-job permissions | Manual credential management |
| **Docker layer cache (GHA)** | `cache-from: type=gha` — shared across runs | Requires registry or volume caching |
| **Immutable logs** | GitHub-hosted, tamper-proof | Self-managed, needs backup strategy |
