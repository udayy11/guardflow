/**
 * GuardFlow — Debug: Last Scan JSON Viewer (debug.js)
 * -----------------------------------------------------
 * Role: Renders the most recently completed page-analysis JSON as a
 * pretty-printed page in its own tab, so it can be inspected without
 * opening DevTools. Reads from chrome.storage.local via utils/storage.js
 * (Storage.loadLastScan()) — the same local-only copy background.js
 * saves right after sending PAGE_ANALYSIS to the backend over
 * WebSocket. This is purely additive: it does not replace, intercept,
 * or otherwise interfere with that existing WebSocket transmission.
 *
 * Opened via the popup's "View last scan JSON" button (popup.js sends
 * { type: MESSAGE_TYPES.VIEW_LAST_SCAN } to background.js, which opens
 * this page in a new tab).
 */

(function () {
  "use strict";

  async function render() {
    const metaEl = document.getElementById("scanMeta");
    const jsonEl = document.getElementById("scanJson");

    try {
      const scan = await Storage.loadLastScan();

      if (!scan) {
        metaEl.textContent = "";
        jsonEl.textContent = "";
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No scan has completed yet. Trigger an analysis, then reopen this page.";
        jsonEl.replaceWith(empty);
        return;
      }

      const savedAt = scan.savedAt ? new Date(scan.savedAt).toISOString() : "unknown time";
      metaEl.innerHTML =
        `Session: <span>${escapeHtml(scan.session_id || "unknown")}</span> &nbsp;·&nbsp; ` +
        `URL: <span>${escapeHtml(scan.url || "unknown")}</span> &nbsp;·&nbsp; ` +
        `Saved: <span>${escapeHtml(savedAt)}</span>`;

      jsonEl.textContent = JSON.stringify(scan, null, 2);
    } catch (err) {
      Logger.error("Debug", "Failed to load last scan", err);
      metaEl.textContent = "";
      const errorEl = document.createElement("p");
      errorEl.className = "error";
      errorEl.textContent = "Failed to load the last scan from storage: " + String(err?.message ?? err);
      jsonEl.replaceWith(errorEl);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  document.addEventListener("DOMContentLoaded", render);
})();
