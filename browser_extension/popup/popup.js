/**
 * GuardFlow — Popup Script (popup.js)
 * ---------------------------------------
 * Role: Populates popup.html with the extension's CURRENT status and
 * keeps it live-updated by listening for pushes from background.js.
 *
 * This file makes NO fraud decisions and computes NOTHING — it only
 * displays values it is given (connection state, session info, counts,
 * backend reachability, and an already-decided risk level string if
 * one is provided). If no risk level is supplied, the UI simply shows
 * a neutral/unknown state rather than inferring one.
 *
 * Communication contract with background.js:
 *   Request (on popup open):
 *     chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_STATUS })
 *     -> response: PopupStatus (see shape below)
 *
 *   Push (while popup is open):
 *     background.js may send { type: MESSAGE_TYPES.STATUS_UPDATE, status: PopupStatus }
 *     at any time (e.g. right after a PAGE_ANALYSIS completes, or on a
 *     WebSocket state change). popup.js re-renders on every push.
 *
 * Expected PopupStatus shape (fields are all optional/defensive — the
 * UI degrades gracefully if any are missing):
 *   {
 *     connectionState: "connected" | "connecting" | "reconnecting" | "disconnected",
 *     backendReachable: boolean,
 *     session: {
 *       session_id: string,
 *       url: string,
 *       risk_level: "safe" | "medium" | "high" | null
 *     } | null,
 *     summary: {
 *       scam_keyword_count: number,
 *       form_count: number,
 *       total_buttons: number,
 *       qr_present: boolean
 *     } | null
 *   }
 *
 * Requires utils/logger.js and utils/constants.js to be loaded first
 * (see popup.html's <script> order).
 */

(function () {
  "use strict";

  const MESSAGE_TYPES = GuardFlowConstants.MESSAGE_TYPES;

  // -------------------------------------------------------------------
  // DOM references (populated on DOMContentLoaded)
  // -------------------------------------------------------------------

  let els = {};

  function cacheElements() {
    els = {
      connectionBadge: document.getElementById("connectionBadge"),
      connectionLabel: document.getElementById("connectionLabel"),

      sessionId: document.getElementById("sessionId"),
      copySessionBtn: document.getElementById("copySessionBtn"),

      riskDot: document.getElementById("riskDot"),
      analyzedUrl: document.getElementById("analyzedUrl"),

      tileKeywords: document.getElementById("tileKeywords"),
      statKeywords: document.getElementById("statKeywords"),

      tileForms: document.getElementById("tileForms"),
      statForms: document.getElementById("statForms"),

      tileButtons: document.getElementById("tileButtons"),
      statButtons: document.getElementById("statButtons"),

      tileQr: document.getElementById("tileQr"),
      statQr: document.getElementById("statQr"),

      backendStatus: document.getElementById("backendStatus"),
      backendStatusText: document.getElementById("backendStatusText"),

      viewLastScanBtn: document.getElementById("viewLastScanBtn"),
    };
  }

  // -------------------------------------------------------------------
  // Rendering — pure display, no computation of any risk/verdict
  // -------------------------------------------------------------------

  /**
   * Renders a PopupStatus object into the DOM. Every field is treated
   * as optional; missing data falls back to a neutral placeholder
   * rather than guessing or computing a replacement value.
   * @param {Object} status
   */
  function render(status) {
    if (!status || typeof status !== "object") {
      renderConnection("disconnected");
      renderSession(null);
      renderSummary(null);
      renderBackend(false);
      return;
    }

    renderConnection(status.connectionState);
    renderSession(status.session || null);
    renderSummary(status.summary || null);
    renderBackend(!!status.backendReachable);
  }

  function renderConnection(state) {
    const badge = els.connectionBadge;
    const label = els.connectionLabel;
    if (!badge || !label) return;

    badge.classList.remove("is-connected", "is-connecting", "is-disconnected");

    switch (state) {
      case "connected":
        badge.classList.add("is-connected");
        label.textContent = "Connected";
        break;
      case "connecting":
      case "reconnecting":
        badge.classList.add("is-connecting");
        label.textContent = state === "reconnecting" ? "Reconnecting" : "Connecting";
        break;
      case "disconnected":
      default:
        badge.classList.add("is-disconnected");
        label.textContent = "Disconnected";
        break;
    }
  }

  function renderSession(session) {
    if (!els.sessionId || !els.analyzedUrl || !els.riskDot) return;

    if (!session || !session.session_id) {
      els.sessionId.textContent = "No active session";
      els.sessionId.title = "No active session";
      els.sessionId.classList.add("muted");

      els.analyzedUrl.textContent = "No page analyzed yet";
      els.analyzedUrl.title = "No page analyzed yet";

      setRiskDot(null);
      return;
    }

    els.sessionId.textContent = session.session_id;
    els.sessionId.title = session.session_id;
    els.sessionId.classList.remove("muted");

    const displayUrl = session.url || "Unknown URL";
    els.analyzedUrl.textContent = displayUrl;
    els.analyzedUrl.title = displayUrl;

    // risk_level, if present, is a value ALREADY DECIDED by the backend's
    // risk_engine.py and simply passed through for display. This file
    // never computes it — a missing/null value just renders neutral.
    setRiskDot(session.risk_level || null);
  }

  function setRiskDot(riskLevel) {
    if (!els.riskDot) return;
    els.riskDot.classList.remove("safe", "medium", "high");

    if (riskLevel === "safe" || riskLevel === "medium" || riskLevel === "high") {
      els.riskDot.classList.add(riskLevel);
      els.riskDot.setAttribute("aria-label", `Risk level: ${riskLevel}`);
    } else {
      els.riskDot.removeAttribute("aria-label");
    }
  }

  function renderSummary(summary) {
    setFlaggableStat(els.tileKeywords, els.statKeywords, summary?.scam_keyword_count ?? 0);
    setFlaggableStat(els.tileForms, els.statForms, summary?.form_count ?? 0);
    setFlaggableStat(els.tileButtons, els.statButtons, summary?.total_buttons ?? 0);

    if (els.statQr) {
      const qrPresent = !!summary?.qr_present;
      els.statQr.textContent = qrPresent ? "Yes" : "No";
      els.statQr.classList.toggle("bool-yes", qrPresent);
      els.statQr.classList.toggle("bool-no", !qrPresent);
    }
    if (els.tileQr) {
      els.tileQr.classList.toggle("is-flagged", !!summary?.qr_present);
    }
  }

  /**
   * Renders a numeric stat and toggles the tile's "flagged" visual state
   * when the count is greater than zero. Purely presentational — a
   * non-zero count here means "this many were observed," not "this is
   * dangerous."
   */
  function setFlaggableStat(tileEl, valueEl, count) {
    const safeCount = Number.isFinite(count) ? count : 0;
    if (valueEl) valueEl.textContent = String(safeCount);
    if (tileEl) tileEl.classList.toggle("is-flagged", safeCount > 0);
  }

  function renderBackend(reachable) {
    if (!els.backendStatus || !els.backendStatusText) return;

    els.backendStatus.classList.toggle("is-reachable", reachable);
    els.backendStatus.classList.toggle("is-unreachable", !reachable);
    els.backendStatusText.textContent = reachable ? "Reachable" : "Unreachable";
  }

  // -------------------------------------------------------------------
  // Data fetching — request current status from background.js
  // -------------------------------------------------------------------

  function requestStatus() {
    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_STATUS }, (response) => {
        if (chrome.runtime.lastError) {
          Logger.warn("Popup", "GET_STATUS failed", chrome.runtime.lastError.message);
          render(null);
          return;
        }
        render(response);
      });
    } catch (err) {
      Logger.error("Popup", "Failed to request status", err);
      render(null);
    }
  }

  // -------------------------------------------------------------------
  // Live updates — background.js may push STATUS_UPDATE at any time
  // while the popup is open
  // -------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE_TYPES.STATUS_UPDATE) {
      render(message.status);
    }
  });

  // -------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------

  function setupCopySessionButton() {
    if (!els.copySessionBtn) return;

    els.copySessionBtn.addEventListener("click", async () => {
      const sessionText = els.sessionId?.textContent || "";
      if (!sessionText || sessionText === "No active session") return;

      try {
        await navigator.clipboard.writeText(sessionText);
        const original = els.copySessionBtn.textContent;
        els.copySessionBtn.textContent = "Copied";
        setTimeout(() => {
          els.copySessionBtn.textContent = original;
        }, 1200);
      } catch (err) {
        Logger.error("Popup", "Clipboard write failed", err);
      }
    });
  }

  /**
   * "View last scan JSON" button — additive feature (does not replace
   * any existing popup UI). Asks background.js to open the debug/
   * debug.html tab, which reads the last saved scan from
   * chrome.storage.local (via utils/storage.js) and renders it
   * pretty-printed. This is entirely separate from — and does not
   * interfere with — the existing WebSocket transmission of the same
   * data to the backend.
   */
  function setupViewLastScanButton() {
    if (!els.viewLastScanBtn) return;

    els.viewLastScanBtn.addEventListener("click", () => {
      try {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.VIEW_LAST_SCAN });
      } catch (err) {
        Logger.error("Popup", "Failed to request debug view", err);
      }
    });
  }

  // -------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    setupCopySessionButton();
    setupViewLastScanButton();
    requestStatus();
  });
})();
