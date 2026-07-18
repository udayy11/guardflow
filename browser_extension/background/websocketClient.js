/**
 * GuardFlow — WebSocket Client Module
 * ------------------------------------
 * A self-contained, reusable WebSocket client for talking to the FastAPI
 * backend. This module owns ONLY transport concerns: connecting,
 * reconnecting, heartbeats, serialization, and routing messages to
 * registered handlers by `type`.
 *
 * It contains NO fraud logic, NO DOM access, and NO knowledge of tabs —
 * that orchestration lives in background.js, which imports and uses this
 * client. Keeping this separate makes the transport layer independently
 * testable and reusable (e.g. from a future popup-side diagnostics view).
 *
 * Usage (from background.js, an ES module service worker):
 *
 *   import { GuardFlowWebSocketClient } from "./websocketClient.js";
 *
 *   const client = new GuardFlowWebSocketClient({
 *     url: "ws://localhost:8000/ws/extension",
 *   });
 *
 *   client.on("ANALYZE_URL", async (message) => { ... });
 *   client.onStatusChange((status) => { ... });
 *   await client.connect();
 *   client.send({ type: "PAGE_ANALYSIS", session_id, signals });
 */

// ---------------------------------------------------------------------------
// Supported message types (protocol contract with FastAPI)
// ---------------------------------------------------------------------------

export const MESSAGE_TYPES = Object.freeze({
  ANALYZE_URL: "ANALYZE_URL",       // backend -> extension: please analyze this URL
  PAGE_ANALYSIS: "PAGE_ANALYSIS",   // extension -> backend: extracted signals result
  STATUS: "STATUS",                 // either direction: informational status payload
  HEARTBEAT: "HEARTBEAT",           // either direction: keep-alive ping/pong
  ERROR: "ERROR",                   // either direction: structured error report
});

// ---------------------------------------------------------------------------
// Connection status enum (exposed to consumers via onStatusChange)
// ---------------------------------------------------------------------------

export const CONNECTION_STATUS = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
});

/**
 * GuardFlowWebSocketClient
 * Encapsulates a single persistent WebSocket connection with automatic
 * exponential-backoff reconnection and periodic heartbeats.
 */
export class GuardFlowWebSocketClient {
  /**
   * @param {Object} options
   * @param {string} options.url - Backend WebSocket URL.
   * @param {number} [options.heartbeatIntervalMs=30000] - Ping frequency while connected.
   * @param {number} [options.baseReconnectDelayMs=1000] - Initial backoff delay.
   * @param {number} [options.maxReconnectDelayMs=30000] - Backoff ceiling.
   * @param {number} [options.heartbeatTimeoutMs=10000] - Time to wait for a heartbeat reply before treating the connection as dead.
   */
  constructor(options) {
    if (!options || !options.url) {
      throw new Error("GuardFlowWebSocketClient requires a { url } option");
    }

    this.url = options.url;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10000;

    /** @type {WebSocket | null} */
    this.socket = null;

    this.status = CONNECTION_STATUS.DISCONNECTED;
    this.reconnectAttempt = 0;
    this.shouldReconnect = true; // set false by disconnect() to stop retry loop

    this._heartbeatIntervalHandle = null;
    this._heartbeatTimeoutHandle = null;
    this._reconnectTimeoutHandle = null;

    /** @type {Map<string, Set<Function>>} */
    this._messageHandlers = new Map();
    /** @type {Set<Function>} */
    this._statusListeners = new Set();
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Registers a handler for a specific message type.
   * Multiple handlers per type are supported.
   * @param {string} type - One of MESSAGE_TYPES.
   * @param {(message: Object) => void} handler
   */
  on(type, handler) {
    if (!this._messageHandlers.has(type)) {
      this._messageHandlers.set(type, new Set());
    }
    this._messageHandlers.get(type).add(handler);
  }

  /**
   * Removes a previously registered handler.
   */
  off(type, handler) {
    this._messageHandlers.get(type)?.delete(handler);
  }

  /**
   * Registers a listener for connection status changes.
   * @param {(status: string) => void} listener
   */
  onStatusChange(listener) {
    this._statusListeners.add(listener);
  }

  /**
   * Opens the connection. Idempotent — safe to call if already
   * connected/connecting.
   * @returns {Promise<void>} resolves once the socket reaches OPEN,
   *   or rejects if the initial attempt fails (reconnection still
   *   proceeds in the background regardless).
   */
  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      this._log("connect() called but already", this.socket.readyState === WebSocket.OPEN ? "open" : "connecting");
      return Promise.resolve();
    }

    this.shouldReconnect = true;
    return this._openSocket();
  }

  /**
   * Cleanly closes the connection and stops all reconnect/heartbeat timers.
   * Use this on extension shutdown or when the caller intentionally wants
   * to stop talking to the backend.
   */
  disconnect() {
    this.shouldReconnect = false;
    this._clearHeartbeat();
    this._clearReconnectTimer();

    if (this.socket) {
      this.socket.close(1000, "Client requested disconnect");
      this.socket = null;
    }

    this._setStatus(CONNECTION_STATUS.DISCONNECTED);
  }

  /**
   * Serializes and sends a message if the socket is open.
   * @param {Object} payload - Must include a `type` field (see MESSAGE_TYPES).
   * @returns {boolean} true if sent, false if the socket wasn't ready.
   */
  send(payload) {
    if (!payload || typeof payload !== "object" || !payload.type) {
      this._log("ERROR: send() requires an object payload with a `type` field", payload);
      return false;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this._log("Cannot send — socket not open. Dropped message type:", payload.type);
      return false;
    }

    let serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch (err) {
      this._log("ERROR: failed to serialize payload:", err);
      return false;
    }

    this.socket.send(serialized);
    this._log("Sent:", payload.type, payload.session_id ?? "");
    return true;
  }

  /**
   * Convenience wrapper for reporting a structured error to the backend.
   * @param {string} context - Short description of where the error occurred.
   * @param {Error|string} error
   * @param {string} [sessionId]
   */
  sendError(context, error, sessionId) {
    this.send({
      type: MESSAGE_TYPES.ERROR,
      context,
      message: String(error?.message ?? error),
      session_id: sessionId,
      timestamp: Date.now(),
    });
  }

  getStatus() {
    return this.status;
  }

  // -------------------------------------------------------------------
  // Internal: socket lifecycle
  // -------------------------------------------------------------------

  _openSocket() {
    this._setStatus(
      this.reconnectAttempt > 0 ? CONNECTION_STATUS.RECONNECTING : CONNECTION_STATUS.CONNECTING
    );
    this._log(`Opening WebSocket to ${this.url} (attempt ${this.reconnectAttempt + 1})`);

    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch (err) {
        this._log("ERROR: failed to construct WebSocket:", err);
        this._scheduleReconnect();
        reject(err);
        return;
      }

      this.socket = socket;

      socket.addEventListener("open", () => {
        this._log("Connected");
        this.reconnectAttempt = 0; // reset backoff on success
        this._setStatus(CONNECTION_STATUS.CONNECTED);
        this._startHeartbeat();
        resolve();
      });

      socket.addEventListener("message", (event) => {
        this._handleRawMessage(event.data);
      });

      socket.addEventListener("close", (event) => {
        this._log("Closed", { code: event.code, reason: event.reason });
        this._clearHeartbeat();
        this.socket = null;

        if (this.shouldReconnect) {
          this._setStatus(CONNECTION_STATUS.RECONNECTING);
          this._scheduleReconnect();
        } else {
          this._setStatus(CONNECTION_STATUS.DISCONNECTED);
        }
      });

      socket.addEventListener("error", (event) => {
        this._log("Socket error event:", event);
        // "close" fires after "error" — reconnect scheduling happens there.
        // We don't reject here if already resolved; only reject on the
        // very first connection attempt's failure path via close+reconnect.
      });
    });
  }

  /**
   * Exponential backoff: baseDelay * 2^attempt, capped at maxDelay,
   * with jitter to avoid thundering-herd reconnects if multiple
   * extension instances restart simultaneously.
   */
  _scheduleReconnect() {
    if (!this.shouldReconnect) return;

    this._clearReconnectTimer();

    const exponentialDelay = this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempt);
    const cappedDelay = Math.min(exponentialDelay, this.maxReconnectDelayMs);
    const jitter = Math.random() * 0.3 * cappedDelay; // up to 30% jitter
    const delay = Math.round(cappedDelay + jitter);

    this.reconnectAttempt += 1;
    this._log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this._reconnectTimeoutHandle = setTimeout(() => {
      this._openSocket().catch((err) => {
        this._log("Reconnect attempt failed:", err?.message ?? err);
      });
    }, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimeoutHandle) {
      clearTimeout(this._reconnectTimeoutHandle);
      this._reconnectTimeoutHandle = null;
    }
  }

  // -------------------------------------------------------------------
  // Internal: heartbeat
  // -------------------------------------------------------------------

  /**
   * Sends a HEARTBEAT message on a fixed interval. If no response
   * (of any message type) is observed within heartbeatTimeoutMs after
   * a ping, the socket is forcibly closed, which triggers the normal
   * reconnect path. This catches "half-open" connections where the TCP
   * connection is dead but no close event has fired yet.
   */
  _startHeartbeat() {
    this._clearHeartbeat();

    this._heartbeatIntervalHandle = setInterval(() => {
      const sent = this.send({ type: MESSAGE_TYPES.HEARTBEAT, timestamp: Date.now() });
      if (!sent) return;

      this._heartbeatTimeoutHandle = setTimeout(() => {
        this._log("Heartbeat timed out — treating connection as dead");
        this.socket?.close(4000, "Heartbeat timeout");
      }, this.heartbeatTimeoutMs);
    }, this.heartbeatIntervalMs);
  }

  _clearHeartbeat() {
    if (this._heartbeatIntervalHandle) {
      clearInterval(this._heartbeatIntervalHandle);
      this._heartbeatIntervalHandle = null;
    }
    this._clearHeartbeatTimeout();
  }

  _clearHeartbeatTimeout() {
    if (this._heartbeatTimeoutHandle) {
      clearTimeout(this._heartbeatTimeoutHandle);
      this._heartbeatTimeoutHandle = null;
    }
  }

  // -------------------------------------------------------------------
  // Internal: message routing
  // -------------------------------------------------------------------

  _handleRawMessage(raw) {
    // Any inbound message (of any type) proves the connection is alive,
    // so clear a pending heartbeat timeout.
    this._clearHeartbeatTimeout();

    let message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      this._log("ERROR: received non-JSON message:", raw);
      return;
    }

    if (!message || typeof message !== "object" || !message.type) {
      this._log("ERROR: message missing `type` field:", message);
      return;
    }

    this._log("Received:", message.type, message.session_id ?? "");

    if (message.type === MESSAGE_TYPES.HEARTBEAT) {
      // Heartbeat replies need no further routing beyond keeping the
      // connection marked alive (already done above).
      return;
    }

    const handlers = this._messageHandlers.get(message.type);
    if (!handlers || handlers.size === 0) {
      this._log("No registered handler for message type:", message.type);
      return;
    }

    for (const handler of handlers) {
      try {
        handler(message);
      } catch (err) {
        this._log("ERROR: handler threw for type", message.type, err);
      }
    }
  }

  // -------------------------------------------------------------------
  // Internal: status + logging
  // -------------------------------------------------------------------

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this._statusListeners) {
      try {
        listener(status);
      } catch (err) {
        this._log("ERROR: status listener threw:", err);
      }
    }
  }

  _log(...args) {
    console.log("[GuardFlow:WS]", new Date().toISOString(), ...args);
  }
}
