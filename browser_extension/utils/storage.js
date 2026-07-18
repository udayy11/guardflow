/**
 * storage.js
 * Thin wrapper around chrome.storage.local so the rest of the extension
 * never has to touch the raw storage API directly.
 *
 * Exposes: globalThis.Storage = {
 *   saveSession, loadSession, clearSession,
 *   saveSettings, loadSettings,
 *   saveConnectionState, loadConnectionState,
 *   saveLastScan, loadLastScan,
 *   clearAll
 * }
 *
 * Loaded before background.js's inline logic needs it (side-effect
 * ES import) and before popup.js/debug.js (classic <script> tag).
 * Uses globalThis so the same file works unmodified in both contexts.
 */

(function () {
  if (globalThis.Storage) {
    console.log("[GuardFlow:Storage] Already loaded, skipping re-init.");
    return;
  }

  const KEYS = {
    SESSION: 'session',
    SETTINGS: 'settings',
    CONNECTION_STATE: 'guardflow_connection_state',
    LAST_SCAN: 'guardflow_last_scan'
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    sensitivity: 'medium', // 'low' | 'medium' | 'high'
    notifyOnDetection: true,
    whitelist: []
  };

  function get(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], result => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(result[key]);
      });
    });
  }

  function set(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(value);
      });
    });
  }

  function remove(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([key], () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Save the current session data (e.g. per-tab or per-page detection state).
   * Merges with any existing session object rather than overwriting wholesale.
   */
  async function saveSession(sessionData) {
    const existing = (await get(KEYS.SESSION)) || {};
    const merged = { ...existing, ...sessionData, updatedAt: Date.now() };
    return set(KEYS.SESSION, merged);
  }

  async function loadSession() {
    const session = await get(KEYS.SESSION);
    return session || null;
  }

  async function clearSession() {
    return remove(KEYS.SESSION);
  }

  /**
   * Save user settings. Merges with defaults + any existing settings so
   * partial updates (e.g. just { sensitivity: 'high' }) work as expected.
   */
  async function saveSettings(settingsPatch) {
    const existing = (await get(KEYS.SETTINGS)) || DEFAULT_SETTINGS;
    const merged = { ...DEFAULT_SETTINGS, ...existing, ...settingsPatch };
    return set(KEYS.SETTINGS, merged);
  }

  async function loadSettings() {
    const settings = await get(KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  /**
   * Persists background.js's WebSocket connection state so it survives
   * MV3 service-worker restarts (the in-memory `connectionState` variable
   * does not). Replaces a direct chrome.storage.local.set() call that
   * previously lived inline in background.js.
   */
  async function saveConnectionState(state) {
    return set(KEYS.CONNECTION_STATE, state);
  }

  async function loadConnectionState() {
    const state = await get(KEYS.CONNECTION_STATE);
    return state || 'disconnected';
  }

  /**
   * Persists the most recently completed page-analysis JSON so the
   * "View last scan JSON" debug page can render it in a new tab, without
   * interfering with the existing WebSocket transmission of that same
   * data to the backend (this is a purely additive, local-only copy).
   */
  async function saveLastScan(scanData) {
    return set(KEYS.LAST_SCAN, { ...scanData, savedAt: Date.now() });
  }

  async function loadLastScan() {
    const scan = await get(KEYS.LAST_SCAN);
    return scan || null;
  }

  async function clearAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  globalThis.Storage = {
    saveSession,
    loadSession,
    clearSession,
    saveSettings,
    loadSettings,
    saveConnectionState,
    loadConnectionState,
    saveLastScan,
    loadLastScan,
    clearAll
  };

  (globalThis.Logger?.info || console.log)("Storage", "storage.js loaded.");
})();
