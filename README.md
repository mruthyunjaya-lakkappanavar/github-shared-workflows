# GitHub Reusable Workflows

[![CI Shared Workflows](https://img.shields.io/badge/Reusable_Workflows-Active-2ea043?style=flat-square&logo=github-actions)](https://github.com/mruthyunjaya-lakkappanavar/github-shared-workflows)
[![Dashboard](https://img.shields.io/badge/Dashboard-Live-58a6ff?style=flat-square&logo=github)](https://mruthyunjaya-lakkappanavar.github.io/github-shared-workflows/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

> **Central reusable GitHub Actions workflows** — a migration path from Jenkins Shared Libraries to GitHub-native CI/CD.

## 🚀 Overview

This repository provides **reusable workflows** and **composite actions** that any GitHub repository can call with just ~15 lines of YAML. It demonstrates how to achieve the same centralization and reuse that Jenkins Shared Libraries offer, but with GitHub Actions.

### What's Included

| Component | Description |
|---|---|
| **Reusable CI Workflow** | Lint → Test → Security Scan pipeline for Python & Node.js |
| **Reusable Release Workflow** | Semantic versioning → Changelog → GitHub Release → Slack notify |
| **Setup Toolchain Action** | Composite action for Python/Node.js setup with caching |
| **Slack Notify Action** | Color-coded Slack notifications for CI/CD events |
| **Live Dashboard** | GitHub Pages dashboard showing cross-repo workflow status |

## 📦 Repository Structure

```
github-shared-workflows/
├── .github/workflows/
│   ├── reusable-ci.yml          # Reusable CI pipeline
│   ├── reusable-release.yml     # Reusable release pipeline
│   └── update-dashboard.yml     # Dashboard data updater
├── actions/
│   ├── setup-toolchain/         # Python/Node setup + caching
│   └── slack-notify/            # Slack notification action
├── dashboard/                   # GitHub Pages dashboard
├── docs/                        # Documentation
└── IMPLEMENTATION_PLAN.md       # Full implementation plan
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

| Repo | Language | Description |
|---|---|---|
| [sample-app-python](https://github.com/mruthyunjaya-lakkappanavar/sample-app-python) | Python | Flask app with shared CI + Release |
| [sample-app-node](https://github.com/mruthyunjaya-lakkappanavar/sample-app-node) | Node.js | Express app with shared CI + Release |

## 📄 Documentation

- [Usage Guide](docs/USAGE.md) — How to use the reusable workflows
- [Architecture](docs/ARCHITECTURE.md) — Design decisions and system diagram
- [Implementation Plan](IMPLEMENTATION_PLAN.md) — Full implementation details

## License

MIT
