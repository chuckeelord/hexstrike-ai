# Mission-Control Dashboard

A browser-based "mission control" UI for the HexStrike AI server, inspired by
the design patterns in Agent-OS / Claude-OS / AI-OS style projects: a
persistent live status view + a thin control surface over the existing
agent/tool orchestration, rather than a new orchestration engine.

## What it is

- `GET /dashboard` — serves the dashboard page (`templates/dashboard.html`,
  `static/css/dashboard.css`, `static/js/dashboard.js`).
- `GET /api/dashboard/state` — a lightweight, pollable JSON snapshot
  (processes, system load, cache stats, telemetry, uptime) purpose-built for
  the dashboard to poll every few seconds.

Everything else the dashboard does — pausing/resuming/terminating a running
process, launching a new scan — calls the **existing** REST endpoints
(`/api/processes/*`, `/api/tools/*`) directly from the browser. No new
orchestration logic was added; the dashboard is a client of the API that
already existed.

## Why a separate `/api/dashboard/state` endpoint instead of reusing `/health` or `/api/processes/dashboard`

- `/health` re-runs `which <tool>` for ~150 tools. It's cached, but it's
  still too heavy to call every 3 seconds — the dashboard calls it once on
  load / on explicit "Refresh" click only.
- `/api/processes/dashboard` pre-renders ASCII-art progress bars and
  colorized text for terminal/MCP clients. The web UI wants raw numeric
  fields (`progress_fraction`, `runtime_seconds`, …) so it can render its
  own HTML progress bars — hence the new endpoint instead of reusing that
  one's output format.

## Design decisions (and why)

These were explicit choices made with the repo owner before implementation —
recorded here so future changes don't accidentally relitigate them without
reason:

1. **Live updates = polling, not WebSockets/SSE.** Zero new dependencies,
   no change to how the server is run (`app.run(...)` is untouched — no
   `socketio.run()` switch). `POLL_INTERVAL_MS` in `dashboard.js` controls
   the cadence (default 3000ms).
2. **Read + control, not read-only.** The dashboard can pause/resume/kill
   processes and launch new scans, by calling the pre-existing endpoints.
   **Caveat:** the server has no authentication layer. Anyone who can reach
   `/dashboard` can reach everything it calls. Don't expose this port
   publicly without putting a reverse proxy + auth in front of it.
3. **Served from `hexstrike_server.py` itself**, not a separate frontend
   project. One process, one `python hexstrike_server.py`, matching this
   repo's existing single-file-server style. Flask's default `static/` and
   `templates/` folder conventions are used as-is — no new Flask config.

## Extending it

- **New tool in the "Launch scan" dropdown:** add an `<option>` in
  `templates/dashboard.html` whose `value` matches an existing
  `/api/tools/<name>` route. The JS POSTs `{target, ...extraParamsJSON}` to
  that route verbatim — no backend change needed as long as the route
  already exists and accepts a `target` field.
- **New metric tile:** add the field to the `/api/dashboard/state` response
  in `hexstrike_server.py`, then read it in `renderMetrics()` in
  `static/js/dashboard.js`.
- **Vulnerability-card / agent-activity feed:** not wired up yet. The
  `/api/visual/vulnerability-card` endpoint exists but nothing currently
  persists cards for the dashboard to poll — agents would need to push them
  somewhere (e.g. an in-memory ring buffer alongside `cache`/`telemetry`)
  before a feed panel could show them live. Left as future work.

## Testing

`tests/test_dashboard.py` exercises `/dashboard` and `/api/dashboard/state`
via Flask's test client. It stubs the `selenium`/`mitmproxy` module-level
imports in `hexstrike_server.py` (they're optional browser-automation /
proxy tooling, not needed to test the HTTP layer), so the suite runs with
just `flask`, `psutil`, `requests`, `beautifulsoup4`, `aiohttp`, and `pytest`
installed — it does not require the full 150+ external security tool stack.

```bash
pip install -r requirements.txt   # or just the lightweight subset above
python3 -m pytest tests/test_dashboard.py -v
```

## Running it

```bash
python3 hexstrike_server.py
# then open http://127.0.0.1:8888/dashboard
```
