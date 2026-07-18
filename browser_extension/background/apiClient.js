/**
 * GuardFlow — API Client (apiClient.js)
 * ---------------------------------------------
 * Role: Delivery layer for sending PAGE_ANALYSIS, STATUS, and HEARTBEAT
 * messages to the FastAPI backend. Works alongside websocketClient.js
 * (Prompt 4) rather than replacing it:
 *
 *   - Primary path: hand the message to the existing WebSocket
 *     connection (fast, persistent, no HTTP overhead).
 *   - Fallback path: if the WebSocket isn't connected/open, or the
 *     WebSocket send itself fails, POST the same payload to the
 *     backend's REST endpoint via fetch() instead — with timeout
 *     handling and automatic retry with exponential backoff.
 *
 * This module contains NO business logic — it does not decide risk,
 * does not inspect message contents beyond what's needed to route/
 * serialize them, and does not choose *when* to analyze a page. It
 * only guarantees a message gets to the backend by whichever channel
 * is available, and reports back whether delivery succeeded.
 *
 * Exposed as window.GuardFlowApiClient so background.js can use it as
 * a single "send and don't worry about transport" interface.
 *
 * Usage (from background.js):
 *
 *   const apiClient = new GuardFlowApiClient({
 *     wsClient: myWebSocketClientInstance,   // from websocketClient.js
 *     httpBaseUrl: "http://localhost:8000",
 *   });
 *
 *   await apiClient.sendPageAnalysis({ session_id, url, signals });
 *   await apiClient.sendStatus({ ... });
 *   await apiClient.sendHeartbeat();
 */

// ---------------------------------------------------------------------------
// Message type constants (mirrors websocketClient.js's MESSAGE_TYPES so this
// file can be used standalone even if that module isn't imported directly)
// ---------------------------------------------------------------------------

export const API_MESSAGE_TYPES = Object.freeze({
  PAGE_ANALYSIS: "PAGE_ANALYSIS",
  STATUS: "STATUS",
  HEARTBEAT: "HEARTBEAT",
});

// HTTP fallback endpoint paths, one per message type — must match
// FastAPI's REST route definitions.
const HTTP_ENDPOINTS = Object.freeze({
  PAGE_ANALYSIS: "/api/page-analysis",
  STATUS: "/api/status",
  HEARTBEAT: "/api/heartbeat",
});

export class GuardFlowApiClient {
  /**
   * @param {Object} options
   * @param {Object} [options.wsClient] - A connected WebSocket client
   *   instance (e.g. from websocketClient.js) exposing `.send(payload)`
   *   and `.getStatus()`. Optional — if omitted, all sends go via HTTP.
   * @param {string} options.httpBaseUrl - Base URL for the FastAPI REST
   *   fallback endpoints, e.g. "http://localhost:8000".
   * @param {number} [options.requestTimeoutMs=8000] - Per-request timeout.
   * @param {number} [options.maxRetries=3] - Max retry attempts for HTTP fallback.
   * @param {number} [options.baseRetryDelayMs=500] - Initial retry backoff delay.
   * @param {number} [options.maxRetryDelayMs=8000] - Retry backoff ceiling.
   */
  constructor(options) {
    if (!options || !options.httpBaseUrl) {
      throw new Error("GuardFlowApiClient requires a { httpBaseUrl } option");
    }

    this.wsClient = options.wsClient || null;
    this.httpBaseUrl = options.httpBaseUrl.replace(/\/$/, ""); // strip trailing slash
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 500;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 8000;
  }

  // -------------------------------------------------------------------
  // Public send methods — one per supported message type
  // -------------------------------------------------------------------

  /**
   * Sends a PAGE_ANALYSIS message (extracted webpage signals).
   * @param {{ session_id: string, url: string, signals: Object }} data
   * @returns {Promise<{ delivered: boolean, channel: string|null }>}
   */
  async sendPageAnalysis(data) {
    return this._send(API_MESSAGE_TYPES.PAGE_ANALYSIS, data);
  }

  /**
   * Sends a STATUS message (connection/operational status info).
   * @param {Object} data
   * @returns {Promise<{ delivered: boolean, channel: string|null }>}
   */
  async sendStatus(data) {
    return this._send(API_MESSAGE_TYPES.STATUS, data);
  }

  /**
   * Sends a HEARTBEAT message (keep-alive ping).
   * @param {Object} [data]
   * @returns {Promise<{ delivered: boolean, channel: string|null }>}
   */
  async sendHeartbeat(data) {
    return this._send(API_MESSAGE_TYPES.HEARTBEAT, { timestamp: Date.now(), ...data });
  }

  // -------------------------------------------------------------------
  // Internal: unified send logic (WebSocket-first, HTTP-fallback)
  // -------------------------------------------------------------------

  /**
   * Attempts to send a message via WebSocket first; falls back to the
   * HTTP retry path if the socket isn't open or the send fails.
   * @param {string} type - One of API_MESSAGE_TYPES.
   * @param {Object} data
   * @returns {Promise<{ delivered: boolean, channel: "websocket"|"http"|null }>}
   */
  async _send(type, data) {
    const payload = this._buildPayload(type, data);

    if (this._tryWebSocketSend(payload)) {
      this._log("Sent via WebSocket:", type);
      return { delivered: true, channel: "websocket" };
    }

    this._log("WebSocket unavailable/failed — falling back to HTTP for:", type);

    const httpResult = await this._sendViaHttpWithRetry(type, payload);
    return { delivered: httpResult, channel: httpResult ? "http" : null };
  }

  /**
   * Builds the outgoing payload, ensuring `type` is always present and
   * the object is JSON-serializable up front (fails fast, before any
   * network attempt, if serialization would break).
   */
  _buildPayload(type, data) {
    const payload = { type, ...data };
    try {
      JSON.stringify(payload); // validate serializability early
    } catch (err) {
      this._log("ERROR: payload not JSON-serializable:", err);
      throw new Error(`Cannot send ${type}: payload is not JSON-serializable`);
    }
    return payload;
  }

  /**
   * Attempts delivery via the injected WebSocket client. Returns false
   * (never throws) if no client is set, it isn't connected, or the
   * send call itself reports failure — all of which should trigger
   * the HTTP fallback rather than losing the message.
   */
  _tryWebSocketSend(payload) {
    if (!this.wsClient) return false;

    try {
      const status = typeof this.wsClient.getStatus === "function" ? this.wsClient.getStatus() : null;
      if (status && status !== "connected") {
        return false;
      }
      return !!this.wsClient.send(payload);
    } catch (err) {
      this._log("WebSocket send threw, falling back to HTTP:", err);
      return false;
    }
  }

  // -------------------------------------------------------------------
  // Internal: HTTP fallback with timeout + retry
  // -------------------------------------------------------------------

  /**
   * Sends the payload via fetch() with per-attempt timeout handling and
   * exponential-backoff retry. Returns true once any attempt succeeds,
   * false if all retries are exhausted.
   */
  async _sendViaHttpWithRetry(type, payload) {
    const endpointPath = HTTP_ENDPOINTS[type];
    if (!endpointPath) {
      this._log("ERROR: no HTTP endpoint configured for type:", type);
      return false;
    }

    const url = `${this.httpBaseUrl}${endpointPath}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this._fetchWithTimeout(url, payload);
        this._log(`HTTP send succeeded for ${type} (attempt ${attempt + 1})`);
        return true;
      } catch (err) {
        this._log(`HTTP send failed for ${type} (attempt ${attempt + 1}/${this.maxRetries + 1}):`, err?.message ?? err);

        if (attempt === this.maxRetries) {
          this._log(`All retries exhausted for ${type} — giving up.`);
          return false;
        }

        const delay = this._computeBackoffDelay(attempt);
        await this._sleep(delay);
      }
    }

    return false;
  }

  /**
   * Performs a single fetch() POST with an AbortController-based
   * timeout. Rejects on non-2xx response, network error, or timeout.
   */
  async _fetchWithTimeout(url, payload) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error(`Request timed out after ${this.requestTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Exponential backoff with jitter, capped at maxRetryDelayMs — same
   * approach as websocketClient.js's reconnect logic, kept consistent
   * across the extension's retry behaviors.
   */
  _computeBackoffDelay(attempt) {
    const exponential = this.baseRetryDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exponential, this.maxRetryDelayMs);
    const jitter = Math.random() * 0.3 * capped;
    return Math.round(capped + jitter);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -------------------------------------------------------------------
  // Internal: logging
  // -------------------------------------------------------------------

  _log(...args) {
    console.log("[GuardFlow:ApiClient]", new Date().toISOString(), ...args);
  }
}
