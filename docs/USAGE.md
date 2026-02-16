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

---

## Advanced Workflows

### Matrix CI (multi-version × multi-OS × parallel test types)

Use `reusable-matrix-ci.yml` when you need to verify a library across multiple language versions, operating systems, and test categories simultaneously.

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    uses: mruthyunjaya-lakkappanavar/github-shared-workflows/.github/workflows/reusable-matrix-ci.yml@main
    with:
      language: node
      language_versions: '["18", "20", "22"]'
      os_matrix: '["ubuntu-latest", "macos-latest", "windows-latest"]'
      test_types: '["unit", "integration"]'
      fail_fast: false
      coverage_threshold: 80
      enable_build: true
      build_script: "npm run build"
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

**Key inputs:**

| Input | Type | Description |
|---|---|---|
| `language_versions` | JSON array string | Language versions to test (e.g., `'["3.11", "3.12"]'`) |
| `os_matrix` | JSON array string | OS runners (e.g., `'["ubuntu-latest"]'`) |
| `test_types` | JSON array string | Test categories matching npm/pytest scripts (e.g., `'["unit", "integration"]'`) |
| `fail_fast` | boolean | Stop all matrix jobs if one fails (default: `false`) |
| `coverage_threshold` | number | Minimum coverage percentage (default: `80`) |
| `enable_build` | boolean | Run a build verification step after tests (default: `false`) |

**What it does:** Expands into N×M×K parallel jobs (e.g., 3 versions × 3 OSes × 2 test types = 18 jobs), aggregates results into a markdown summary posted as a PR comment.

### Integration CI (service containers, Docker build, deployment)

Use `reusable-integration-ci.yml` for applications that need database-backed tests, Docker image building, and staged deployments.

Create `.github/workflows/ci.yml`:

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
      language_version: "3.12"
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}

  integration:
    uses: mruthyunjaya-lakkappanavar/github-shared-workflows/.github/workflows/reusable-integration-ci.yml@main
    with:
      language: python
      language_versions: '["3.11", "3.12", "3.13"]'
      enable_sanity: true
      enable_regression: true
      enable_performance: true
      enable_docker_build: true
      docker_image_name: "my-app"
      enable_deploy_staging: true
      enable_deploy_production: true
    secrets:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

**Key inputs:**

| Input | Type | Description |
|---|---|---|
| `enable_sanity` | boolean | Run smoke/sanity tests with PostgreSQL + Redis |
| `enable_regression` | boolean | Run full regression tests across version matrix |
| `enable_performance` | boolean | Run performance/load tests |
| `enable_docker_build` | boolean | Build and push Docker image to GHCR |
| `docker_image_name` | string | Image name in GHCR |
| `enable_deploy_staging` | boolean | Deploy to staging environment |
| `enable_deploy_production` | boolean | Deploy to production (requires manual approval) |

**What it does:** Runs sanity/regression/performance tests in parallel (with PostgreSQL and Redis service containers), then builds a Docker image, then deploys through staging → production with environment approval gates.

**Test markers:** Your pytest tests must use markers to route to the correct stage:
```python
@pytest.mark.sanity
def test_health_check(): ...

@pytest.mark.regression
def test_crud_operations(): ...

@pytest.mark.performance
def test_response_time(): ...
```

### Package Publishing (staging → production with environment gates)

Use `reusable-publish.yml` for npm or PyPI package publishing with staged rollout.

Create `.github/workflows/publish.yml`:

```yaml
name: Publish
on:
  workflow_dispatch:

jobs:
  publish:
    uses: mruthyunjaya-lakkappanavar/github-shared-workflows/.github/workflows/reusable-publish.yml@main
    with:
      language: node
      registry: github          # "npm" or "github" or "pypi"
      enable_staging: true
      enable_production: true
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
    permissions:
      contents: write
      packages: write
      id-token: write
```

**Key inputs:**

| Input | Type | Description |
|---|---|---|
| `language` | string | `node` or `python` |
| `registry` | string | `npm`, `github` (GHCR), or `pypi` |
| `enable_staging` | boolean | Publish with `@next` tag / test PyPI |
| `enable_production` | boolean | Publish with `@latest` tag / production PyPI (requires approval) |

**What it does:** Builds the package, publishes to staging (with `@next` tag for npm or test.pypi.org for Python), then waits for manual approval before publishing to production and creating a GitHub Release.

### Environment Setup

For deployment workflows (`reusable-integration-ci.yml` and `reusable-publish.yml`), configure GitHub Environments:

1. Go to your repo → **Settings** → **Environments**
2. Create `staging` environment (optional: add reviewers for staging gate)
3. Create `production` environment → **Add required reviewers** → add team leads
4. Optionally add environment-specific secrets (e.g., `DEPLOY_TOKEN`)
