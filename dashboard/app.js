/* ═══════════════════════════════════════════════════════════
   CI/CD Dashboard — Client-Side Engine  (v3.0)
   ══════════════════════════════════════════════════════════
   Architecture:
     1. Reads manifest.json for repo list & config
     2. Fetches live workflow run + job data from GitHub REST API
     3. Categorises jobs into: Lint, Test, Security, Release
     4. Renders per-repo cards with categorised status panels
     5. Auto-refreshes on configurable interval
   ═══════════════════════════════════════════════════════════ */

'use strict';

const GITHUB_API = 'https://api.github.com';
const CACHE_KEY  = 'dashboard_cache_v3';
const CACHE_TTL  = 5 * 60 * 1000;

// Category definitions — used for classification and display
const CATEGORIES = [
  { key: 'lint',     label: 'Lint',          icon: '🔍', patterns: [/lint/i] },
  { key: 'test',     label: 'Unit Tests',    icon: '🧪', patterns: [/test/i] },
  { key: 'security', label: 'Security',      icon: '🛡️', patterns: [/security/i, /scan/i, /sast/i, /trivy/i, /vuln/i] },
  { key: 'release',  label: 'Release',       icon: '🚀', patterns: [/release/i] },
];

let manifest     = null;
let allRuns      = [];
let repoData     = {};
let refreshTimer = null;
let isLoading    = false;

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

function bindEvents() {
  document.getElementById('refresh-btn').addEventListener('click', () => refresh());
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyRepoFilter(btn.dataset.filter);
    });
  });
}

function applyManifestConfig() {
  if (!manifest) return;
  if (manifest.title) document.getElementById('dashboard-title').textContent = manifest.title;
  if (manifest.subtitle) document.getElementById('dashboard-subtitle').textContent = manifest.subtitle;
  if (manifest.version) document.getElementById('footer-version').textContent = manifest.version;
}

// ═══════════════════════════════════════════════════
//  DATA FETCHING
// ═══════════════════════════════════════════════════
async function refresh() {
  if (isLoading) return;
  isLoading = true;
  setRefreshing(true);

  try {
    const repos = manifest.repos || [];
    const results = await Promise.allSettled(repos.map(r => fetchRepoData(r)));

    allRuns  = [];
    repoData = {};

    results.forEach((result, idx) => {
      const repo = repos[idx];
      if (result.status === 'fulfilled' && result.value) {
        repoData[repo.name] = result.value;
        allRuns.push(...(result.value.runs || []).map(r => ({ ...r, _repo: repo })));
      } else {
        repoData[repo.name] = { runs: [], jobs: [], categories: emptyCategories(), conclusion: 'unknown', error: true };
      }
    });

    allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), repoData, allRuns })); } catch (_) {}

    render();
    updateDataSourceBadge('live');
    updateLastRefreshed();
  } catch (err) {
    const cached = loadCache();
    if (cached) { repoData = cached.repoData; allRuns = cached.allRuns; render(); updateDataSourceBadge('cached'); }
    else { showGlobalError('Failed to fetch data: ' + err.message); updateDataSourceBadge('error'); }
  } finally {
    isLoading = false;
    setRefreshing(false);
  }
}

async function fetchRepoData(repo) {
  const owner = manifest.owner;
  const name  = repo.name;
  const maxRuns = manifest.maxRunsPerRepo || 20;

  let runs = [];
  let allJobs = [];
  let ciStats = { lint: {}, test: {}, security: {} };

  // 1. Fetch workflow runs
  try {
    const url  = `${GITHUB_API}/repos/${owner}/${name}/actions/runs?per_page=${maxRuns}`;
    const data = await fetchJSON(url);
    if (data?.workflow_runs) runs = data.workflow_runs.map(normalizeRun);
  } catch (apiErr) {
    console.warn(`API fetch failed for ${name}, trying static...`, apiErr.message);
    try {
      const d = await fetchJSON(`${manifest.dataPath || 'data'}/${name}.json`);
      if (d?.runs) runs = d.runs.map(normalizeRun);
    } catch (_) {}
  }

  // 2. Fetch jobs for recent CI runs (latest 3) to get Lint/Test/Security detail
  const ciRuns = runs.filter(r => !isReleaseRun(r)).slice(0, 3);
  for (const run of ciRuns) {
    try {
      const jobsUrl = `${GITHUB_API}/repos/${owner}/${name}/actions/runs/${run.id}/jobs`;
      const jobsData = await fetchJSON(jobsUrl);
      if (jobsData?.jobs) {
        const jobs = jobsData.jobs.map(j => normalizeJob(j, run));
        allJobs.push(...jobs);
      }
    } catch (_) {}
  }

  // 3. Fetch annotations for latest CI run jobs to get stats
  if (ciRuns.length > 0) {
    const latestCIRun = ciRuns[0];
    try {
      const jobsUrl = `${GITHUB_API}/repos/${owner}/${name}/actions/runs/${latestCIRun.id}/jobs`;
      const jobsData = await fetchJSON(jobsUrl);
      for (const job of (jobsData?.jobs || [])) {
        try {
          const annUrl = `${GITHUB_API}/repos/${owner}/${name}/check-runs/${job.id}/annotations`;
          const annotations = await fetchJSON(annUrl);
          for (const ann of annotations) {
            const title = ann.title || '';
            const msg = ann.message || '';
            if (title === 'ci_lint') ciStats.lint = parseAnnotationKV(msg);
            else if (title === 'ci_test') ciStats.test = parseAnnotationKV(msg);
            else if (title === 'ci_security') ciStats.security = parseAnnotationKV(msg);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 4. Categorise
  const categories = categoriseData(runs, allJobs);
  const latestConclusion = runs.length > 0 ? runs[0].conclusion : 'unknown';

  return { runs, jobs: allJobs, categories, conclusion: latestConclusion, totalCount: runs.length, ciStats };
}

function parseAnnotationKV(str) {
  const obj = {};
  (str || '').split('|').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v !== undefined) obj[k.trim()] = v.trim();
  });
  return obj;
}

function normalizeRun(run) {
  return {
    id:             run.id,
    name:           run.name || run.workflow_name || 'unknown',
    status:         run.status || 'completed',
    conclusion:     run.conclusion || (run.status === 'completed' ? 'unknown' : 'in_progress'),
    html_url:       run.html_url || '#',
    created_at:     run.created_at || new Date().toISOString(),
    updated_at:     run.updated_at || run.created_at || new Date().toISOString(),
    head_branch:    run.head_branch || 'main',
    head_sha:       run.head_sha || '',
    event:          run.event || 'push',
    run_number:     run.run_number || 0,
    actor:          run.actor || run.triggering_actor || null,
    run_started_at: run.run_started_at || run.created_at
  };
}

function normalizeJob(job, parentRun) {
  return {
    id:          job.id,
    name:        job.name || 'unknown',
    status:      job.status || 'completed',
    conclusion:  job.conclusion || 'unknown',
    html_url:    job.html_url || parentRun.html_url || '#',
    started_at:  job.started_at || parentRun.created_at,
    completed_at: job.completed_at || parentRun.updated_at,
    run_id:      parentRun.id,
    run_number:  parentRun.run_number,
    head_branch: parentRun.head_branch,
    actor:       parentRun.actor,
    event:       parentRun.event,
    _parentRun:  parentRun
  };
}

function isReleaseRun(run) {
  const n = (run.name || '').toLowerCase();
  return n.includes('release');
}

// ═══════════════════════════════════════════════════
//  CATEGORISATION ENGINE
// ═══════════════════════════════════════════════════
function categoriseData(runs, jobs) {
  const cats = {};
  CATEGORIES.forEach(c => { cats[c.key] = { items: [], latest: null, conclusion: 'unknown' }; });

  // First, categorise individual jobs (from CI runs)
  jobs.forEach(job => {
    const cat = classifyName(job.name);
    if (cat && cats[cat]) {
      cats[cat].items.push({
        type: 'job',
        id: job.id,
        name: job.name,
        conclusion: job.conclusion,
        status: job.status,
        html_url: job.html_url,
        time: job.started_at,
        duration: computeDuration(job.started_at, job.completed_at),
        branch: job.head_branch,
        run_number: job.run_number,
        actor: job.actor
      });
    }
  });

  // Also add Release runs
  const releaseRuns = runs.filter(isReleaseRun);
  releaseRuns.forEach(run => {
    cats['release'].items.push({
      type: 'run',
      id: run.id,
      name: run.name,
      conclusion: run.conclusion,
      status: run.status,
      html_url: run.html_url,
      time: run.created_at,
      duration: computeDuration(run.run_started_at || run.created_at, run.updated_at),
      branch: run.head_branch,
      run_number: run.run_number,
      actor: run.actor
    });
  });

  // If no jobs available (old runs), fall back to classifying run names
  const hasJobs = jobs.length > 0;
  if (!hasJobs) {
    runs.filter(r => !isReleaseRun(r)).forEach(run => {
      // Assign CI runs to the "test" category as best guess
      cats['test'].items.push({
        type: 'run',
        id: run.id,
        name: run.name,
        conclusion: run.conclusion,
        status: run.status,
        html_url: run.html_url,
        time: run.created_at,
        duration: computeDuration(run.run_started_at || run.created_at, run.updated_at),
        branch: run.head_branch,
        run_number: run.run_number,
        actor: run.actor
      });
    });
  }

  // Sort each category and set latest
  Object.values(cats).forEach(cat => {
    cat.items.sort((a, b) => new Date(b.time) - new Date(a.time));
    cat.latest = cat.items[0] || null;
    cat.conclusion = cat.latest?.conclusion || 'unknown';
  });

  return cats;
}

function classifyName(name) {
  const lower = (name || '').toLowerCase();
  for (const cat of CATEGORIES) {
    for (const pattern of cat.patterns) {
      if (pattern.test(lower)) return cat.key;
    }
  }
  // Fallback: if name contains "ci status" or "ci pipeline", skip it
  if (lower.includes('ci status') || lower.includes('ci pipeline')) return null;
  return null;
}

function emptyCategories() {
  const cats = {};
  CATEGORIES.forEach(c => { cats[c.key] = { items: [], latest: null, conclusion: 'unknown' }; });
  return cats;
}

// ═══════════════════════════════════════════════════
//  RENDERING
// ═══════════════════════════════════════════════════
function render() {
  renderSummary();
  renderRepoCards();
  renderTimeline();
  renderInsights();
}

// ── Summary ──
function renderSummary() {
  const totalRuns = allRuns.length;
  const successful = allRuns.filter(r => r.conclusion === 'success').length;
  const failed = allRuns.filter(r => r.conclusion === 'failure').length;
  const passRate = totalRuns > 0 ? ((successful / totalRuns) * 100).toFixed(1) : 0;
  const repos = manifest.repos || [];
  const healthyRepos = repos.filter(r => repoData[r.name]?.conclusion === 'success').length;
  const streak = computeStreak();

  // Count security-specific stats
  let secTotal = 0, secPass = 0;
  repos.forEach(r => {
    const cat = repoData[r.name]?.categories?.security;
    if (cat && cat.items.length > 0) {
      secTotal += cat.items.length;
      secPass += cat.items.filter(i => i.conclusion === 'success').length;
    }
  });

  const cards = [
    { value: passRate + '%', label: 'Pass Rate', detail: `${successful} of ${totalRuns} runs`, accent: passRate >= 80 ? 'var(--success)' : passRate >= 50 ? 'var(--accent)' : 'var(--failure)' },
    { value: `${healthyRepos}/${repos.length}`, label: 'Healthy Repos', detail: healthyRepos === repos.length ? 'all passing' : `${repos.length - healthyRepos} need attention`, accent: healthyRepos === repos.length ? 'var(--success)' : 'var(--failure)' },
    { value: failed, label: 'Failures', detail: failed === 0 ? 'none — great!' : 'review needed', accent: failed === 0 ? 'var(--success)' : 'var(--failure)' },
    { value: `${secPass}/${secTotal || '—'}`, label: 'Security Scans', detail: secTotal === 0 ? 'no scans yet' : secPass === secTotal ? 'all clean' : 'issues found', accent: secTotal === 0 ? 'var(--accent)' : secPass === secTotal ? 'var(--success)' : 'var(--failure)' },
    { value: streak, label: 'Success Streak', detail: 'consecutive passes', accent: streak >= 5 ? 'var(--success)' : 'var(--accent)' }
  ];

  document.getElementById('summary-strip').innerHTML = cards.map(c => `
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

// ── Repo Cards (categorised) ──
function renderRepoCards() {
  const repos = manifest.repos || [];
  const container = document.getElementById('repo-cards');

  container.innerHTML = repos.map(repo => {
    const data = repoData[repo.name] || { runs: [], categories: emptyCategories(), conclusion: 'unknown', ciStats: {} };
    const cats = data.categories || emptyCategories();
    const stats = data.ciStats || { lint: {}, test: {}, security: {} };
    const overallConclusion = data.conclusion || 'unknown';
    const langClass = (repo.language || '').toLowerCase();

    return `
      <div class="repo-card status-${overallConclusion}" data-repo="${repo.name}" data-status="${overallConclusion}">
        <div class="repo-card-header">
          <div class="repo-icon">${repo.icon || '📦'}</div>
          <div class="repo-info">
            <div class="repo-name">
              <a href="https://github.com/${manifest.owner}/${repo.name}" target="_blank">${repo.displayName || repo.name}</a>
              <span class="lang-badge ${langClass}">${repo.language || ''}</span>
            </div>
            <div class="repo-desc">${repo.description || ''}</div>
          </div>
          <span class="repo-status-badge ${overallConclusion}">${conclusionLabel(overallConclusion)}</span>
        </div>

        <!-- Category Panels with Stats -->
        <div class="repo-card-body">
          <div class="category-grid">
            ${renderLintPanel(cats.lint, stats.lint)}
            ${renderTestPanel(cats.test, stats.test)}
            ${renderSecurityPanel(cats.security, stats.security)}
            ${renderCategoryPanel(CATEGORIES[3], cats.release)}
          </div>
        </div>

        <div class="repo-card-footer">
          <a class="detail-link" href="repo.html?repo=${repo.name}">View detailed stats →</a>
        </div>
      </div>
    `;
  }).join('');
}

function renderLintPanel(catData, stats) {
  const conclusion = catData?.conclusion || 'unknown';
  const latest = catData?.latest;
  const items = (catData?.items || []).slice(0, 5);
  const errors = stats?.errors;

  const statusDot = `<span class="run-status-dot ${conclusion}"></span>`;
  const latestInfo = latest
    ? `<a class="run-link" href="${latest.html_url}" target="_blank">#${latest.run_number}</a>
       <span class="text-muted">${latest.duration}</span>`
    : '<span class="text-muted">no runs</span>';
  const historyDots = items.map(item =>
    `<span class="history-dot ${item.conclusion}" title="#${item.run_number} — ${item.conclusion}"></span>`
  ).join('');

  // Stats line
  let statsLine = '';
  if (conclusion === 'success') {
    statsLine = '<span class="stat-inline ok">✅ All OK</span>';
  } else if (conclusion === 'failure' && errors !== undefined) {
    statsLine = `<span class="stat-inline fail">❌ ${errors} error(s)</span>`;
  } else if (conclusion === 'failure') {
    statsLine = '<span class="stat-inline fail">❌ Failed</span>';
  }

  return `
    <div class="category-panel cat-${conclusion}">
      <div class="category-header">
        <span class="category-icon">🔍</span>
        <span class="category-label">Lint</span>
        ${statusDot}
      </div>
      ${statsLine ? `<div class="category-stats">${statsLine}</div>` : ''}
      <div class="category-latest">${latestInfo}</div>
      <div class="category-history">${historyDots || '<span class="text-muted">—</span>'}</div>
    </div>
  `;
}

function renderTestPanel(catData, stats) {
  const conclusion = catData?.conclusion || 'unknown';
  const latest = catData?.latest;
  const items = (catData?.items || []).slice(0, 5);

  const statusDot = `<span class="run-status-dot ${conclusion}"></span>`;
  const latestInfo = latest
    ? `<a class="run-link" href="${latest.html_url}" target="_blank">#${latest.run_number}</a>
       <span class="text-muted">${latest.duration}</span>`
    : '<span class="text-muted">no runs</span>';
  const historyDots = items.map(item =>
    `<span class="history-dot ${item.conclusion}" title="#${item.run_number} — ${item.conclusion}"></span>`
  ).join('');

  let statsLine = '';
  const total = stats?.total, passed = stats?.passed, failed = stats?.failed, cov = stats?.coverage;
  if (total !== undefined) {
    const failClass = parseInt(failed) > 0 ? 'fail' : 'ok';
    statsLine = `<span class="stat-inline neutral">${total} total</span>
      <span class="stat-inline ok">${passed} pass</span>
      <span class="stat-inline ${failClass}">${failed} fail</span>`;
    if (cov && cov !== 'N/A') {
      const covNum = parseFloat(cov);
      const covClass = covNum >= 80 ? 'ok' : covNum >= 50 ? 'warn' : 'fail';
      statsLine += ` <span class="stat-inline ${covClass}">📊 ${cov}</span>`;
    }
  } else if (conclusion === 'success') {
    statsLine = '<span class="stat-inline ok">✅ Passed</span>';
  } else if (conclusion === 'failure') {
    statsLine = '<span class="stat-inline fail">❌ Failed</span>';
  }

  return `
    <div class="category-panel cat-${conclusion}">
      <div class="category-header">
        <span class="category-icon">🧪</span>
        <span class="category-label">Unit Tests</span>
        ${statusDot}
      </div>
      ${statsLine ? `<div class="category-stats">${statsLine}</div>` : ''}
      <div class="category-latest">${latestInfo}</div>
      <div class="category-history">${historyDots || '<span class="text-muted">—</span>'}</div>
    </div>
  `;
}

function renderSecurityPanel(catData, stats) {
  const conclusion = catData?.conclusion || 'unknown';
  const latest = catData?.latest;
  const items = (catData?.items || []).slice(0, 5);

  const statusDot = `<span class="run-status-dot ${conclusion}"></span>`;
  const latestInfo = latest
    ? `<a class="run-link" href="${latest.html_url}" target="_blank">#${latest.run_number}</a>
       <span class="text-muted">${latest.duration}</span>`
    : '<span class="text-muted">no runs</span>';
  const historyDots = items.map(item =>
    `<span class="history-dot ${item.conclusion}" title="#${item.run_number} — ${item.conclusion}"></span>`
  ).join('');

  let statsLine = '';
  const sast = stats?.sast, deps = stats?.deps, crit = stats?.critical, high = stats?.high, med = stats?.medium, low = stats?.low;
  if (sast !== undefined || crit !== undefined) {
    const parts = [];
    if (parseInt(sast) > 0) parts.push(`<span class="stat-inline fail">${sast} SAST</span>`);
    if (parseInt(deps) > 0) parts.push(`<span class="stat-inline warn">${deps} deps</span>`);
    if (parseInt(crit) > 0) parts.push(`<span class="stat-inline fail">${crit} crit</span>`);
    if (parseInt(high) > 0) parts.push(`<span class="stat-inline fail">${high} high</span>`);
    if (parseInt(med) > 0) parts.push(`<span class="stat-inline warn">${med} med</span>`);
    if (parseInt(low) > 0) parts.push(`<span class="stat-inline neutral">${low} low</span>`);
    if (parts.length === 0) {
      statsLine = '<span class="stat-inline ok">✅ Clean</span>';
    } else {
      statsLine = parts.join(' ');
    }
  } else if (conclusion === 'success') {
    statsLine = '<span class="stat-inline ok">✅ Clean</span>';
  } else if (conclusion === 'failure') {
    statsLine = '<span class="stat-inline fail">❌ Issues Found</span>';
  }

  return `
    <div class="category-panel cat-${conclusion}">
      <div class="category-header">
        <span class="category-icon">🛡️</span>
        <span class="category-label">Security</span>
        ${statusDot}
      </div>
      ${statsLine ? `<div class="category-stats">${statsLine}</div>` : ''}
      <div class="category-latest">${latestInfo}</div>
      <div class="category-history">${historyDots || '<span class="text-muted">—</span>'}</div>
    </div>
  `;
}

function renderCategoryPanel(catDef, catData) {
  const latest = catData?.latest;
  const items = (catData?.items || []).slice(0, 5);
  const conclusion = catData?.conclusion || 'unknown';

  const statusDot = `<span class="run-status-dot ${conclusion}"></span>`;
  const latestInfo = latest
    ? `<a class="run-link" href="${latest.html_url}" target="_blank">#${latest.run_number}</a>
       <span class="text-muted">${latest.duration}</span>`
    : '<span class="text-muted">no runs</span>';

  // Mini history dots
  const historyDots = items.map(item =>
    `<span class="history-dot ${item.conclusion}" title="#${item.run_number} — ${item.conclusion}"></span>`
  ).join('');

  return `
    <div class="category-panel cat-${conclusion}">
      <div class="category-header">
        <span class="category-icon">${catDef.icon}</span>
        <span class="category-label">${catDef.label}</span>
        ${statusDot}
      </div>
      <div class="category-latest">${latestInfo}</div>
      <div class="category-history">${historyDots || '<span class="text-muted">—</span>'}</div>
    </div>
  `;
}

// ── Timeline ──
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
    const catKey = isReleaseRun(run) ? 'release' : 'ci';
    const catIcon = isReleaseRun(run) ? '🚀' : '⚙️';

    return `
      <div class="timeline-item">
        <span class="timeline-dot ${run.conclusion}"></span>
        <div class="timeline-body">
          <div class="timeline-header">
            <span class="timeline-repo">${repo.displayName || repo.name || 'unknown'}</span>
            <span class="timeline-workflow">
              ${catIcon} <a href="${run.html_url}" target="_blank">${run.name} #${run.run_number}</a>
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

// ── Insights ──
function renderInsights() {
  renderLangBreakdown();
  renderWorkflowBreakdown();
  renderAuthorBreakdown();
  renderBranchBreakdown();
}

function renderLangBreakdown() {
  const container = document.getElementById('lang-breakdown');
  const langCounts = {};

  allRuns.forEach(run => {
    const lang = run._repo?.language || 'Unknown';
    if (!langCounts[lang]) langCounts[lang] = { total: 0, success: 0 };
    langCounts[lang].total++;
    if (run.conclusion === 'success') langCounts[lang].success++;
  });

  const maxTotal = Math.max(...Object.values(langCounts).map(c => c.total), 1);
  container.innerHTML = Object.entries(langCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([lang, c]) => barRow(lang, c.success, maxTotal, `${c.success}/${c.total}`, 'success'))
    .join('');
}

function renderWorkflowBreakdown() {
  const container = document.getElementById('workflow-breakdown');
  // Show by category instead of raw workflow name
  const catCounts = {};
  CATEGORIES.forEach(c => { catCounts[c.label] = { total: 0, success: 0 }; });

  Object.values(repoData).forEach(rd => {
    const cats = rd.categories || {};
    Object.entries(cats).forEach(([key, cat]) => {
      const label = CATEGORIES.find(c => c.key === key)?.label || key;
      if (!catCounts[label]) catCounts[label] = { total: 0, success: 0 };
      catCounts[label].total += cat.items.length;
      catCounts[label].success += cat.items.filter(i => i.conclusion === 'success').length;
    });
  });

  const maxTotal = Math.max(...Object.values(catCounts).map(c => c.total), 1);
  container.innerHTML = Object.entries(catCounts)
    .filter(([_, c]) => c.total > 0)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, c]) => barRow(name, c.success, maxTotal, `${c.success}/${c.total}`, 'success'))
    .join('') || '<div class="text-muted">No data yet</div>';
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
  allRuns.forEach(run => { const b = run.head_branch || 'unknown'; branches[b] = (branches[b] || 0) + 1; });
  const maxCount = Math.max(...Object.values(branches), 1);
  container.innerHTML = Object.entries(branches)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([branch, count]) => barRow(branch, count, maxCount, count, ''))
    .join('');
}

function barRow(label, fillValue, maxValue, displayValue, fillClass) {
  return `
    <div class="insight-bar-row">
      <span class="insight-bar-label">${label}</span>
      <div class="insight-bar-track">
        <div class="insight-bar-fill ${fillClass}" style="width: ${(fillValue / maxValue) * 100}%"></div>
      </div>
      <span class="insight-bar-value">${displayValue}</span>
    </div>
  `;
}

// ── Filters ──
function applyRepoFilter(filter) {
  document.querySelectorAll('.repo-card').forEach(card => {
    card.classList.toggle('hidden', filter !== 'all' && card.dataset.status !== filter);
  });
}

// ═══════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

function conclusionLabel(c) {
  return { success: 'Passing', failure: 'Failing', cancelled: 'Cancelled', skipped: 'Skipped', in_progress: 'Running', unknown: 'Unknown' }[c] || c;
}

function computeDuration(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end) - new Date(start);
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function relativeTime(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
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
    const d = JSON.parse(raw);
    return (Date.now() - d.ts <= CACHE_TTL) ? d : null;
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
  if (source === 'live') { badge.textContent = 'LIVE'; }
  else if (source === 'cached') { badge.textContent = 'CACHED'; badge.classList.add('stale'); }
  else { badge.textContent = 'ERROR'; badge.classList.add('error'); }
}

function updateLastRefreshed() {
  document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refresh(), manifest?.refreshIntervalMs || 300000);
}

function showGlobalError(msg) {
  document.getElementById('summary-strip').innerHTML = `<div class="error-state" style="grid-column:1/-1">${msg}</div>`;
}
