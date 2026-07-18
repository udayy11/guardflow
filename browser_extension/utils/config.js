/**
 * config.js
 * Centralized configuration for the extension. Import/reference this
 * instead of hardcoding URLs, timeouts, and version strings elsewhere.
 *
 * Exposes: globalThis.Config
 *
 * Side-effect-imported by background.js (`import "../utils/config.js"`,
 * then read as `globalThis.Config`) so the WebSocket URL, environment,
 * and API endpoint map only need to be edited in one place.
 */

(function () {
  if (globalThis.Config) {
    console.log("[GuardFlow:Config] Already loaded, skipping re-init.");
    return;
  }

  // Toggle this (or derive it from manifest update_url / build step) to
  // switch between local dev and production backends.
  //
  // NOTE: kept as 'development' here so GuardFlow's actual WebSocket
  // target after this wiring pass (ws://localhost:8000/ws) exactly
  // matches both (a) the value background.js hardcoded before this
  // refactor, and (b) manifest.json's existing host_permissions
  // (ws://localhost:8000/*, wss://*.guardflow.example/*) — switching
  // this to 'production' would point the extension at wss://api.example.com,
  // which is NOT in host_permissions and would silently break every
  // WebSocket connection attempt. Change this only alongside a matching
  // manifest.json host_permissions update.
  const ENVIRONMENT = 'development'; // 'development' | 'staging' | 'production'

  const ENVIRONMENTS = {
    development: {
      BACKEND_URL: 'http://localhost:8000',
      WEBSOCKET_URL: 'ws://localhost:8000/ws'
    },
    staging: {
      BACKEND_URL: 'https://staging-api.example.com',
      WEBSOCKET_URL: 'wss://staging-api.example.com/ws'
    },
    production: {
      BACKEND_URL: 'https://api.example.com',
      WEBSOCKET_URL: 'wss://api.example.com/ws'
    }
  };

  const active = ENVIRONMENTS[ENVIRONMENT];

  // Pull the version straight from manifest.json so it never drifts out of sync.
  function getExtensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (e) {
      return 'unknown';
    }
  }

  const API_ENDPOINTS = {
    ANALYZE_URL: '/api/v1/analyze',
    REPORT_DETECTION: '/api/v1/detections',
    SESSION: '/api/v1/session',
    HEALTH: '/api/v1/health'
  };

  const Config = {
    ENVIRONMENT,

    BACKEND_URL: active.BACKEND_URL,
    WEBSOCKET_URL: active.WEBSOCKET_URL,

    // Connection tuning
    RECONNECT_INTERVAL_MS: 5000,
    MAX_RECONNECT_ATTEMPTS: 10,
    REQUEST_TIMEOUT_MS: 15000,
    WEBSOCKET_HEARTBEAT_MS: 30000,

    EXTENSION_VERSION: getExtensionVersion(),

    API_ENDPOINTS,

    // Convenience helper for building full endpoint URLs.
    buildUrl(endpointKey) {
      const path = API_ENDPOINTS[endpointKey];
      if (!path) {
        throw new Error(`Unknown API endpoint key: ${endpointKey}`);
      }
      return `${active.BACKEND_URL}${path}`;
    }
  };

  globalThis.Config = Config;
  (globalThis.Logger?.info || console.log)("Config", `config.js loaded (environment: ${ENVIRONMENT}).`);
})();
