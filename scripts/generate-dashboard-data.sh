#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  generate-dashboard-data.sh
#  Fetches GitHub Actions data for each repo in manifest.json
#  and writes static JSON files to dashboard/data/
#  This eliminates GitHub API rate-limiting on the dashboard.
# ═══════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MANIFEST="$ROOT_DIR/dashboard/manifest.json"
DATA_DIR="$ROOT_DIR/dashboard/data"

mkdir -p "$DATA_DIR"

# Read owner from manifest
OWNER=$(jq -r '.owner' "$MANIFEST")
MAX_RUNS=$(jq -r '.maxRunsPerRepo // 20' "$MANIFEST")
REPOS=$(jq -r '.repos[].name' "$MANIFEST")

echo "Owner: $OWNER"
echo "Max runs per repo: $MAX_RUNS"
echo "Data dir: $DATA_DIR"
echo ""

# For each repo, collect runs, jobs, and annotations
for REPO in $REPOS; do
  echo "════════════════════════════════════════"
  echo "  Processing: $REPO"
  echo "════════════════════════════════════════"

  REPO_JSON="$DATA_DIR/$REPO.json"

  # 1. Fetch workflow runs
  echo "  Fetching workflow runs..."
  RUNS_RAW=$(gh api "repos/$OWNER/$REPO/actions/runs?per_page=$MAX_RUNS" 2>/dev/null || echo '{"workflow_runs":[]}')

  # Filter out Copilot and dynamic event runs, keep relevant fields
  RUNS=$(echo "$RUNS_RAW" | jq '[.workflow_runs[] | select(
    (.name // "" | ascii_downcase | contains("copilot") | not) and
    (.event != "dynamic")
  ) | {
    id,
    name: (.name // .workflow_name // "unknown"),
    status,
    conclusion,
    html_url,
    created_at,
    updated_at,
    head_branch,
    head_sha,
    event,
    run_number,
    run_started_at: (.run_started_at // .created_at),
    actor: (.actor // .triggering_actor // null | if . then {login: .login, avatar_url: .avatar_url} else null end)
  }]')

  RUN_COUNT=$(echo "$RUNS" | jq 'length')
  echo "  Found $RUN_COUNT runs (filtered)"

  # 2. Identify CI runs (non-release) and fetch jobs for the latest 3
  CI_RUN_IDS=$(echo "$RUNS" | jq -r '[.[] | select(.name | ascii_downcase | contains("release") | not)] | .[0:3] | .[].id')
  ALL_RELEASE_IDS=$(echo "$RUNS" | jq -r '[.[] | select(.name | ascii_downcase | contains("release"))] | .[].id')

  ALL_JOBS="[]"
  CI_STATS='{"lint":{},"test":{},"security":{}}'

  for RUN_ID in $CI_RUN_IDS; do
    echo "  Fetching jobs for run $RUN_ID..."
    JOBS_RAW=$(gh api "repos/$OWNER/$REPO/actions/runs/$RUN_ID/jobs" 2>/dev/null || echo '{"jobs":[]}')

    # Extract the parent run info for this run_id
    PARENT_RUN=$(echo "$RUNS" | jq --arg rid "$RUN_ID" '.[] | select(.id == ($rid | tonumber))')
    PARENT_BRANCH=$(echo "$PARENT_RUN" | jq -r '.head_branch // "main"')
    PARENT_NUMBER=$(echo "$PARENT_RUN" | jq -r '.run_number // 0')
    PARENT_EVENT=$(echo "$PARENT_RUN" | jq -r '.event // "push"')
    PARENT_ACTOR=$(echo "$PARENT_RUN" | jq '.actor // null')

    JOBS=$(echo "$JOBS_RAW" | jq --arg rid "$RUN_ID" --arg branch "$PARENT_BRANCH" \
      --arg num "$PARENT_NUMBER" --arg evt "$PARENT_EVENT" --argjson actor "$PARENT_ACTOR" \
      '[.jobs[] | {
        id,
        name: (.name // "unknown"),
        status,
        conclusion,
        html_url,
        started_at,
        completed_at,
        run_id: ($rid | tonumber),
        run_number: ($num | tonumber),
        head_branch: $branch,
        event: $evt,
        actor: $actor
      }]')

    ALL_JOBS=$(echo "$ALL_JOBS" "$JOBS" | jq -s '.[0] + .[1]')
  done

  JOB_COUNT=$(echo "$ALL_JOBS" | jq 'length')
  echo "  Total jobs collected: $JOB_COUNT"

  # 3. Fetch annotations for the LATEST CI run to get lint/test/security stats
  LATEST_CI_RUN_ID=$(echo "$RUNS" | jq -r '[.[] | select(.name | ascii_downcase | contains("release") | not)] | .[0].id // empty')

  if [ -n "$LATEST_CI_RUN_ID" ]; then
    echo "  Fetching annotations for latest CI run $LATEST_CI_RUN_ID..."
    LATEST_JOBS_RAW=$(gh api "repos/$OWNER/$REPO/actions/runs/$LATEST_CI_RUN_ID/jobs" 2>/dev/null || echo '{"jobs":[]}')
    LATEST_JOB_IDS=$(echo "$LATEST_JOBS_RAW" | jq -r '.jobs[].id')

    for JOB_ID in $LATEST_JOB_IDS; do
      ANNOTATIONS=$(gh api "repos/$OWNER/$REPO/check-runs/$JOB_ID/annotations" 2>/dev/null || echo '[]')
      ANN_COUNT=$(echo "$ANNOTATIONS" | jq 'length')
      if [ "$ANN_COUNT" -gt 0 ]; then
        echo "    Job $JOB_ID has $ANN_COUNT annotations"
        # Parse ci_lint, ci_test, ci_security annotations
        for ANN_TITLE in ci_lint ci_test ci_security; do
          MSG=$(echo "$ANNOTATIONS" | jq -r --arg t "$ANN_TITLE" '.[] | select(.title == $t) | .message // empty')
          if [ -n "$MSG" ]; then
            echo "    Found $ANN_TITLE: $MSG"
            # Parse "key1=val1|key2=val2" into JSON object
            PARSED=$(echo "$MSG" | awk -F'|' '{
              printf "{"
              for(i=1;i<=NF;i++){
                split($i,kv,"=")
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", kv[1])
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", kv[2])
                if(i>1) printf ","
                printf "\"%s\":\"%s\"", kv[1], kv[2]
              }
              printf "}"
            }')
            STAT_KEY=$(echo "$ANN_TITLE" | sed 's/ci_//')
            CI_STATS=$(echo "$CI_STATS" | jq --arg key "$STAT_KEY" --argjson val "$PARSED" '.[$key] = $val')
          fi
        done
      fi
    done
  fi

  echo "  CI Stats: $CI_STATS"

  # 4. Build the final JSON for this repo
  echo "  Writing $REPO_JSON..."
  jq -n \
    --argjson runs "$RUNS" \
    --argjson jobs "$ALL_JOBS" \
    --argjson ciStats "$CI_STATS" \
    --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      generated_at: $generated,
      runs: $runs,
      jobs: $jobs,
      ciStats: $ciStats
    }' > "$REPO_JSON"

  echo "  ✅ Done: $REPO_JSON ($(wc -c < "$REPO_JSON" | tr -d ' ') bytes)"
  echo ""
done

# 5. Generate a combined dashboard-data.json with all repos
echo "Generating combined dashboard-data.json..."
COMBINED="$DATA_DIR/dashboard-data.json"

# Build combined file
jq -n --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{ generated_at: $generated, repos: {} }' > "$COMBINED"

for REPO in $REPOS; do
  REPO_JSON="$DATA_DIR/$REPO.json"
  if [ -f "$REPO_JSON" ]; then
    COMBINED_TMP=$(mktemp)
    jq --arg repo "$REPO" --slurpfile data "$REPO_JSON" '.repos[$repo] = $data[0]' "$COMBINED" > "$COMBINED_TMP"
    mv "$COMBINED_TMP" "$COMBINED"
  fi
done

echo "✅ Combined file: $COMBINED ($(wc -c < "$COMBINED" | tr -d ' ') bytes)"
echo ""
echo "════════════════════════════════════════"
echo "  All done!"
echo "════════════════════════════════════════"
