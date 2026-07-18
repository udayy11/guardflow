/**
 * validators.js
 * Shared validation helpers used before sending/accepting data, so
 * malformed input gets caught early instead of failing downstream.
 *
 * Exposes: globalThis.Validators = {
 *   isValidUrl, isValidJson, parseJsonSafe,
 *   isValidWebSocketMessage, isValidSessionId, sanitizeString
 * }
 */

(function () {
  if (globalThis.Validators) {
    console.log("[GuardFlow:Validators] Already loaded, skipping re-init.");
    return;
  }

  const ALLOWED_PROTOCOLS = ['http:', 'https:'];

  /**
   * Checks whether a string is a syntactically valid, http(s) URL.
   * Rejects javascript:, data:, file:, and other non-web schemes.
   */
  function isValidUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      const url = new URL(value);
      return ALLOWED_PROTOCOLS.includes(url.protocol);
    } catch (e) {
      return false;
    }
  }

  /**
   * Checks whether a string parses as valid JSON.
   */
  function isValidJson(value) {
    if (typeof value !== 'string') return false;
    try {
      JSON.parse(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Parses JSON without throwing. Returns { ok, value, error }.
   */
  function parseJsonSafe(value) {
    if (typeof value !== 'string') {
      return { ok: false, value: null, error: 'Input is not a string' };
    }
    try {
      return { ok: true, value: JSON.parse(value), error: null };
    } catch (e) {
      return { ok: false, value: null, error: e.message };
    }
  }

  /**
   * Validates the shape of an outgoing/incoming WebSocket message.
   * Expected shape: { type: string, payload: any, session_id?: string, timestamp?: number }
   * Returns { valid: boolean, errors: string[] }
   */
  function isValidWebSocketMessage(message) {
    const errors = [];

    let msg = message;
    if (typeof message === 'string') {
      const parsed = parseJsonSafe(message);
      if (!parsed.ok) {
        return { valid: false, errors: ['Message is not valid JSON: ' + parsed.error] };
      }
      msg = parsed.value;
    }

    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return { valid: false, errors: ['Message must be a JSON object'] };
    }

    if (!msg.type || typeof msg.type !== 'string') {
      errors.push("Message must include a string 'type' field");
    }

    if (!Object.prototype.hasOwnProperty.call(msg, 'payload')) {
      errors.push("Message must include a 'payload' field");
    }

    if (msg.session_id !== undefined && typeof msg.session_id !== 'string') {
      errors.push("'session_id', if present, must be a string");
    }

    if (msg.timestamp !== undefined && typeof msg.timestamp !== 'number') {
      errors.push("'timestamp', if present, must be a number");
    }

    // Guard against oversized payloads that could indicate a bug or abuse.
    try {
      const size = JSON.stringify(msg).length;
      if (size > 1_000_000) {
        errors.push('Message payload exceeds maximum allowed size (1MB)');
      }
    } catch (e) {
      errors.push('Message could not be serialized to measure size');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validates session IDs produced by session.js (format: sess_<base36>_<base36>).
   */
  function isValidSessionId(value) {
    return typeof value === 'string' && /^sess_[a-z0-9]+_[a-z0-9]+$/i.test(value);
  }

  /**
   * Basic string sanitization for values that will be displayed or logged,
   * to reduce the risk of injecting markup/control characters.
   */
  function sanitizeString(value, maxLength) {
    if (typeof value !== 'string') return '';
    const stripped = value
      .replace(/<[^>]*>/g, '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim();
    const limit = typeof maxLength === 'number' ? maxLength : 500;
    return stripped.slice(0, limit);
  }

  globalThis.Validators = {
    isValidUrl,
    isValidJson,
    parseJsonSafe,
    isValidWebSocketMessage,
    isValidSessionId,
    sanitizeString
  };

  (globalThis.Logger?.info || console.log)("Validators", "validators.js loaded.");
})();
