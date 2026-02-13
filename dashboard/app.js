/* ═══════════════════════════════════════════════════════════
   CI/CD Dashboard — Client-Side Engine  (v2.0)
   ══════════════════════════════════════════════════════════
   Architecture:
     1. Reads manifest.json for repo list & config
     2. Fetches live workflow run data from GitHub REST API
     3. Falls back to static data/{repo}.json files if API fails
     4. Renders summary, repo cards, timeline, and insights
     5. Auto-refreshes on configurable interval
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ─── Constants ───
const GITHUB_API = 'https://api.github.com';
const CACHE_KEY  = 'dashboard_cache';
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

// ─── State ───
let manifest  = null;
let allRuns   = [];
let repoData  = {};  // { repoKey: { runs, conclusion, workflows } }
let refreshTimer = null;
let isLoading = false;

// ─── Bootstrap ───
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await init();
});

async function init() {
  try {
    manifest = await fetchJSON('manifest.json');
    applyManifestConfig();
    await refresh();
    startAutoRefresh();
  } catch (err) {
    showGlobalError('Failed to load dashboard configuration: ' + err.message);
  }
}

// ─── Event Bindings ───
function bindEvents() {
  document.getElementById('refresh-btn').addEventListener('click', () => refresh());

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyRepoFilter(btn.dataset.filter);
    });
  });
}

// ─── Manifest Config ───
function applyManifestConfig() {
  if (!manifest) return;
  if (manifest.title) document.getElementById('dashboard-title').textContent = manifest.title;
  if (manifest.subtitle) document.getElementById('dashboard-subtitle').textContent = manifest.subtitle;
  if (manifest.version) document.getElementById('footer-version').textContent = manifest.version;
}

// ─── Data Fetching ───
async function refresh() {
  if (isLoading) return;
  isLoading = true;
  setRefreshing(true);

  try {
    const repos = manifest.repos || [];
    const results = await Promise.allSettled(
      repos.map(repo => fetchRepoData(repo))
    );

    allRuns = [];
    repoData = {};

    results.forEach((result, idx) => {
      const repo = repos[idx];
      const key = repo.name;
      if (result.status === 'fulfilled' && result.value) {
        repoData[key] = result.value;
        allRuns.push(...(result.value.runs || []).map(r => ({ ...r, _repo: repo })));
      } else {
        repoData[key] = { runs: [], conclusion: 'unknown', error: true };
      }
    });

    // Sort all runs by date descending
    allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Cache the data
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        ts: Date.now(),
        repoData,
        allRuns
      }));
    } catch (_) { /* ignore quota errors */ }

    render();
    updateDataSourceBadge('live');
    updateLastRefreshed();
  } catch (err) {
    // Try cache fallback
    const cached = loadCache();
    if (cached) {
      repoData = cached.repoData;
      allRuns = cached.allRuns;
      render();
      updateDataSourceBadge('cached');
    } else {
      showGlobalError('Failed to fetch data: ' + err.message);
      updateDataSourceBadge('error');
    }
  } finally {
    isLoading = false;
    setRefreshing(false);
  }
}

async function fetchRepoData(repo) {
  const owner = manifest.owner;
  const name = repo.name;
  const maxRuns = manifest.maxRunsPerRepo || 20;

  // Try GitHub API first
  try {
    const url = `${GITHUB_API}/repos/${owner}/${name}/actions/runs?per_page=${maxRuns}&status=completed`;
    const data = await fetchJSON(url);

    if (data && data.workflow_runs) {
      const runs = data.workflow_runs.map(normalizeRun);
      const latestConclusion = runs.length > 0 ? runs[0].conclusion : 'unknown';

      return {
        runs,
        conclusion: latestConclusion,
        totalCount: data.total_count || runs.length
      };
    }
  } catch (apiErr) {
    console.warn(`API fetch failed for ${name}, trying static data...`, apiErr.message);
  }

  // Fallback to static data file
  try {
    const dataPath = manifest.dataPath || 'data';
    const staticData = await fetchJSON(`${dataPath}/${name}.json`);
    if (staticData && staticData.runs) {
      return {
        runs: staticData.runs.map(normalizeRun),
        conclusion: staticData.runs[0]?.conclusion || 'unknown',
        totalCount: staticData.runs.length,
        isStatic: true
      };
    }
  } catch (_) {
    console.warn(`Static data also unavailable for ${name}`);
  }

  return null;
}

function normalizeRun(run) {
  return {
    id:            run.id,
    name:          run.name || run.workflow_name || 'unknown',
    status:        run.status || 'completed',
    conclusion:    run.conclusion || 'unknown',
    html_url:      run.html_url || '#',
    created_at:    run.created_at || run.updated_at || new Date().toISOString(),
    updated_at:    run.updated_at || run.created_at || new Date().toISOString(),
    head_branch:   run.head_branch || 'main',
    head_sha:      run.head_sha || '',
    event:         run.event || 'push',
    run_number:    run.run_number || 0,
    actor:         run.actor || run.triggering_actor || null,
    run_started_at: run.run_started_at || run.created_at
  };
}

// ─── Rendering ───
function render() {
  renderSummary();
  renderRepoCards();
  renderTimeline();
  renderInsights();
}

// Summary Strip
function renderSummary() {
  const totalRuns = allRuns.length;
  const successful = allRuns.filter(r => r.conclusion === 'success').length;
  const failed = allRuns.filter(r => r.conclusion === 'failure').length;
  const passRate = totalRuns > 0 ? ((successful / totalRuns) * 100).toFixed(1) : 0;
  const repos = manifest.repos || [];
  const healthyRepos = repos.filter(r => repoData[r.name]?.conclusion === 'success').length;

  const streak = computeStreak();

  const cards = [
    { value: passRate + '%', label: 'Pass Rate', detail: `${successful} of ${totalRuns} runs`, accent: passRate >= 80 ? 'var(--success)' : passRate >= 50 ? 'var(--accent)' : 'var(--failure)' },
    { value: totalRuns, label: 'Total Runs', detail: 'across all repos', accent: 'var(--accent)' },
    { value: `${healthyRepos}/${repos.length}`, label: 'Healthy Repos', detail: healthyRepos === repos.length ? 'all passing' : `${repos.length - healthyRepos} need attention`, accent: healthyRepos === repos.length ? 'var(--success)' : 'var(--failure)' },
    { value: failed, label: 'Failures', detail: failed === 0 ? 'none — great!' : 'review needed', accent: failed === 0 ? 'var(--success)' : 'var(--failure)' },
    { value: streak, label: 'Success Streak', detail: 'consecutive passes', accent: streak >= 5 ? 'var(--success)' : 'var(--accent)' }
  ];

  const container = document.getElementById('summary-strip');
  container.innerHTML = cards.map(c => `
    <div class="summary-card" style="--card-accent: ${c.accent}">
      <div class="summary-value">${c.value}</div>
      <div class="summary-label">${c.label}</div>
      <div class="summary-detail">${c.detail}</div>
    </div>
  `).join('');
}

function computeStreak() {
  let streak = 0;
  for (const run of allRuns) {
    if (run.conclusion === 'success') streak++;
    else break;
  }
  return streak;
}

// Repo Cards
function renderRepoCards() {
  const repos = manifest.repos || [];
  const container = document.getElementById('repo-cards');

  container.innerHTML = repos.map(repo => {
    const data = repoData[repo.name] || { runs: [], conclusion: 'unknown' };
    const conclusion = data.conclusion || 'unknown';
    const runs = (data.runs || []).slice(0, 8);
    const langClass = (repo.language || '').toLowerCase();

    return `
      <div class="repo-card status-${conclusion}" data-repo="${repo.name}" data-status="${conclusion}">
        <div class="repo-card-header">
          <div class="repo-icon">${repo.icon || '📦'}</div>
          <div class="repo-info">
            <div class="repo-name">
              <a href="https://github.com/${manifest.owner}/${repo.name}" target="_blank">${repo.displayName || repo.name}</a>
              <span class="lang-badge ${langClass}">${repo.language || ''}</span>
            </div>
            <div class="repo-desc">${repo.description || ''}</div>
          </div>
          <span class="repo-status-badge ${conclusion}">${conclusionLabel(conclusion)}</span>
        </div>
        <div class="repo-card-body">
          ${runs.length > 0 ? renderRunTable(runs) : '<div class="empty-state">No workflow runs found</div>'}
        </div>
      </div>
    `;
  }).join('');
}

function renderRunTable(runs) {
  const rows = runs.map(run => {
    const duration = computeDuration(run.run_started_at || run.created_at, run.updated_at);
    const timeAgo = relativeTime(run.created_at);
    const sha = (run.head_sha || '').substring(0, 7);

    return `
      <tr>
        <td>
          <span class="run-status-dot ${run.conclusion}"></span>
          <a class="run-link" href="${run.html_url}" target="_blank">#${run.run_number}</a>
        </td>
        <td>${run.name}</td>
        <td><span class="run-branch">${run.head_branch}</span></td>
        <td class="run-duration mono">${duration}</td>
        <td class="text-muted">${timeAgo}</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="run-table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Workflow</th>
          <th>Branch</th>
          <th>Duration</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Timeline
function renderTimeline() {
  const container = document.getElementById('timeline');
  const countEl = document.getElementById('timeline-count');
  const maxItems = 30;
  const items = allRuns.slice(0, maxItems);

  countEl.textContent = `Showing ${items.length} of ${allRuns.length}`;

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No workflow runs to display</div>';
    return;
  }

  container.innerHTML = items.map(run => {
    const repo = run._repo || {};
    const timeAgo = relativeTime(run.created_at);
    const duration = computeDuration(run.run_started_at || run.created_at, run.updated_at);
    const actor = run.actor?.login || 'unknown';

    return `
      <div class="timeline-item">
        <span class="timeline-dot ${run.conclusion}"></span>
        <div class="timeline-body">
          <div class="timeline-header">
            <span class="timeline-repo">${repo.displayName || repo.name || 'unknown'}</span>
            <span class="timeline-workflow">
              <a href="${run.html_url}" target="_blank">${run.name} #${run.run_number}</a>
            </span>
          </div>
          <div class="timeline-meta">
            <span>⏱ ${duration}</span>
            <span>🌿 ${run.head_branch}</span>
            <span>👤 ${actor}</span>
            <span>${timeAgo}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Insights
function renderInsights() {
  renderLangBreakdown();
  renderWorkflowBreakdown();
  renderAuthorBreakdown();
  renderBranchBreakdown();
}

function renderLangBreakdown() {
  const container = document.getElementById('lang-breakdown');
  const repos = manifest.repos || [];
  const langCounts = {};

  allRuns.forEach(run => {
    const repo = run._repo || {};
    const lang = repo.language || 'Unknown';
    if (!langCounts[lang]) langCounts[lang] = { total: 0, success: 0 };
    langCounts[lang].total++;
    if (run.conclusion === 'success') langCounts[lang].success++;
  });

  const maxTotal = Math.max(...Object.values(langCounts).map(c => c.total), 1);

  container.innerHTML = Object.entries(langCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([lang, counts]) => `
      <div class="insight-bar-row">
        <span class="insight-bar-label">${lang}</span>
        <div class="insight-bar-track">
          <div class="insight-bar-fill success" style="width: ${(counts.success / maxTotal) * 100}%"></div>
        </div>
        <span class="insight-bar-value">${counts.success}/${counts.total}</span>
      </div>
    `).join('');
}

function renderWorkflowBreakdown() {
  const container = document.getElementById('workflow-breakdown');
  const wfCounts = {};

  allRuns.forEach(run => {
    const name = run.name || 'Unknown';
    if (!wfCounts[name]) wfCounts[name] = { total: 0, success: 0 };
    wfCounts[name].total++;
    if (run.conclusion === 'success') wfCounts[name].success++;
  });

  const maxTotal = Math.max(...Object.values(wfCounts).map(c => c.total), 1);

  container.innerHTML = Object.entries(wfCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, counts]) => `
      <div class="insight-bar-row">
        <span class="insight-bar-label">${name}</span>
        <div class="insight-bar-track">
          <div class="insight-bar-fill" style="width: ${(counts.total / maxTotal) * 100}%"></div>
        </div>
        <span class="insight-bar-value">${counts.total}</span>
      </div>
    `).join('');
}

function renderAuthorBreakdown() {
  const container = document.getElementById('author-breakdown');
  const authors = {};

  allRuns.forEach(run => {
    const login = run.actor?.login;
    if (!login) return;
    if (!authors[login]) authors[login] = { count: 0, avatar: run.actor.avatar_url || '' };
    authors[login].count++;
  });

  container.innerHTML = Object.entries(authors)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([login, data]) => `
      <div class="insight-contributor">
        <img class="insight-avatar" src="${data.avatar}" alt="${login}" onerror="this.style.display='none'" />
        <span class="insight-bar-label">${login}</span>
        <span class="insight-bar-value">${data.count} runs</span>
      </div>
    `).join('') || '<div class="text-muted">No contributor data</div>';
}

function renderBranchBreakdown() {
  const container = document.getElementById('branch-breakdown');
  const branches = {};

  allRuns.forEach(run => {
    const branch = run.head_branch || 'unknown';
    if (!branches[branch]) branches[branch] = 0;
    branches[branch]++;
  });

  const maxCount = Math.max(...Object.values(branches), 1);

  container.innerHTML = Object.entries(branches)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([branch, count]) => `
      <div class="insight-bar-row">
        <span class="insight-bar-label mono">${branch}</span>
        <div class="insight-bar-track">
          <div class="insight-bar-fill" style="width: ${(count / maxCount) * 100}%"></div>
        </div>
        <span class="insight-bar-value">${count}</span>
      </div>
    `).join('');
}

// ─── Filters ───
function applyRepoFilter(filter) {
  document.querySelectorAll('.repo-card').forEach(card => {
    if (filter === 'all') {
      card.classList.remove('hidden');
    } else {
      card.classList.toggle('hidden', card.dataset.status !== filter);
    }
  });
}

// ─── Utilities ───
async function fetchJSON(url) {
  const opts = {};
  // No auth header for public repos — avoid CORS issues
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

function conclusionLabel(c) {
  const map = {
    success:     'Passing',
    failure:     'Failing',
    cancelled:   'Cancelled',
    skipped:     'Skipped',
    in_progress: 'Running',
    unknown:     'Unknown'
  };
  return map[c] || c;
}

function computeDuration(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end) - new Date(start);
  if (ms < 0) return '—';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function relativeTime(dateStr) {
  if (!dateStr) return '—';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > CACHE_TTL) return null;
    return data;
  } catch (_) { return null; }
}

// ─── UI Helpers ───
function setRefreshing(on) {
  const btn = document.getElementById('refresh-btn');
  btn.classList.toggle('spinning', on);
  btn.disabled = on;
}

function updateDataSourceBadge(source) {
  const badge = document.getElementById('data-source-badge');
  badge.className = 'badge';
  if (source === 'live') {
    badge.textContent = 'LIVE';
  } else if (source === 'cached') {
    badge.textContent = 'CACHED';
    badge.classList.add('stale');
  } else {
    badge.textContent = 'ERROR';
    badge.classList.add('error');
  }
}

function updateLastRefreshed() {
  const el = document.getElementById('last-updated');
  el.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const interval = manifest?.refreshIntervalMs || 300000; // 5 min default
  refreshTimer = setInterval(() => refresh(), interval);
}

function showGlobalError(msg) {
  const summaryEl = document.getElementById('summary-strip');
  summaryEl.innerHTML = `<div class="error-state" style="grid-column: 1/-1;">${msg}</div>`;
}
