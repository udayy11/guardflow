# GuardFlow — Browser Extension + Backend Setup Guide

This guide walks through setting up the GuardFlow browser extension and backend
from a fresh clone/zip on a **new machine**. Follow these steps in order.

---

## Prerequisites

- **Google Chrome** (or any Chromium-based browser that supports Manifest V3 extensions)
- **Python 3.11** installed (check with `py --list` on Windows, or `python3 --version` on Mac/Linux)
- No Node.js, npm, or build step required — the extension runs unpacked as-is.

---

## Part 1: Load the Chrome Extension

1. Unzip `browser_extension_wired.zip` (or pull the `browser_extension/` folder from git) to a local folder.
2. Open Chrome and go to `chrome://extensions`.
3. Toggle **Developer mode** ON (top-right corner).
4. Click **Load unpacked**.
5. Select the `browser_extension` folder (the folder containing `manifest.json` directly — not a parent folder).
6. Confirm the extension card appears with **no red "Errors" button**.

At this point the extension will try to connect to `ws://localhost:8000/ws` and fail
in a loop (`ERR_CONNECTION_REFUSED`) — that's expected until the backend is running (Part 2).

### Verify it's alive (optional but recommended)
1. On the extension's card, click **"service worker"** (under "Inspect views").
2. You should see startup logs like:
   ```
   [GuardFlow:Logger] logger.js loaded.
   [Background] Alarms scheduled: reconnect + heartbeat
   [Background] Opening WebSocket to ws://localhost:8000/ws
   ```

---

## Part 2: Set Up the Backend

1. Clone/pull the backend repo (or unzip it), and open a terminal in the `backend/` folder.

2. **Create a fresh virtual environment** — do not reuse a venv folder from another machine/user; it's tied to the exact Python path it was created with and will fail on a different device.

   ```bash
   # Windows
   py -3.11 -m venv venv

   # Mac/Linux
   python3.11 -m venv venv
   ```

3. **Activate it:**

   ```powershell
   # Windows (PowerShell)
   .\venv\Scripts\Activate.ps1
   ```
   If PowerShell blocks the script, run this first, then retry:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```

   ```bash
   # Mac/Linux
   source venv/bin/activate
   ```

   Confirm `(venv)` appears at the start of your terminal prompt.

4. **Install dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

5. **No `.env` file is required to get started.** All settings have working defaults
   (see `app/core/settings.py`), including:
   - `DATABASE_URL` → defaults to a local SQLite file (`sqlite:///./data/guardflow.db`), auto-created on first run.
   - `PORT` → defaults to `8000`.

   Only create a `.env` file if you need to override a default (e.g. pointing to a real Postgres DB later).

6. **Start the server:**

   ```bash
   python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

   You should see:
   ```
   INFO:     Uvicorn running on http://0.0.0.0:8000
   ...
   Database initialized successfully
   Application startup completed
   ```

Leave this terminal running — it's your live server. Open a **second terminal tab**
(and re-activate the venv in it) for any further commands.

---

## Part 3: Confirm the Extension Connects

1. Go back to the extension's **service worker console** (`chrome://extensions` → your extension card → "service worker").
2. Within a few seconds you should see the reconnect loop resolve into:
   ```
   [GuardFlow:WS] Connected
   [GuardFlow:WS] Sent: REGISTER_EXTENSION
   [GuardFlow:WS] Received: REGISTERED
   [Background] Registered with backend as browser_extension
   ```
3. On the server terminal, you should see a matching log line:
   ```
   WebSocket client connected
   ```

If both sides show this, the extension and backend are fully connected. ✅

---

## Part 4: Trigger a Real Scan (End-to-End Test)

The backend triggers a scan whenever it receives a `WEBSITE_OPENED` or `LINK_CLICKED`
event carrying a `url`. Simulate this with a test request:

```bash
curl -X POST http://localhost:8000/api/v1/events \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test-1", "event_type": "WEBSITE_OPENED", "timestamp": "2026-07-17T12:00:00Z", "payload": {"url": "https://en.wikipedia.org/wiki/Transactional_analysis"}}'
```

What should happen:
1. Server terminal logs: `Sent ANALYZE_URL to extension for session test-1`.
2. Extension's service worker console logs: `Received: ANALYZE_URL`, then opens/uses a tab and extracts signals.
3. Server terminal logs: `Stored PAGE_ANALYSIS for session test-1`.

Then fetch the computed risk score:

```bash
curl -X POST http://localhost:8000/api/v1/score/test-1
```

This returns a JSON risk assessment (`score`, `level`, `confidence`, `triggered_rules`, etc.)
based on the extension's extracted signals.

---

## Notes for Sharing This Project (git / zip to a teammate)

- **Do not commit** `venv/`, `__pycache__/`, `data/*.db`, or `logs/` — make sure these are
  in `.gitignore`. A committed venv will not work on another machine or OS.
- Each person runs their **own full local stack** (their own extension + their own backend
  on their own `localhost:8000`) — nobody needs to connect to *your* running server.
- If `data/guardflow.db` is accidentally committed, whoever pulls it will inherit your
  local test session data too (harmless, but worth knowing).
- No hardcoded absolute paths should exist in the code — if the setup above fails with a
  path-related error, search for and report any hardcoded paths (e.g. `C:\Users\...`).

---

## Troubleshooting Quick Reference

| Symptom | Likely cause | Fix |
|---|---|---|
| `No Python at 'C:\...\python.exe'` on activate/run | Stale venv from a different machine | Delete `venv/` folder, recreate fresh (Part 2, step 2) |
| Extension shows endless `ERR_CONNECTION_REFUSED` in service worker console | Backend isn't running | Start the backend (Part 2) |
| `Could not establish connection` when messaging a tab | Content script not injected on that page yet | Refresh the target tab, or ensure it's not a `chrome://` page |
| Server fails on startup with a DB error | `data/` folder missing/permission issue | Ensure the backend process can create/write to `./data/` |
| `pip install` fails on a package | Missing build tools (rare, Windows-specific) | Install "Microsoft C++ Build Tools" and retry |
