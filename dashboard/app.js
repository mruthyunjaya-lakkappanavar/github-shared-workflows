/**
 * GitHub Actions Dashboard
 * Fetches workflow run data from GitHub API and renders status
 */

(async function () {
  "use strict";

  const API_BASE = "https://api.github.com";
  let config = null;

  // ── Load Config ──
  async function loadConfig() {
    const resp = await fetch("config.json");
    config = await resp.json();
    return config;
  }

  // ── GitHub API Helper ──
  async function ghFetch(path) {
    try {
      const resp = await fetch(`${API_BASE}${path}`);
      if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
      return await resp.json();
    } catch (err) {
      console.error(`API error for ${path}:`, err);
      return null;
    }
  }

  // ── Time Formatting ──
  function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // ── Render Health Summary ──
  function renderHealthSummary(allRuns) {
    const container = document.getElementById("summary-cards");
    const total = allRuns.length;
    const successes = allRuns.filter((r) => r.conclusion === "success").length;
    const failures = allRuns.filter((r) => r.conclusion === "failure").length;
    const passRate = total > 0 ? Math.round((successes / total) * 100) : 0;

    // Calculate current success streak
    let streak = 0;
    for (const run of allRuns) {
      if (run.conclusion === "success") streak++;
      else break;
    }

    container.innerHTML = `
      <div class="summary-card">
        <div class="label">Total Runs</div>
        <div class="value info">${total}</div>
      </div>
      <div class="summary-card">
        <div class="label">Pass Rate</div>
        <div class="value ${passRate >= 80 ? "success" : "failure"}">${passRate}%</div>
      </div>
      <div class="summary-card">
        <div class="label">Successes</div>
        <div class="value success">${successes}</div>
      </div>
      <div class="summary-card">
        <div class="label">Failures</div>
        <div class="value failure">${failures}</div>
      </div>
      <div class="summary-card">
        <div class="label">Success Streak</div>
        <div class="value success">${streak}</div>
      </div>
    `;
  }

  // ── Render Workflow Status Grid ──
  function renderStatusGrid(repoName, runs) {
    const container = document.getElementById("repo-grids");

    const grid = document.createElement("div");
    grid.className = "repo-grid";

    const latest = runs.slice(0, 5);
    const runsHTML = latest
      .map((run) => {
        const conclusion = run.conclusion || run.status || "queued";
        return `
        <a href="${run.html_url}" target="_blank" class="run-item">
          <span class="status-dot ${conclusion}"></span>
          <span class="run-name">${run.name} #${run.run_number}</span>
          <span class="run-meta">${run.head_branch} · ${timeAgo(run.created_at)}</span>
        </a>`;
      })
      .join("");

    grid.innerHTML = `
      <h3>📦 ${repoName}</h3>
      <div class="run-list">
        ${runsHTML || '<div class="loading">No runs found</div>'}
      </div>
    `;

    container.appendChild(grid);
  }

  // ── Render Activity Feed ──
  function renderActivityFeed(allRuns) {
    const container = document.getElementById("activity-list");
    const recent = allRuns.slice(0, 15);

    if (recent.length === 0) {
      container.innerHTML = '<div class="loading">No recent activity</div>';
      return;
    }

    container.innerHTML = recent
      .map((run) => {
        const conclusion = run.conclusion || run.status || "queued";
        const icon =
          conclusion === "success"
            ? "✅"
            : conclusion === "failure"
            ? "❌"
            : conclusion === "cancelled"
            ? "⚠️"
            : "🔄";
        return `
        <a href="${run.html_url}" target="_blank" class="activity-item">
          <span>${icon}</span>
          <span class="run-name">${run.repo} / ${run.name} #${run.run_number}</span>
          <span class="run-meta">${run.head_branch} by ${run.actor}</span>
          <span class="timestamp">${timeAgo(run.created_at)}</span>
        </a>`;
      })
      .join("");
  }

  // ── Render Repository Cards ──
  function renderRepoCards(repos) {
    const container = document.getElementById("repo-card-grid");

    container.innerHTML = repos
      .map(
        (repo) => `
      <div class="repo-card">
        <h3><a href="${repo.html_url}" target="_blank">${repo.name}</a></h3>
        <p class="description">${repo.description || "No description"}</p>
        <div class="repo-stats">
          <span>⭐ ${repo.stargazers_count}</span>
          <span>🍴 ${repo.forks_count}</span>
          <span>📝 ${repo.open_issues_count} issues</span>
          <span>📅 Updated ${timeAgo(repo.updated_at)}</span>
        </div>
      </div>
    `
      )
      .join("");
  }

  // ── Main Fetch & Render ──
  async function fetchAndRender() {
    document.getElementById("refresh-btn").disabled = true;
    document.getElementById("repo-grids").innerHTML = '<div class="loading">Loading workflow data...</div>';
    document.getElementById("activity-list").innerHTML = '<div class="loading">Loading...</div>';
    document.getElementById("summary-cards").innerHTML = '<div class="loading">Loading...</div>';
    document.getElementById("repo-card-grid").innerHTML = '<div class="loading">Loading...</div>';

    try {
      const allRuns = [];
      const repoDetails = [];

      // Clear grids before populating
      document.getElementById("repo-grids").innerHTML = "";

      for (const repo of config.repos) {
        const fullName = `${config.owner}/${repo.name}`;

        // Fetch workflow runs
        const runsData = await ghFetch(
          `/repos/${fullName}/actions/runs?per_page=10`
        );

        if (runsData && runsData.workflow_runs) {
          const runs = runsData.workflow_runs.map((r) => ({
            ...r,
            repo: repo.name,
            actor: r.actor?.login || "unknown",
          }));
          renderStatusGrid(repo.name, runs);
          allRuns.push(...runs);
        } else {
          renderStatusGrid(repo.name, []);
        }

        // Fetch repo details
        const repoData = await ghFetch(`/repos/${fullName}`);
        if (repoData) repoDetails.push(repoData);
      }

      // Sort all runs by date (newest first)
      allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      renderHealthSummary(allRuns);
      renderActivityFeed(allRuns);
      renderRepoCards(repoDetails);

      document.getElementById("last-updated").textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      console.error("Dashboard error:", err);
      document.getElementById("repo-grids").innerHTML =
        '<div class="error-msg">Failed to load data. GitHub API rate limit may have been exceeded.</div>';
    }

    document.getElementById("refresh-btn").disabled = false;
  }

  // ── Init ──
  await loadConfig();
  await fetchAndRender();

  // Auto-refresh
  setInterval(fetchAndRender, config.refreshIntervalMs);

  // Manual refresh
  document.getElementById("refresh-btn").addEventListener("click", fetchAndRender);
})();
