/**
 * GuardFlow — General Utilities (utils.js)
 * ---------------------------------------------
 * Role: Small, generic, dependency-free helper functions used across
 * the extension (background.js, content scripts, detectors, popup.js).
 * Pure plumbing — no DOM access, no WebSocket/fetch logic, no fraud
 * detection or scoring of any kind. Just the everyday utility layer
 * every other module leans on: timestamps, IDs, logging, JSON safety,
 * rate-limiting helpers, string cleanup, and consistent error shapes.
 *
 * This file previously had a sibling, helpers.js, with overlapping
 * general-purpose helpers (UUIDs, debounce/throttle, truncate, etc).
 * The two have been consolidated here — every distinct function from
 * both files is preserved below; helpers.js has been removed.
 *
 * Exposed as globalThis.GuardFlowUtils. Side-effect-imported by
 * background.js (an ES module, per manifest.json) via
 * `import "../utils/utils.js"`, then read as `globalThis.GuardFlowUtils`
 * — a top-level `export` statement would be a SyntaxError when this
 * same file is loaded as a classic (non-module) content script, so we
 * deliberately avoid one and rely on globalThis instead.
 */

(function () {
  if (globalThis.GuardFlowUtils) {
    console.log("[GuardFlow:Utils] Already loaded, skipping re-init.");
    return;
  }

  // ---------------------------------------------------------------------------
  // Timestamp generation
  // ---------------------------------------------------------------------------

  /**
   * Returns the current time as an ISO 8601 string (UTC), e.g.
   * "2026-07-14T09:32:11.483Z". Preferred format for anything sent to
   * the backend, since it's unambiguous across timezones.
   * @returns {string}
   */
  function nowIso() {
    return new Date().toISOString();
  }

  /**
   * Returns the current time as epoch milliseconds. Useful for duration
   * math (timeouts, backoff calculations, session age) where an ISO
   * string would need re-parsing.
   * @returns {number}
   */
  function nowEpochMs() {
    return Date.now();
  }

  /**
   * Formats a duration in milliseconds as a short human-readable string,
   * e.g. formatDuration(65000) -> "1m 5s". Useful for log lines and any
   * future UI display of session age / time-since-last-heartbeat.
   * @param {number} ms
   * @returns {string}
   */
  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0s";

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(" ");
  }

  /**
   * Formats a timestamp (ms) as an ISO string, or as a relative
   * "time ago" string when `relative` is true. (From helpers.js —
   * distinct from formatDuration()/nowIso() above: this formats a
   * point in time, not a span, and supports the relative "Xm ago" style.)
   * @param {number} timestampMs
   * @param {{ relative?: boolean }} [options]
   * @returns {string|null}
   */
  function formatDate(timestampMs, { relative = false } = {}) {
    const date = new Date(timestampMs);
    if (isNaN(date.getTime())) return null;

    if (!relative) return date.toISOString();

    const diffMs = Date.now() - timestampMs;
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHr = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHr / 24);

    if (diffSec < 60) return diffSec <= 1 ? 'just now' : `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${diffDay}d ago`;
  }

  // ---------------------------------------------------------------------------
  // UUID / ID generation
  // ---------------------------------------------------------------------------

  /**
   * Generates a RFC-4122-compliant v4 UUID. Uses the native
   * crypto.randomUUID() where available (all modern Chrome versions
   * targeted by this extension), falling back to a manual
   * crypto.getRandomValues()-based implementation otherwise.
   * @returns {string}
   */
  function generateUuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return generateUuidFallback();
  }

  /**
   * Manual UUID v4 fallback using crypto.getRandomValues(), for
   * environments where crypto.randomUUID() is unavailable.
   * @returns {string}
   */
  function generateUuidFallback() {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      // Last-resort, non-cryptographic fallback (should not be reached
      // in any supported Chrome environment).
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * Generates a session-scoped ID with a readable prefix, e.g.
   * "session_3f9a1c2b8e4d4a1a". Convenience wrapper over generateUuid()
   * for the common "give me an ID for this thing" case.
   * @param {string} [prefix="id"]
   * @returns {string}
   */
  function generateId(prefix) {
    const shortUuid = generateUuid().replace(/-/g, "").slice(0, 16);
    return `${prefix || "id"}_${shortUuid}`;
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  /**
   * Creates a namespaced logger so every module's console output is
   * consistently tagged and timestamped, e.g.:
   *   const log = createLogger("Background");
   *   log.info("Connected"); -> "[GuardFlow:Background] 2026-07-14T09:32:11.483Z Connected"
   *
   * NOTE: for new code prefer the shared globalThis.Logger (logger.js),
   * which additionally buffers log history and supports level
   * filtering. This factory is kept for any caller wanting a
   * pre-namespaced { info, warn, error } shape without going through
   * Logger's (scope, message, data) call signature.
   * @param {string} namespace
   * @returns {{ info: Function, warn: Function, error: Function }}
   */
  function createLogger(namespace) {
    const tag = `[GuardFlow:${namespace || "General"}]`;

    return {
      info(...args) {
        console.log(tag, nowIso(), ...args);
      },
      warn(...args) {
        console.warn(tag, nowIso(), ...args);
      },
      error(...args) {
        console.error(tag, nowIso(), ...args);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // JSON validation
  // ---------------------------------------------------------------------------

  /**
   * Safely parses a JSON string. Never throws — returns a result object
   * indicating success/failure instead, so callers can branch without
   * try/catch boilerplate at every call site.
   * @param {string} raw
   * @returns {{ valid: boolean, value: *, error: string|null }}
   */
  function safeJsonParse(raw) {
    try {
      const value = JSON.parse(raw);
      return { valid: true, value, error: null };
    } catch (err) {
      return { valid: false, value: null, error: err.message };
    }
  }

  /**
   * Safely serializes a value to a JSON string. Never throws — returns
   * a result object instead, since some values (circular refs, BigInt)
   * can fail to serialize.
   * @param {*} value
   * @returns {{ valid: boolean, json: string|null, error: string|null }}
   */
  function safeJsonStringify(value) {
    try {
      const json = JSON.stringify(value);
      return { valid: true, json, error: null };
    } catch (err) {
      return { valid: false, json: null, error: err.message };
    }
  }

  /**
   * Checks whether a string is valid, parseable JSON without needing
   * the parsed value itself.
   * @param {string} raw
   * @returns {boolean}
   */
  function isValidJson(raw) {
    return safeJsonParse(raw).valid;
  }

  /**
   * Validates that a parsed object has all of the given required keys
   * (shallow check). Useful for quick message-shape validation, e.g.
   * hasRequiredKeys(message, ["type", "session_id"]).
   * @param {Object} obj
   * @param {string[]} requiredKeys
   * @returns {boolean}
   */
  function hasRequiredKeys(obj, requiredKeys) {
    if (!obj || typeof obj !== "object") return false;
    return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
  }

  // ---------------------------------------------------------------------------
  // Debounce / throttle
  // ---------------------------------------------------------------------------

  /**
   * Returns a debounced version of `fn` that only runs after `waitMs`
   * has elapsed since the last call. Useful for e.g. re-running page
   * extraction after DOM mutations settle, rather than on every mutation.
   * @param {Function} fn
   * @param {number} [waitMs=250]
   * @returns {Function} debounced function (same args as fn)
   */
  function debounce(fn, waitMs = 250) {
    let timeoutHandle = null;

    return function debounced(...args) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        fn.apply(this, args);
      }, waitMs);
    };
  }

  /**
   * Returns a throttled version of `fn` that runs at most once per
   * `waitMs` window. Unlike debounce, guarantees periodic execution
   * during continuous activity (e.g. rate-limiting a scroll/heartbeat-
   * style handler) rather than only firing after activity stops.
   * Guarantees a trailing call so the final invocation in a burst isn't
   * silently dropped.
   * @param {Function} fn
   * @param {number} [waitMs=250]
   * @returns {Function} throttled function (same args as fn)
   */
  function throttle(fn, waitMs = 250) {
    let lastCallTime = 0;
    let trailingTimeoutHandle = null;
    let trailingArgs = null;

    return function throttled(...args) {
      const now = Date.now();
      const remaining = waitMs - (now - lastCallTime);

      if (remaining <= 0) {
        lastCallTime = now;
        fn.apply(this, args);
      } else {
        // Schedule a trailing call so the final invocation in a burst
        // isn't silently dropped.
        trailingArgs = args;
        if (!trailingTimeoutHandle) {
          trailingTimeoutHandle = setTimeout(() => {
            lastCallTime = Date.now();
            trailingTimeoutHandle = null;
            fn.apply(this, trailingArgs);
          }, remaining);
        }
      }
    };
  }

  // ---------------------------------------------------------------------------
  // String normalization
  // ---------------------------------------------------------------------------

  /**
   * Collapses all whitespace runs into single spaces and trims the
   * result. The shared whitespace-normalization routine used by
   * textExtractor.js and any detector doing its own text handling.
   * Equivalent to helpers.js's former cleanString(), kept available
   * under both names since both were in use across the two files.
   * @param {string} text
   * @returns {string}
   */
  function normalizeWhitespace(text) {
    return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  }

  /** Alias of normalizeWhitespace() — matches helpers.js's former name. */
  function cleanString(text) {
    return normalizeWhitespace(text);
  }

  /**
   * Lowercases and trims a string, safely handling non-string input.
   * @param {string} text
   * @returns {string}
   */
  function normalizeCase(text) {
    return typeof text === "string" ? text.trim().toLowerCase() : "";
  }

  /**
   * Truncates a string to maxLength, appending an ellipsis marker if
   * truncation occurred. Used anywhere a payload needs a size cap
   * (visible text excerpts, query param values, button/link text).
   * @param {string} text
   * @param {number} maxLength
   * @returns {string}
   */
  function truncate(text, maxLength) {
    if (typeof text !== "string") return "";
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "…";
  }

  /**
   * Cleans and truncates a string in one step, appending an ellipsis
   * and trimming trailing whitespace at the cut point. From helpers.js
   * (formerly truncate() there) — kept under a distinct name since
   * utils.js's own truncate() above has a different signature (no
   * default length, no whitespace-cleaning pass first).
   * @param {string} value
   * @param {number} [maxLength=100]
   * @returns {string}
   */
  function cleanAndTruncate(value, maxLength = 100) {
    const str = cleanString(value);
    if (str.length <= maxLength) return str;
    return str.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
  }

  /**
   * Removes diacritics/accents from a string (NFKD normalize + strip
   * combining marks), useful for more lenient keyword matching (e.g.
   * "café" -> "cafe") without changing casing.
   * @param {string} text
   * @returns {string}
   */
  function stripDiacritics(text) {
    if (typeof text !== "string") return "";
    return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }

  /**
   * Strips common invisible/zero-width characters sometimes used to
   * disguise text (a trick seen in phishing/scam pages). From helpers.js.
   * @param {string} value
   * @returns {string}
   */
  function stripInvisibleChars(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
  }

  // ---------------------------------------------------------------------------
  // Object / value helpers (from helpers.js)
  // ---------------------------------------------------------------------------

  /**
   * Deep-clones a plain JSON-serializable object/array.
   * @param {*} obj
   * @returns {*}
   */
  function deepClone(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Safely gets a nested property via a dot-path string, e.g.
   * getPath(obj, 'a.b.c'), returning `fallback` if any part is missing.
   * @param {Object} obj
   * @param {string} path
   * @param {*} [fallback]
   * @returns {*}
   */
  function getPath(obj, path, fallback = undefined) {
    if (!obj || typeof path !== 'string') return fallback;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null || !(part in current)) return fallback;
      current = current[part];
    }
    return current === undefined ? fallback : current;
  }

  /**
   * Clamp a number between min and max.
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * Extracts the hostname from a URL string. Returns null if the URL
   * is invalid.
   * @param {string} urlString
   * @returns {string|null}
   */
  function extractHostname(urlString) {
    try {
      return new URL(urlString).hostname;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Error formatting
  // ---------------------------------------------------------------------------

  /**
   * Normalizes any thrown value (Error instance, string, or arbitrary
   * object) into a consistent, serializable error shape — useful before
   * sending an ERROR message to the backend or logging structured errors.
   * @param {*} err
   * @param {string} [context] - Optional short description of where the error occurred.
   * @returns {{ message: string, name: string, stack: string|null, context: string|null, timestamp: string }}
   */
  function formatError(err, context) {
    if (err instanceof Error) {
      return {
        message: err.message,
        name: err.name || "Error",
        stack: err.stack || null,
        context: context || null,
        timestamp: nowIso(),
      };
    }

    if (typeof err === "string") {
      return {
        message: err,
        name: "Error",
        stack: null,
        context: context || null,
        timestamp: nowIso(),
      };
    }

    // Arbitrary thrown object — stringify defensively rather than assume shape.
    const stringified = safeJsonStringify(err);
    return {
      message: stringified.valid ? stringified.json : String(err),
      name: "UnknownError",
      stack: null,
      context: context || null,
      timestamp: nowIso(),
    };
  }

  // ---------------------------------------------------------------------------
  // Namespace registration — globalThis so this file works unmodified as a
  // classic content script (globalThis === window) and as a side-effect ES
  // import in the background service worker (globalThis === self).
  // ---------------------------------------------------------------------------

  globalThis.GuardFlowUtils = Object.freeze({
    nowIso,
    nowEpochMs,
    formatDuration,
    formatDate,
    generateUuid,
    generateUUID: generateUuid, // alias — matches helpers.js's former casing
    generateId,
    createLogger,
    safeJsonParse,
    safeJsonStringify,
    isValidJson,
    hasRequiredKeys,
    debounce,
    throttle,
    normalizeWhitespace,
    cleanString,
    normalizeCase,
    truncate,
    cleanAndTruncate,
    stripDiacritics,
    stripInvisibleChars,
    deepClone,
    getPath,
    clamp,
    extractHostname,
    formatError,
  });

  (globalThis.Logger?.info || console.log)("Utils", "utils.js loaded (helpers.js merged in).");
})();
