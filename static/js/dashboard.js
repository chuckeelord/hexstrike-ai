/* HexStrike AI — Mission Control dashboard
 *
 * Read side: polls /api/dashboard/state every POLL_INTERVAL_MS and renders
 * processes + system metrics. /health is fetched once (on load / on demand)
 * since it re-checks ~150 tool binaries and is too heavy to poll.
 *
 * Control side: Pause/Resume/Terminate and Launch call the existing
 * /api/processes/* and /api/tools/* endpoints directly — no new backend
 * logic needed for those, this file is just a client of the existing API.
 */

const POLL_INTERVAL_MS = 3000;

function fmtSeconds(s) {
  if (s === undefined || s === null) return "--";
  if (s < 90) return `${s.toFixed(0)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function setServerStatus(ok, text) {
  const pill = document.getElementById("server-status");
  pill.classList.remove("ok", "bad");
  pill.classList.add(ok ? "ok" : "bad");
  document.getElementById("server-status-text").textContent = text;
}

async function pollState() {
  try {
    const res = await fetch("/api/dashboard/state");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setServerStatus(true, "Online");
    renderMetrics(data);
    renderProcesses(data.processes || []);
  } catch (err) {
    setServerStatus(false, "Unreachable");
    console.error("dashboard poll failed:", err);
  }
}

function renderMetrics(data) {
  const load = data.system_load || {};
  const cache = data.cache_stats || {};
  const tel = data.telemetry || {};

  document.getElementById("m-cpu").textContent = `${(load.cpu_percent ?? 0).toFixed(1)}%`;
  document.getElementById("m-mem").textContent = `${(load.memory_percent ?? 0).toFixed(1)}%`;
  document.getElementById("m-uptime").textContent = fmtSeconds(data.uptime_seconds);

  document.getElementById("m-cache-hits").textContent = cache.hits ?? cache.hit_count ?? "--";
  document.getElementById("m-cache-size").textContent = cache.size ?? cache.cache_size ?? "--";
  document.getElementById("m-cmds").textContent =
    tel.total_commands ?? tel.commands_executed ?? tel.total_executions ?? "--";
}

function renderProcesses(processes) {
  const body = document.getElementById("proc-body");
  document.getElementById("proc-count").textContent = processes.length;

  if (processes.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="muted">No active processes.</td></tr>`;
    return;
  }

  body.innerHTML = processes.map((p) => {
    const pct = Math.max(0, Math.min(1, p.progress_fraction || 0)) * 100;
    return `
      <tr>
        <td>${p.pid}</td>
        <td title="${escapeHtml(p.command)}">${escapeHtml(truncate(p.command, 50))}</td>
        <td>${escapeHtml(p.status)}</td>
        <td>
          <div class="progress-track"><div class="progress-fill" style="width:${pct.toFixed(0)}%"></div></div>
          <span class="muted">${pct.toFixed(0)}%</span>
        </td>
        <td>${fmtSeconds(p.runtime_seconds)}</td>
        <td>${p.eta_seconds ? fmtSeconds(p.eta_seconds) : "--"}</td>
        <td>
          <button data-action="pause" data-pid="${p.pid}">Pause</button>
          <button data-action="resume" data-pid="${p.pid}">Resume</button>
          <button class="btn-danger" data-action="terminate" data-pid="${p.pid}">Kill</button>
        </td>
      </tr>`;
  }).join("");
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Process control buttons (event delegation — rows are re-rendered on every poll)
document.getElementById("proc-body").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, pid } = btn.dataset;

  if (action === "terminate" && !confirm(`Terminate process ${pid}? This cannot be undone.`)) {
    return;
  }

  btn.disabled = true;
  try {
    const res = await fetch(`/api/processes/${action}/${pid}`, { method: "POST" });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || `Failed to ${action} process ${pid}`);
    }
  } catch (err) {
    alert(`Request failed: ${err}`);
  } finally {
    pollState();
  }
});

// Tool availability — fetched on demand (hits /health, which checks ~150 binaries)
async function refreshTools() {
  const grid = document.getElementById("tools-grid");
  grid.innerHTML = `<p class="muted">Checking installed tools…</p>`;
  try {
    const res = await fetch("/health");
    const data = await res.json();
    const cats = data.category_stats || {};
    grid.innerHTML = Object.entries(cats).map(([name, stat]) => {
      const ratio = stat.total ? stat.available / stat.total : 0;
      const cls = ratio === 1 ? "ok" : ratio === 0 ? "bad" : "partial";
      return `<div class="tool-chip"><span>${escapeHtml(name)}</span><span class="count ${cls}">${stat.available}/${stat.total}</span></div>`;
    }).join("");
  } catch (err) {
    grid.innerHTML = `<p class="muted">Failed to load tool status: ${escapeHtml(String(err))}</p>`;
  }
}
document.getElementById("refresh-tools").addEventListener("click", refreshTools);

// Launch scan — posts straight to the existing /api/tools/<tool> endpoints
document.getElementById("launch-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tool = document.getElementById("launch-tool").value;
  const target = document.getElementById("launch-target").value.trim();
  const extraRaw = document.getElementById("launch-extra").value.trim();
  const output = document.getElementById("launch-output");

  let extra = {};
  if (extraRaw) {
    try {
      extra = JSON.parse(extraRaw);
    } catch (err) {
      output.textContent = `Invalid JSON in extra params: ${err}`;
      return;
    }
  }

  output.textContent = `Launching ${tool} against ${target}…`;
  try {
    const res = await fetch(`/api/tools/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, ...extra })
    });
    const data = await res.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    output.textContent = `Request failed: ${err}`;
  } finally {
    pollState();
  }
});

pollState();
setInterval(pollState, POLL_INTERVAL_MS);
