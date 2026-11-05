#!/usr/bin/env python3
"""
Tests for the mission-control dashboard added to hexstrike_server.py:
  - GET /dashboard            -> renders the dashboard page
  - GET /api/dashboard/state  -> returns the polling payload the page consumes

hexstrike_server.py imports several heavy, optional security tools
(selenium, mitmproxy) at module scope that aren't needed to test the HTTP
layer. We stub them out before import so these tests can run in a plain
`pip install flask psutil requests beautifulsoup4` environment, matching
what CI/most dev machines will actually have without the full tool stack.

Run with:  python3 -m pytest tests/test_dashboard.py -v
"""

import sys
import types
import os

import pytest


def _stub_module(name, **attrs):
    """Insert a minimal fake module into sys.modules under `name`."""
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    sys.modules[name] = mod
    return mod


def _install_stubs():
    """Stub out selenium/mitmproxy so hexstrike_server.py can be imported
    without those (large, optional) packages installed."""
    if "selenium" in sys.modules:
        return  # already stubbed or really available

    _stub_module("selenium", webdriver=types.SimpleNamespace())
    webdriver_mod = _stub_module("selenium.webdriver", Chrome=object)
    chrome_mod = _stub_module("selenium.webdriver.chrome")
    _stub_module("selenium.webdriver.chrome.options", Options=object)
    _stub_module("selenium.webdriver.common.by", By=object)
    _stub_module("selenium.webdriver.support.ui", WebDriverWait=object)
    _stub_module("selenium.webdriver.support", expected_conditions=object)
    _stub_module(
        "selenium.common.exceptions",
        TimeoutException=Exception,
        WebDriverException=Exception,
    )

    _stub_module("mitmproxy", http=types.SimpleNamespace())
    _stub_module("mitmproxy.tools")
    _stub_module("mitmproxy.tools.dump", DumpMaster=object)
    _stub_module("mitmproxy.options", Options=object)


@pytest.fixture(scope="module")
def client():
    _install_stubs()
    os.environ.setdefault("HEXSTRIKE_PORT", "8888")

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import hexstrike_server  # noqa: E402  (import after stubbing)

    hexstrike_server.app.config["TESTING"] = True
    with hexstrike_server.app.test_client() as test_client:
        yield test_client


def test_dashboard_page_renders(client):
    resp = client.get("/dashboard")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    assert "HexStrike AI" in body
    assert "dashboard.css" in body
    assert "dashboard.js" in body


def test_dashboard_state_shape(client):
    resp = client.get("/api/dashboard/state")
    assert resp.status_code == 200
    data = resp.get_json()

    for key in (
        "timestamp",
        "processes",
        "total_processes",
        "system_load",
        "cache_stats",
        "telemetry",
        "uptime_seconds",
    ):
        assert key in data, f"missing key: {key}"

    assert isinstance(data["processes"], list)
    assert data["total_processes"] == len(data["processes"])
    assert "cpu_percent" in data["system_load"]
    assert "memory_percent" in data["system_load"]


def test_dashboard_state_with_running_process(client):
    """A process registered with ProcessManager should show up in the
    polling payload with the fields the frontend renders."""
    import hexstrike_server as hs

    fake_pid = 999999
    hs.ProcessManager.register_process(fake_pid, "nmap -sV test.local", None)
    hs.active_processes[fake_pid]["progress"] = 0.42

    try:
        resp = client.get("/api/dashboard/state")
        data = resp.get_json()
        matching = [p for p in data["processes"] if p["pid"] == fake_pid]
        assert len(matching) == 1
        entry = matching[0]
        assert entry["progress_fraction"] == 0.42
        assert entry["status"] == "running"
        assert "nmap" in entry["command"]
    finally:
        hs.ProcessManager.cleanup_process(fake_pid)


def test_static_assets_served(client):
    css = client.get("/static/css/dashboard.css")
    js = client.get("/static/js/dashboard.js")
    assert css.status_code == 200
    assert js.status_code == 200
    assert "pollState" in js.get_data(as_text=True)
