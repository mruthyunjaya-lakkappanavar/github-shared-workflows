# Usage Guide

> How to use the reusable workflows from `github-shared-workflows` in your repositories.

## Prerequisites

- Your repository must be on GitHub
- The `github-shared-workflows` repo must be public (or in the same org with internal visibility)
- For Slack notifications: a Slack incoming webhook URL stored as a repository secret

## Step 1: Add CI Workflow

Create `.github/workflows/ci.yml` in your repository:

### Python Project

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
      enable_test: true
      enable_security_scan: true
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Node.js Project

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
      language: node
      language_version: "20"
      enable_lint: true
      enable_test: true
      enable_security_scan: true
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

## Step 2: Add Release Workflow

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
      language: python  # or "node"
      enable_changelog: true
      enable_slack_notify: true
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

## Step 3: Configure Secrets

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `SLACK_WEBHOOK_URL`
4. Value: Your Slack incoming webhook URL

## Step 4: Use Conventional Commits

For automatic releases, use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new endpoint        → triggers a minor release
fix: correct parsing bug      → triggers a patch release
feat!: redesign API           → triggers a major release
chore: update dependencies    → no release
```

## CI Pipeline Details

The reusable CI workflow runs the following steps:

| Step | Python | Node.js |
|---|---|---|
| Checkout | `actions/checkout@v4` | `actions/checkout@v4` |
| Setup | `actions/setup-python` | `actions/setup-node` |
| Install deps | `pip install -r requirements.txt` | `npm ci` |
| Lint | `flake8` | `eslint` |
| Test | `pytest` | `jest` |
| Security scan | `trivy fs` | `trivy fs` |
| Notifications | Slack on failure/success | Slack on failure/success |

## Customization

### Disable specific steps

```yaml
with:
  language: python
  language_version: "3.11"
  enable_lint: false        # Skip linting
  enable_security_scan: false  # Skip Trivy
```

### Custom working directory

```yaml
with:
  language: node
  language_version: "20"
  working_directory: "./packages/api"
```

## Troubleshooting

| Issue | Solution |
|---|---|
| "reusable workflow not found" | Ensure `github-shared-workflows` is public |
| Slack notifications not sending | Verify `SLACK_WEBHOOK_URL` secret is set |
| Cache not working | Ensure `requirements.txt` or `package-lock.json` exists |
| Tests not found | Ensure test files follow naming conventions (`test_*.py` or `*.test.js`) |
