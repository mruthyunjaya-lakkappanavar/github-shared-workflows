# GitHub Reusable Workflows

[![CI Shared Workflows](https://img.shields.io/badge/Reusable_Workflows-Active-2ea043?style=flat-square&logo=github-actions)](https://github.com/mruthyunjaya-lakkappanavar/github-shared-workflows)
[![Dashboard](https://img.shields.io/badge/Dashboard-Live-58a6ff?style=flat-square&logo=github)](https://mruthyunjaya-lakkappanavar.github.io/github-shared-workflows/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square)](LICENSE)

> **Central reusable GitHub Actions workflows** — a migration path from Jenkins Shared Libraries to GitHub-native CI/CD.

## 🚀 Overview

This repository provides **reusable workflows** and **composite actions** that any GitHub repository can call with just ~15 lines of YAML. It demonstrates how to achieve the same centralization and reuse that Jenkins Shared Libraries offer, but with GitHub Actions.

### What's Included

| Component | Description |
|---|---|
| **Reusable CI Workflow** | Lint → Test → Security Scan pipeline for Python, Node.js & Go |
| **Reusable Matrix CI Workflow** | Multi-version × multi-OS × parallel test suites |
| **Reusable Integration CI Workflow** | Service containers, parallel stages, Docker build/push, deploy gates |
| **Reusable Publish Workflow** | Build → Staging → Production with environment approval gates |
| **Setup Toolchain Action** | Composite action for Python/Node.js/Go setup with caching |
| **Slack Notify Action** | Color-coded Slack notifications for CI/CD events |
| **Live Dashboard** | GitHub Pages dashboard showing cross-repo workflow status |

## 📦 Repository Structure

```
github-shared-workflows/
├── .github/
│   ├── workflows/
│   │   ├── reusable-ci.yml              # Standard CI: lint + test + security
│   │   ├── reusable-matrix-ci.yml       # Matrix CI: version × OS × test type
│   │   ├── reusable-integration-ci.yml  # Integration CI: services + Docker + deploy
│   │   ├── reusable-publish.yml         # Package publishing with env gates
│   │   ├── reusable-release.yml         # Semantic release pipeline
│   │   └── update-dashboard.yml         # Dashboard data updater
│   └── dependabot.yml                   # Automated dependency updates (GHA-exclusive)
├── actions/
│   ├── setup-toolchain/                 # Python/Node/Go setup + caching
│   └── slack-notify/                    # Slack notification action
├── dashboard/                           # GitHub Pages dashboard
├── docs/                                # Documentation
└── IMPLEMENTATION_PLAN.md               # Full implementation plan
```

## ⚡ Quick Start

### Use the CI Workflow

Create `.github/workflows/ci.yml` in your repository:

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
      language: python          # or "node"
      language_version: "3.11"  # or "20"
      enable_lint: true
      enable_security_scan: true
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Use the Release Workflow

Create `.github/workflows/release.yml`:

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

## 🔧 Workflow Inputs

### `reusable-ci.yml`

| Input | Type | Default | Description |
|---|---|---|---|
| `language` | string | *required* | `python` or `node` |
| `language_version` | string | *required* | e.g., `3.11`, `20` |
| `working_directory` | string | `.` | Path to source code |
| `enable_lint` | boolean | `true` | Run linting |
| `enable_security_scan` | boolean | `true` | Run Trivy scan |
| `enable_test` | boolean | `true` | Run test suite |

### `reusable-release.yml`

| Input | Type | Default | Description |
|---|---|---|---|
| `language` | string | *required* | `python` or `node` |
| `release_type` | string | `auto` | `auto`, `patch`, `minor`, `major` |
| `enable_changelog` | boolean | `true` | Auto-generate changelog |
| `enable_slack_notify` | boolean | `true` | Slack release notification |

## 🔔 Slack Integration

1. Create a Slack App with Incoming Webhooks enabled
2. Add the webhook URL as `SLACK_WEBHOOK_URL` secret in your repo
3. Notifications are sent on CI failure, CI success (main), and new releases

## 📊 Dashboard

Live at: [mruthyunjaya-lakkappanavar.github.io/github-shared-workflows](https://mruthyunjaya-lakkappanavar.github.io/github-shared-workflows/)

- **Workflow Status Grid** — Last 5 runs per repo with status badges
- **Health Summary** — Pass rate, success streak, build stats
- **Recent Activity Feed** — Timeline across all repos
- **Repository Cards** — Repo metadata and links

## 🏗️ Consumer Repos

| Repo | Language | Workflows Used | Description |
|---|---|---|---|
| [sample-app-python](https://github.com/mruthyunjaya-lakkappanavar/sample-app-python) | Python | reusable-ci + reusable-integration-ci | FastAPI app with DB, Docker, parallel stages |
| [sample-lib-node](https://github.com/mruthyunjaya-lakkappanavar/sample-lib-node) | Node.js | reusable-matrix-ci + reusable-publish | HTTP client library with 3×3×2 matrix CI |
| [sample-app-node](https://github.com/mruthyunjaya-lakkappanavar/sample-app-node) | Node.js | reusable-ci + reusable-release | Express app with shared CI + Release |

## 🔄 Jenkins → GHA Feature Map

| Jenkins Feature | GHA Equivalent | Demonstrated In |
|---|---|---|
| `matrix { axes {} }` | `strategy.matrix` + `fromJSON()` | reusable-matrix-ci.yml |
| `parallel { stage {} }` | Multiple jobs in same workflow | reusable-integration-ci.yml |
| `agent { docker {} }` / service links | `services:` (PostgreSQL, Redis) | reusable-integration-ci.yml |
| `input "Deploy?"` / Build Promotion | `environment:` with protection rules | reusable-publish.yml |
| `docker.build / docker.push` | `docker/build-push-action` | reusable-integration-ci.yml |
| `@Library('shared')` | `uses: org/repo/.github/workflows/x.yml@ref` | All consumer workflows |
| `withCredentials()` | Environment-scoped secrets | reusable-publish.yml |
| `timeout(time: 30)` | `timeout-minutes:` on jobs | All reusable workflows |
| `disableConcurrentBuilds()` | `concurrency:` + `cancel-in-progress` | Consumer ci.yml files |
| `triggers { cron() }` | `schedule:` with cron syntax | Consumer ci.yml files |
| `parameters {}` block | `workflow_dispatch.inputs` with choices | Consumer ci.yml files |
| `when { changeset }` | `on.push.paths` filter | Consumer ci.yml files |
| `stash/unstash` | `upload-artifact` / `download-artifact` | reusable-matrix-ci.yml |
| `post { always {} }` | `if: always()` on jobs/steps | All reusable workflows |
| `failFast false` | `strategy.fail-fast: false` | reusable-matrix-ci.yml |

### GHA-Exclusive Features (no Jenkins equivalent out of box)

| Feature | What It Does |
|---|---|
| **`cancel-in-progress`** | Auto-cancel redundant runs when new commit pushed |
| **Dependabot** | Native dependency update PRs — zero config needed |
| **OIDC federation** | `id-token: write` — no stored secrets for cloud auth |
| **Hosted runners** | Free ubuntu/macos/windows — zero infrastructure |
| **`GITHUB_TOKEN`** | Auto-scoped, auto-rotated token — no credential management |
| **GitHub Environments** | UI approvals + deployment history + wait timers |
| **Docker layer cache (GHA)** | `cache-from: type=gha` — shared across workflow runs |

## 📄 Documentation

- [Usage Guide](docs/USAGE.md) — How to use the reusable workflows
- [Architecture](docs/ARCHITECTURE.md) — Design decisions and system diagram
- [Implementation Plan](IMPLEMENTATION_PLAN.md) — Full implementation details

## License

Apache 2.0
