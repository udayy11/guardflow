/**
 * GuardFlow — Background Service Worker (Manifest V3)
 * ----------------------------------------------------
 * Role: Pure plumbing layer. This file NEVER scores risk and NEVER
 * decides fraud. It only:
 *   1. Maintains a persistent WebSocket connection to the FastAPI backend.
 *   2. Receives ANALYZE_URL requests from the backend.
 *   3. Opens/locates the target tab and asks content-extractor.js to run.
 *   4. Relays extracted signals back to the backend as PAGE_ANALYSIS.
 *
 * MV3 service workers are ephemeral — they can be killed by the browser
 * at any time and woken up on an event. This file is written so that
 * state (socket, session map) is rebuilt cleanly on every wake-up rather
 * than assumed to persist. Durable state (connection state, the last
 * completed page-analysis summary, and the most recent session record)
 * is mirrored to chrome.storage.local via utils/storage.js so it can be
 * displayed correctly even immediately after a service-worker restart.
 *
 * WIRING NOTES (this file was refactored to use the extension's shared
 * modules instead of inline/duplicated logic):
 *   - utils/config.js: WebSocket URL / backend base URL / tuning
 *     constants, instead of a local hardcoded CONFIG object.
 *   - utils/logger.js: all console.log/warn/error calls replaced with
 *     Logger.info/warn/error.
 *   - utils/storage.js: the one direct chrome.storage.local call this
 *     file used to make (persisting connection state) now goes through
 *     Storage.saveConnectionState().
 *   - utils/constants.js: message-type string literals ("ANALYZE_URL",
 *     "STATUS", "GET_STATUS", etc.) replaced with GuardFlowConstants.MESSAGE_TYPES.
 *   - models/session.js: the per-request session record shape (tabId/
 *     url/status/createdAt) is built via Session.createSessionRecord()
 *     instead of an inline object literal, and the single "most recent"
 *     session shown in the popup is tracked via Session's durable
 *     start()/complete()/fail() API (so it survives SW restarts).
 *   - background/websocketClient.js: the raw `new WebSocket(...)`
 *     lifecycle management (open/close/error/reconnect/heartbeat) is
 *     now owned by GuardFlowWebSocketClient; this file just registers
 *     handlers and calls .send()/.connect().
 *   - background/apiClient.js: outbound PAGE_ANALYSIS/STATUS/HEARTBEAT
 *     sends go through GuardFlowApiClient, which prefers the live
 *     WebSocket and automatically falls back to an HTTP POST (with
 *     retry/backoff) if the socket isn't open — messages that used to
 *     be silently dropped when disconnected now have a delivery path.
 *   - background/messageRouter.js: the ANALYZE_URL/REGISTERED
 *     if/else-if chain is now a GuardFlowMessageRouter registry.
 *
 * chrome.alarms (not the WebSocket client's own internal setTimeout/
 * setInterval-based reconnect/heartbeat) remains the source of truth
 * for *scheduling* reconnect attempts and heartbeats, since MV3 service
 * workers can be suspended between alarm firings — a setTimeout/
 * setInterval scheduled while the worker is briefly awake would simply
 * never fire once the worker is killed. The alarm handlers below call
 * into the shared client (`wsClient.connect()` / `wsClient.send(...)`),
 * which is idempotent and safe to invoke redundantly alongside the
 * client's own internal timers.
 */

import "../utils/logger.js";
import "../utils/constants.js";
import "../utils/utils.js";
import "../utils/config.js";
import "../utils/storage.js";
import "../models/session.js";
import {
  GuardFlowWebSocketClient,
  CONNECTION_STATUS,
} from "./websocketClient.js";
import { GuardFlowApiClient } from "./apiClient.js";
import { GuardFlowMessageRouter } from "./messageRouter.js";

const Logger = globalThis.Logger;
const Config = globalThis.Config;
const Storage = globalThis.Storage;
const Session = globalThis.Session;
const GuardFlowUtils = globalThis.GuardFlowUtils;
const { MESSAGE_TYPES } = globalThis.GuardFlowConstants;

// ---------------------------------------------------------------------------
// Configuration — sourced from utils/config.js instead of a local hardcoded
// object, so the backend WebSocket URL/timeouts only need to be edited in
// one place across the whole extension.
// ---------------------------------------------------------------------------

const RECONNECT_ALARM_NAME = "guardflow-reconnect";
const HEARTBEAT_ALARM_NAME = "guardflow-heartbeat";
const RECONNECT_INTERVAL_MINUTES = 0.25; // 15s — MV3 alarms min practical granularity
const HEARTBEAT_INTERVAL_MINUTES = 0.5; // 30s
const TAB_LOAD_TIMEOUT_MS = 30000;
const EXTRACTION_RESPONSE_TIMEOUT_MS = 8000;

//claude adds
const MAX_CONCURRENT_ANALYSES = 2;

// ---------------------------------------------------------------------------
// In-memory state (rebuilt on every service worker wake-up; nothing here is
// assumed to survive a worker restart — persisted essentials live in
// chrome.storage.local via utils/storage.js instead).
// ---------------------------------------------------------------------------

/** Tracks connection state for popup/badge display (also mirrored to storage). */
let connectionState = CONNECTION_STATUS.DISCONNECTED;

/**
 * Maps session_id -> Session.createSessionRecord(...) shape:
 * { session_id, url, tabId, status, createdAt }.
 * Lets us correlate an ANALYZE_URL request with the tab we opened for it,
 * and correlate a later content-script response back to the right session.
 * This Map (not Session's single-"current"-session storage API) is what
 * handles multiple concurrent in-flight backend requests.
 */
const activeSessions = new Map();

/** Most recently completed analysis's summary — fed into GET_STATUS/STATUS_UPDATE. */
let lastSummary = null;
/** { session_id, url, risk_level } — fed into GET_STATUS/STATUS_UPDATE's `session` field. */
let lastSessionInfo = null;

//claude adds
const urlsInFlight = new Set();

let activeAnalysisCount = 0;
const analysisQueue = [];

function acquireAnalysisSlot() {
  if (activeAnalysisCount < MAX_CONCURRENT_ANALYSES) {
    activeAnalysisCount += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => analysisQueue.push(resolve));
}

function releaseAnalysisSlot() {
  const next = analysisQueue.shift();
  if (next) {
    next();
  } else {
    activeAnalysisCount = Math.max(0, activeAnalysisCount - 1);
  }
}

// ---------------------------------------------------------------------------
// Shared WebSocket client (background/websocketClient.js) + API client
// (background/apiClient.js) + message router (background/messageRouter.js)
// ---------------------------------------------------------------------------

const wsClient = new GuardFlowWebSocketClient({
  url: Config.WEBSOCKET_URL,
  heartbeatIntervalMs: Config.WEBSOCKET_HEARTBEAT_MS,
  baseReconnectDelayMs: Config.RECONNECT_INTERVAL_MS,
  maxReconnectDelayMs:
    Config.RECONNECT_INTERVAL_MS * Config.MAX_RECONNECT_ATTEMPTS,
});

const apiClient = new GuardFlowApiClient({
  wsClient,
  httpBaseUrl: Config.BACKEND_URL,
  requestTimeoutMs: Config.REQUEST_TIMEOUT_MS,
});

const messageRouter = new GuardFlowMessageRouter();

wsClient.onStatusChange((status) => {
  setConnectionState(status).catch((err) =>
    Logger.error("Background", "Failed to persist connection state", err),
  );
});

messageRouter.on(MESSAGE_TYPES.ANALYZE_URL, (message) =>
  handleAnalyzeUrlRequest(message),
);
messageRouter.on("REGISTERED", () => {
  Logger.info("Background", "Registered with backend as browser_extension");
});
messageRouter.setDefaultHandler((message) => {
  Logger.info("Background", "Ignoring unknown message type", message?.type);
});

wsClient.on(MESSAGE_TYPES.ANALYZE_URL, (message) =>
  messageRouter.route(message),
);
wsClient.on("REGISTERED", (message) => messageRouter.route(message));

async function setConnectionState(state) {
  connectionState = state;
  Logger.info("Background", "Connection state ->", state);
  await Storage.saveConnectionState(state);
  await broadcastStatusUpdate();
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle
// ---------------------------------------------------------------------------

/**
 * Opens the WebSocket connection to FastAPI via the shared client. Safe to
 * call repeatedly — connect() itself is a no-op if already open/connecting.
 */
async function connectWebSocket() {
  Logger.info("Background", "Opening WebSocket to", Config.WEBSOCKET_URL);
  try {
    await wsClient.connect();
    wsClient.send({ type: "REGISTER_EXTENSION", client: "browser_extension" });
  } catch (err) {
    Logger.error("Background", "Failed to connect WebSocket", err);
    // wsClient's own internal backoff continues in the background; the
    // reconnect alarm below is the durable-across-suspension backstop.
  }
}

// ---------------------------------------------------------------------------
// Incoming backend message handling
// ---------------------------------------------------------------------------

/**
 * Handles an ANALYZE_URL request:
 *   1. Registers the session.
 *   2. Finds an existing tab on that URL, or opens a new background tab.
 *   3. Waits for the page to load, then asks content-extractor.js to run.
 *   4. Forwards the extracted signals back to the backend.
 */
async function handleAnalyzeUrlRequest(message) {
  const { session_id, url } = message;

  if (!session_id || !url) {
    Logger.error(
      "Background",
      "ANALYZE_URL message missing session_id or url",
      message,
    );
    return;
  }
  //claude adds
  if (urlsInFlight.has(url)) {
    Logger.info(
      "Background",
      "Skipping duplicate ANALYZE_URL — already in flight for",
      url,
    );
    return;
  }
  urlsInFlight.add(url);

  // A single session_id can have MULTIPLE concurrent ANALYZE_URL requests
  // in flight (e.g. the user/app opens several links in quick succession
  // within one session). Using the bare session_id as the activeSessions
  // key meant a second concurrent request would overwrite the first
  // request's tracking entry, and whichever request finished first would
  // delete the entry out from under the other one still running -
  // causing "Cannot read properties of undefined (reading/setting 'tabId')"
  // for the request that finishes second. A unique per-request key avoids
  // this collision entirely; session_id/url (unchanged) are still what
  // gets sent back to the backend.
  const requestKey = `${session_id}::${url}::${GuardFlowUtils.generateUuid()}`;

  activeSessions.set(
    requestKey,
    Session.createSessionRecord(session_id, url, null),
  );
  await Session.start(url).catch((err) =>
    Logger.error("Background", "Session.start() failed", err),
  );
  await broadcastStatusUpdate();

  let createdNewTab = false;

  //claude adds
  await acquireAnalysisSlot();

  try {
    const tabResult = await getOrCreateTabForUrl(url);
    const tabId = tabResult.tabId;
    createdNewTab = tabResult.createdNewTab;
    activeSessions.get(requestKey).tabId = tabId;

    await waitForTabToLoad(tabId, TAB_LOAD_TIMEOUT_MS);

    const signals = await requestExtractionFromContentScript(tabId, session_id);

    // Existing WebSocket transmission to the backend — unchanged wire
    // shape, now sent via GuardFlowApiClient (WebSocket-first, HTTP
    // fallback) instead of a raw, fallback-less socket.send().
    await apiClient.sendPageAnalysis({
      session_id,
      url,
      signals,
    });

    // Additive, local-only copy for the "View last scan JSON" debug
    // view (item 14) — does not replace or interfere with the send above.
    await Storage.saveLastScan({ session_id, url, signals });

    lastSummary = signals?.summary ?? null;
    lastSessionInfo = { session_id, url, risk_level: null };
    await Session.complete(signals).catch((err) =>
      Logger.error("Background", "Session.complete() failed", err),
    );

    // Close the tab we opened for this scan — only ours. A tab the user
    // already had open on this URL (createdNewTab === false) is left
    // alone, since closing it out from under them would be worse than
    // leaving one extra background tab.
    if (createdNewTab) {
      await chrome.tabs
        .remove(tabId)
        .catch((err) =>
          Logger.info(
            "Background",
            "Tab already closed or removal failed (non-fatal)",
            err?.message ?? err,
          ),
        );
    }
  } catch (err) {
    Logger.error(
      "Background",
      `Failed to analyze session ${session_id} (${url})`,
      err,
    );
    wsClient.send({
      type: MESSAGE_TYPES.PAGE_ANALYSIS_ERROR,
      session_id,
      url,
      error: String(err?.message ?? err),
    });
    lastSessionInfo = { session_id, url, risk_level: null };
    await Session.fail(String(err?.message ?? err)).catch((sessionErr) =>
      Logger.error("Background", "Session.fail() failed", sessionErr),
    );

    // Still clean up a tab we created, even on failure, so a bad scan
    // doesn't leave an orphaned background tab behind either.
    const failedTabId = activeSessions.get(requestKey)?.tabId;
    if (createdNewTab && failedTabId) {
      await chrome.tabs.remove(failedTabId).catch(() => {});
    }
  } finally {
    //claude adds
    activeSessions.delete(requestKey);
    urlsInFlight.delete(url);
    releaseAnalysisSlot();
    await broadcastStatusUpdate();
  }
}

// ---------------------------------------------------------------------------
// Tab management
// ---------------------------------------------------------------------------

/**
 * Ensures a URL has a scheme before it's handed to chrome.tabs APIs,
 * which require an absolute URL. Some ANALYZE_URL payloads arrive as a
 * bare domain (e.g. "chatgpt.com") with no "https://" prefix - without
 * this, chrome.tabs.create() throws on those instead of just opening
 * the page.
 */
function normalizeUrl(url) {
  try {
    // Already a valid absolute URL - leave it alone.
    new URL(url);
    return url;
  } catch (e) {
    return `https://${url}`;
  }
}

/**
 * Returns the tabId of an existing tab already on `url` if one exists,
 * otherwise opens a new background (non-focused) tab for analysis.
 */
async function getOrCreateTabForUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  // chrome.tabs.query({ url }) treats `url` as a *match pattern*
  // (scheme://host/path, path required), not a literal URL string - it
  // throws "Invalid url pattern" for perfectly valid URLs like
  // "https://openai.com" (no path) or a bare "chatgpt.com" (no scheme,
  // which is exactly what some ANALYZE_URL payloads contain).
  // Querying all tabs and filtering by exact string match avoids
  // Chrome's match-pattern parser entirely.
  const allTabs = await chrome.tabs.query({});
  const existingTab = allTabs.find((tab) => tab.url === url);
  if (existingTab) {
    Logger.info("Background", "Reusing existing tab for", url);
    return { tabId: existingTab.id, createdNewTab: false };
  }

  Logger.info("Background", "Opening new background tab for", url);
  const tab = await chrome.tabs.create({ url, active: false });
  return { tabId: tab.id, createdNewTab: true };
}

/**
 * Resolves once the given tab's top-level frame finishes navigating
 * (chrome.webNavigation.onCompleted), or rejects on timeout.
 *
 * Uses webNavigation instead of tabs.onUpdated's status flag because
 * status:"complete" is tab-list UI bookkeeping that Chrome can deprioritize
 * for tabs sitting in an unfocused window. webNavigation events are tied to
 * the actual network/render pipeline finishing, so they fire reliably even
 * when nothing is on screen to look at. Requires the "webNavigation"
 * permission in manifest.json.
 */
function waitForTabToLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Tab ${tabId} load timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutHandle);
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      chrome.webNavigation.onErrorOccurred.removeListener(onError);
    }

    function onCompleted(details) {
      // frameId 0 = top-level frame. Ignore iframes finishing early.
      if (details.tabId !== tabId || details.frameId !== 0) return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }

    function onError(details) {
      if (details.tabId !== tabId || details.frameId !== 0) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Tab ${tabId} navigation failed: ${details.error ?? "unknown error"}`,
        ),
      );
    }

    chrome.webNavigation.onCompleted.addListener(onCompleted);
    chrome.webNavigation.onErrorOccurred.addListener(onError);

    // Edge case: tab may already be fully loaded before we attached the
    // listeners (e.g. getOrCreateTabForUrl reused an existing tab).
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete" && !settled) {
          settled = true;
          cleanup();
          resolve();
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Communication with content-extractor.js
// ---------------------------------------------------------------------------

/**
 * Ensures the extractor is injected (in case the page loaded before the
 * extension started, or the content_scripts declaration missed a frame
 * timing edge case), then requests extraction and awaits the structured
 * signals payload.
 */
async function requestExtractionFromContentScript(tabId, sessionId) {
  await ensureContentScriptInjected(tabId);

  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(`Extraction response timed out for tab ${tabId}`));
    }, EXTRACTION_RESPONSE_TIMEOUT_MS);

    chrome.tabs.sendMessage(
      tabId,
      { type: MESSAGE_TYPES.EXTRACT_SIGNALS, session_id: sessionId },
      (response) => {
        clearTimeout(timeoutHandle);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || response.type !== MESSAGE_TYPES.SIGNALS_RESULT) {
          reject(
            new Error("Malformed or missing response from content script"),
          );
          return;
        }
        resolve(response.signals);
      },
    );
  });
}

/**
 * Programmatically injects every content-script file if it isn't already
 * running in the tab. Uses the "scripting" permission for the
 * backend-triggered (reactive) analysis path, distinct from the
 * automatic content_scripts declaration used for passive observation.
 * This file list is kept in sync with manifest.json's content_scripts
 * "js" array (same files, same order).
 */
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "utils/logger.js",
        "utils/constants.js",
        "utils/domUtils.js",
        "utils/utils.js",
        "utils/validators.js",
        "models/pageSignals.js",
        "content/textExtractor.js",
        "detectors/keywordDetector.js",
        "detectors/countdownDetector.js",
        "detectors/paymentDetector.js",
        "detectors/governmentDetector.js",
        "detectors/qrDetector.js",
        "detectors/buttonDetector.js",
        "detectors/formDetector.js",
        "detectors/linkDetector.js",
        "detectors/metadataDetector.js",
        "detectors/urlAnalyzer.js",
        "content/pageAnalyzer.js",
        "content/content.js",
      ],
    });
    Logger.info("Background", "content scripts injected into tab", tabId);
  } catch (err) {
    // Injection can "fail" harmlessly if the scripts are already present
    // and re-declare top-level consts. Log and continue — the
    // subsequent sendMessage call will surface any real problem.
    Logger.info(
      "Background",
      "Injection note (may already be present)",
      err?.message ?? err,
    );
  }
}

// ---------------------------------------------------------------------------
// Alarms — reconnection + heartbeat (durable across service-worker
// suspension; see file header for why this doesn't just rely on
// GuardFlowWebSocketClient's own internal timers).
// ---------------------------------------------------------------------------

async function setupAlarms() {
  await chrome.alarms.create(RECONNECT_ALARM_NAME, {
    periodInMinutes: RECONNECT_INTERVAL_MINUTES,
  });
  await chrome.alarms.create(HEARTBEAT_ALARM_NAME, {
    periodInMinutes: HEARTBEAT_INTERVAL_MINUTES,
  });
  Logger.info("Background", "Alarms scheduled: reconnect + heartbeat");
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM_NAME) {
    if (wsClient.getStatus() !== CONNECTION_STATUS.CONNECTED) {
      Logger.info("Background", "Reconnect alarm fired — attempting reconnect");
      connectWebSocket().catch((err) =>
        Logger.error("Background", "Reconnect attempt failed", err),
      );
    }
    return;
  }

  if (alarm.name === HEARTBEAT_ALARM_NAME) {
    if (wsClient.getStatus() === CONNECTION_STATUS.CONNECTED) {
      apiClient
        .sendHeartbeat()
        .catch((err) =>
          Logger.error("Background", "Heartbeat send failed", err),
        );
    }
  }
});

// ---------------------------------------------------------------------------
// Extension lifecycle hooks
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  Logger.info("Background", "onInstalled —", details.reason);
  await setupAlarms();
  await connectWebSocket();
});

chrome.runtime.onStartup.addListener(async () => {
  Logger.info(
    "Background",
    "onStartup — browser launched, initializing GuardFlow",
  );
  await setupAlarms();
  await connectWebSocket();
});

// Service workers can be woken by any event listener firing (e.g. an alarm)
// without onStartup/onInstalled having run in this "session" of the worker.
// This guarantees the socket is (re)established on any wake-up path.
(async function initializeOnWake() {
  const alarms = await chrome.alarms.getAll();
  if (alarms.length === 0) {
    await setupAlarms();
  }
  if (wsClient.getStatus() !== CONNECTION_STATUS.CONNECTED) {
    await connectWebSocket();
  }
  // Restore durable state so GET_STATUS/STATUS_UPDATE are correct
  // immediately after a service-worker restart, before any new
  // analysis has happened in this "session" of the worker.
  connectionState = await Storage.loadConnectionState();
  const currentSession = await Session.getCurrent().catch(() => null);
  if (currentSession) {
    lastSessionInfo = {
      session_id: currentSession.session_id,
      url: currentSession.url,
      risk_level: null,
    };
    lastSummary = currentSession.result?.summary ?? null;
  }
})();

// ---------------------------------------------------------------------------
// Messages from popup — GET_STATUS (request/response) and STATUS_UPDATE
// (proactive push) contract. Purely local UI support, not part of the
// backend WebSocket protocol.
// ---------------------------------------------------------------------------

function buildStatusPayload() {
  return {
    connectionState,
    backendReachable: connectionState === CONNECTION_STATUS.CONNECTED,
    session: lastSessionInfo,
    summary: lastSummary,
    activeSessionCount: activeSessions.size,
  };
}

async function broadcastStatusUpdate() {
  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.STATUS_UPDATE,
      status: buildStatusPayload(),
    });
  } catch (err) {
    // No popup listening right now — expected most of the time, not an error.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.GET_STATUS) {
    sendResponse(buildStatusPayload());
    return true; // keep channel open for async sendResponse (not needed here, but safe)
  }

  if (message?.type === MESSAGE_TYPES.VIEW_LAST_SCAN) {
    chrome.tabs.create({ url: chrome.runtime.getURL("debug/debug.html") });
    return false;
  }

  return false;
});
