/* ═══════════════════════════════════════════════════════════
   Repo Detail Page — CI/CD Dashboard  (v4.0)
   Fetches latest CI run annotations to display detailed stats
   ═══════════════════════════════════════════════════════════ */
'use strict';

const GITHUB_API = 'https://api.github.com';
let manifest = null;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('refresh-btn').addEventListener('click', () => loadDetail());
  await loadDetail();
});

async function loadDetail() {
  const params = new URLSearchParams(window.location.search);
  const repoName = params.get('repo');
  if (!repoName) {
    document.getElementById('detail-content').innerHTML = '<div class="loading-detail">No repo specified. <a href="index.html">Go back</a></div>';
    return;
  }

  document.getElementById('detail-content').innerHTML = '<div class="loading-detail">Loading…</div>';

  try {
    manifest = await fetchJSON('manifest.json');
    const repoConfig = (manifest.repos || []).find(r => r.name === repoName);
    if (!repoConfig) throw new Error('Repo not found in manifest');

    const owner = manifest.owner;

    // Fetch latest CI workflow runs (not release)
    const runsUrl = `${GITHUB_API}/repos/${owner}/${repoName}/actions/runs?per_page=10`;
    const runsData = await fetchJSON(runsUrl);
    const ciRuns = (runsData.workflow_runs || []).filter(r => !r.name.toLowerCase().includes('release'));
    const latestRun = ciRuns[0];

    if (!latestRun) {
      document.getElementById('detail-content').innerHTML = '<div class="loading-detail">No CI runs found.</div>';
      return;
    }

    // Fetch jobs for the latest run
    const jobsUrl = `${GITHUB_API}/repos/${owner}/${repoName}/actions/runs/${latestRun.id}/jobs`;
    const jobsData = await fetchJSON(jobsUrl);
    const jobs = jobsData.jobs || [];

    // Fetch annotations for each job
    const statsMap = { lint: {}, test: {}, security: {} };
    for (const job of jobs) {
      try {
        const annUrl = `${GITHUB_API}/repos/${owner}/${repoName}/check-runs/${job.id}/annotations`;
        const annotations = await fetchJSON(annUrl);
        for (const ann of annotations) {
          const title = ann.title || '';
          const msg = ann.message || '';
          if (title === 'ci_lint' || msg.startsWith('errors=')) {
            statsMap.lint = parseKeyVal(title === 'ci_lint' ? msg : ann.message);
          } else if (title === 'ci_test') {
            statsMap.test = parseKeyVal(msg);
          } else if (title === 'ci_security') {
            statsMap.security = parseKeyVal(msg);
          }
        }
      } catch (_) { /* annotations may not be available */ }
    }

    // Render
    renderDetail(repoConfig, latestRun, jobs, statsMap, ciRuns.slice(0, 10));
  } catch (err) {
    document.getElementById('detail-content').innerHTML =
      `<div class="loading-detail">Error: ${err.message}. <a href="index.html">Go back</a></div>`;
  }
}

function parseKeyVal(str) {
  const obj = {};
  (str || '').split('|').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v !== undefined) obj[k.trim()] = v.trim();
  });
  return obj;
}

function renderDetail(repo, latestRun, jobs, stats, recentRuns) {
  const owner = manifest.owner;
  const langClass = (repo.language || '').toLowerCase();

  // Find job conclusions
  const lintJob = jobs.find(j => /lint/i.test(j.name));
  const testJob = jobs.find(j => /test/i.test(j.name));
  const secJob  = jobs.find(j => /security/i.test(j.name));

  const lintConclusion = lintJob?.conclusion || 'unknown';
  const testConclusion = testJob?.conclusion || 'unknown';
  const secConclusion  = secJob?.conclusion || 'unknown';

  const lintErrors = stats.lint.errors || '0';
  const testTotal  = stats.test.total || '—';
  const testPassed = stats.test.passed || '—';
  const testFailed = stats.test.failed || '—';
  const testCov    = stats.test.coverage || 'N/A';
  const secSast    = stats.security.sast || '0';
  const secDeps    = stats.security.deps || '0';
  const secCrit    = stats.security.critical || '0';
  const secHigh    = stats.security.high || '0';
  const secMed     = stats.security.medium || '0';
  const secLow     = stats.security.low || '0';

  const html = `
    <div class="detail-header">
      <div class="repo-icon">${repo.icon || '📦'}</div>
      <div>
        <h1>
          <a href="https://github.com/${owner}/${repo.name}" target="_blank">${repo.displayName || repo.name}</a>
        </h1>
        <span class="lang-badge ${langClass}">${repo.language || ''}</span>
        <span style="color:var(--text-muted); margin-left: 12px;">${repo.description || ''}</span>
      </div>
    </div>

    <!-- Stats Cards Grid -->
    <div class="stats-grid">

      <!-- Lint Card -->
      <div class="stat-card" style="border-left: 3px solid ${lintConclusion === 'success' ? 'var(--success)' : lintConclusion === 'failure' ? 'var(--failure)' : 'var(--text-muted)'}">
        <h3><span class="stat-icon">🔍</span> Lint</h3>
        <div class="stat-row">
          <span class="stat-label">Status</span>
          <span class="stat-value ${lintConclusion === 'success' ? 'ok' : 'fail'}">${lintConclusion === 'success' ? '✅ All OK' : '❌ Failed'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Error Count</span>
          <span class="stat-value ${parseInt(lintErrors) > 0 ? 'fail' : 'ok'}">${lintErrors}</span>
        </div>
        ${lintJob ? `<div style="margin-top: 8px; font-size: 0.75rem;"><a href="${lintJob.html_url}" target="_blank">View job log →</a></div>` : ''}
      </div>

      <!-- Test Card -->
      <div class="stat-card" style="border-left: 3px solid ${testConclusion === 'success' ? 'var(--success)' : testConclusion === 'failure' ? 'var(--failure)' : 'var(--text-muted)'}">
        <h3><span class="stat-icon">🧪</span> Unit Tests</h3>
        <div class="stat-row">
          <span class="stat-label">Status</span>
          <span class="stat-value ${testConclusion === 'success' ? 'ok' : 'fail'}">${testConclusion === 'success' ? '✅ Passed' : '❌ Failed'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Total</span>
          <span class="stat-value neutral">${testTotal}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Passed</span>
          <span class="stat-value ok">${testPassed}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Failed</span>
          <span class="stat-value ${parseInt(testFailed) > 0 ? 'fail' : 'ok'}">${testFailed}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Coverage</span>
          <span class="stat-value ${parseCov(testCov) >= 80 ? 'ok' : parseCov(testCov) >= 50 ? 'warn' : 'neutral'}">${testCov}</span>
        </div>
        ${testJob ? `<div style="margin-top: 8px; font-size: 0.75rem;"><a href="${testJob.html_url}" target="_blank">View job log →</a></div>` : ''}
      </div>

      <!-- Security Card -->
      <div class="stat-card" style="border-left: 3px solid ${secConclusion === 'success' ? 'var(--success)' : secConclusion === 'failure' ? 'var(--failure)' : 'var(--text-muted)'}">
        <h3><span class="stat-icon">🛡️</span> Security</h3>
        <div class="stat-row">
          <span class="stat-label">Status</span>
          <span class="stat-value ${secConclusion === 'success' ? 'ok' : 'fail'}">${secConclusion === 'success' ? '✅ Clean' : '❌ Issues Found'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">SAST Findings</span>
          <span class="stat-value ${parseInt(secSast) > 0 ? 'fail' : 'ok'}">${secSast}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Dependency Issues</span>
          <span class="stat-value ${parseInt(secDeps) > 0 ? 'warn' : 'ok'}">${secDeps}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Critical</span>
          <span class="stat-value ${parseInt(secCrit) > 0 ? 'fail' : 'ok'}">${secCrit}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">High</span>
          <span class="stat-value ${parseInt(secHigh) > 0 ? 'fail' : 'ok'}">${secHigh}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Medium</span>
          <span class="stat-value ${parseInt(secMed) > 0 ? 'warn' : 'ok'}">${secMed}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Low</span>
          <span class="stat-value ${parseInt(secLow) > 0 ? 'warn' : 'ok'}">${secLow}</span>
        </div>
        ${(() => {
          const total = [secCrit, secHigh, secMed, secLow].map(Number);
          const sum = total.reduce((a, b) => a + b, 0);
          if (sum === 0) return '<div class="severity-bar"><span class="none" style="flex:1"></span></div>';
          return '<div class="severity-bar">' +
            (total[0] > 0 ? `<span class="critical" style="flex:${total[0]}"></span>` : '') +
            (total[1] > 0 ? `<span class="high" style="flex:${total[1]}"></span>` : '') +
            (total[2] > 0 ? `<span class="medium" style="flex:${total[2]}"></span>` : '') +
            (total[3] > 0 ? `<span class="low" style="flex:${total[3]}"></span>` : '') +
          '</div>';
        })()}
        ${secJob ? `<div style="margin-top: 8px; font-size: 0.75rem;"><a href="${secJob.html_url}" target="_blank">View job log →</a></div>` : ''}
      </div>
    </div>

    <!-- Run Details -->
    <div class="detail-section">
      <h2>Latest CI Run #${latestRun.run_number}</h2>
      <div class="stat-row">
        <span class="stat-label">Status</span>
        <span class="stat-value ${latestRun.conclusion === 'success' ? 'ok' : 'fail'}">${latestRun.conclusion || latestRun.status}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Branch</span>
        <span class="stat-value neutral">${latestRun.head_branch}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Triggered</span>
        <span class="stat-value neutral">${relativeTime(latestRun.created_at)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Duration</span>
        <span class="stat-value neutral">${computeDuration(latestRun.run_started_at, latestRun.updated_at)}</span>
      </div>
      <div style="margin-top: 12px; font-size: 0.85rem;">
        <a href="${latestRun.html_url}" target="_blank">View full run on GitHub →</a>
      </div>
    </div>

    <!-- Run History -->
    <div class="detail-section">
      <h2>Recent CI Runs</h2>
      <table class="run-history-table">
        <thead>
          <tr><th>#</th><th>Status</th><th>Branch</th><th>Event</th><th>Duration</th><th>When</th></tr>
        </thead>
        <tbody>
          ${recentRuns.map(r => `
            <tr>
              <td><a href="${r.html_url}" target="_blank">#${r.run_number}</a></td>
              <td><span class="status-dot" style="background:${statusColor(r.conclusion)}"></span>${r.conclusion || r.status}</td>
              <td>${r.head_branch}</td>
              <td>${r.event}</td>
              <td>${computeDuration(r.run_started_at, r.updated_at)}</td>
              <td>${relativeTime(r.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('dashboard-title').textContent = repo.displayName || repo.name;
}

function parseCov(s) {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function statusColor(c) {
  return { success: 'var(--success)', failure: 'var(--failure)', cancelled: 'var(--cancelled)' }[c] || 'var(--text-muted)';
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
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
