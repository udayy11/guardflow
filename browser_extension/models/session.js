/**
 * session.js
 * Manages session state for page analyses. Useful when multiple analyses
 * happen over time (navigations, tab switches, re-scans) and you need to
 * track which one is current, correlate results, or look back at history.
 *
 * Builds on storage.js's saveSession()/loadSession() for persistence, so
 * the "current"/"history" session record survives MV3 service-worker
 * restarts (unlike a plain in-memory variable in background.js would).
 *
 * Exposes: globalThis.Session = {
 *   STATUS, start, update, complete, fail, getCurrent, getHistory, clear,
 *   createSessionRecord
 * }
 */

(function () {
  if (globalThis.Session) {
    console.log("[GuardFlow:Session] Already loaded, skipping re-init.");
    return;
  }

  const STATUS = {
    PENDING: 'pending',
    ANALYZING: 'analyzing',
    COMPLETE: 'complete',
    FAILED: 'failed'
  };

  const MAX_HISTORY = 50;

  function generateSessionId() {
    // Reasonably unique without needing crypto.randomUUID fallback concerns.
    // Delegates to GuardFlowUtils when available (single source of truth
    // for ID generation) but keeps a local fallback so this module can
    // still function if loaded before utils.js for any reason.
    if (globalThis.GuardFlowUtils?.generateId) {
      return globalThis.GuardFlowUtils.generateId('sess');
    }
    return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Starts a new session for the given URL, marking any previous current
   * session as historical. Returns the new session object.
   */
  async function start(url) {
    const existing = (await globalThis.Storage.loadSession()) || {};
    const history = Array.isArray(existing.history) ? existing.history.slice() : [];

    if (existing.current) {
      history.push(existing.current);
      while (history.length > MAX_HISTORY) history.shift();
    }

    const session = {
      session_id: generateSessionId(),
      url: url || (typeof window !== 'undefined' ? window.location.href : null),
      timestamp: Date.now(),
      status: STATUS.PENDING,
      result: null,
      error: null
    };

    await globalThis.Storage.saveSession({ current: session, history });
    return session;
  }

  /**
   * Updates the current session's status (e.g. to ANALYZING) and/or
   * merges in partial data.
   */
  async function update(patch) {
    const existing = (await globalThis.Storage.loadSession()) || {};
    if (!existing.current) {
      throw new Error('Session.update() called with no active session — call Session.start() first.');
    }
    const updated = { ...existing.current, ...patch, timestamp: existing.current.timestamp };
    await globalThis.Storage.saveSession({ current: updated });
    return updated;
  }

  /**
   * Marks the current session complete with its analysis result
   * (e.g. the output of PageSignals.build()).
   */
  async function complete(result) {
    return update({ status: STATUS.COMPLETE, result, completedAt: Date.now() });
  }

  /**
   * Marks the current session failed with an error message.
   */
  async function fail(errorMessage) {
    return update({ status: STATUS.FAILED, error: errorMessage, failedAt: Date.now() });
  }

  async function getCurrent() {
    const existing = await globalThis.Storage.loadSession();
    return (existing && existing.current) || null;
  }

  async function getHistory() {
    const existing = await globalThis.Storage.loadSession();
    return (existing && existing.history) || [];
  }

  async function clear() {
    return globalThis.Storage.clearSession();
  }

  /**
   * Synchronous factory for the lightweight per-request session record
   * background.js's `activeSessions` Map tracks while an ANALYZE_URL
   * request is in flight (keyed by the backend-supplied session_id,
   * correlating it with the tabId opened for it). This is deliberately
   * separate from the async, storage-persisted start()/update()/
   * complete()/fail() API above — the Map exists to handle multiple
   * concurrent in-flight backend requests, which the single-"current"-
   * session model above doesn't represent — but the record shape itself
   * is standardized here rather than an inline object literal in
   * background.js, and reuses the same STATUS constants.
   *
   * @param {string} sessionId - backend-supplied session_id.
   * @param {string} url
   * @param {number|null} [tabId]
   * @returns {{ session_id: string, url: string, tabId: number|null, status: string, createdAt: number }}
   */
  function createSessionRecord(sessionId, url, tabId) {
    return {
      session_id: sessionId,
      url,
      tabId: tabId ?? null,
      status: STATUS.PENDING,
      createdAt: Date.now(),
    };
  }

  globalThis.Session = {
    STATUS,
    start,
    update,
    complete,
    fail,
    getCurrent,
    getHistory,
    clear,
    createSessionRecord,
  };

  (globalThis.Logger?.info || console.log)("Session", "session.js loaded.");
})();
