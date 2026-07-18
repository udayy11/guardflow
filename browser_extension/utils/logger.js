/**
 * logger.js
 * Central logging utility for the extension.
 *
 * Exposes: globalThis.Logger = { info, warn, error, debug, setLevel, getLogs, clearLogs }
 *
 * Instead of console.log() scattered everywhere, use:
 *   Logger.info('popup', 'Scan started', { url });
 *   Logger.error('content', 'Detection failed', err);
 *
 * Loaded first (before constants.js and every other module) in
 * manifest.json's content_scripts array, popup.html, and debug.html, and
 * side-effect-imported first by background.js, so every other module can
 * rely on a global `Logger` being available. Uses globalThis instead of
 * window so this same file works unmodified as a classic content script
 * (globalThis === window) and as a side-effect ES import in the MV3
 * service worker (globalThis === self).
 */

(function () {
  if (globalThis.Logger) {
    // Already initialized (e.g. content script re-injected via
    // chrome.scripting.executeScript on top of the declarative
    // content_scripts injection) — keep the existing instance/log buffer.
    console.log("[GuardFlow:Logger] Already loaded, skipping re-init.");
    return;
  }

  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

  // Default level: verbose in dev, quieter in production.
  let currentLevel = LEVELS.debug;

  const MAX_STORED_LOGS = 500;
  let logBuffer = [];

  function timestamp() {
    return new Date().toISOString();
  }

  function format(level, scope, message) {
    return `[${timestamp()}] [${level.toUpperCase()}]${scope ? ' [' + scope + ']' : ''} ${message}`;
  }

  function record(level, scope, message, data) {
    const entry = { level, scope: scope || null, message, data: data !== undefined ? data : null, time: timestamp() };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_STORED_LOGS) {
      logBuffer.shift();
    }
    return entry;
  }

  function shouldLog(level) {
    return LEVELS[level] >= currentLevel;
  }

  function emit(level, scopeOrMessage, messageOrData, maybeData) {
    // Support both Logger.info('message') and Logger.info('scope', 'message', data)
    let scope, message, data;
    if (arguments.length <= 2 && typeof messageOrData !== 'string') {
      scope = null;
      message = scopeOrMessage;
      data = messageOrData;
    } else if (typeof messageOrData === 'string') {
      scope = scopeOrMessage;
      message = messageOrData;
      data = maybeData;
    } else {
      scope = null;
      message = scopeOrMessage;
      data = messageOrData;
    }

    const entry = record(level, scope, message, data);

    if (!shouldLog(level)) return entry;

    const text = format(level, scope, message);
    const consoleMethod = level === 'debug' ? 'log' : level;

    if (data !== undefined && data !== null) {
      console[consoleMethod](text, data);
    } else {
      console[consoleMethod](text);
    }

    return entry;
  }

  function debug(scope, message, data) {
    return emit('debug', scope, message, data);
  }

  function info(scope, message, data) {
    return emit('info', scope, message, data);
  }

  function warn(scope, message, data) {
    return emit('warn', scope, message, data);
  }

  function error(scope, message, data) {
    // Allow passing an Error object directly as the message.
    if (message instanceof Error) {
      data = { name: message.name, message: message.message, stack: message.stack };
      message = message.message;
    }
    return emit('error', scope, message, data);
  }

  function setLevel(levelName) {
    if (Object.prototype.hasOwnProperty.call(LEVELS, levelName)) {
      currentLevel = LEVELS[levelName];
    }
  }

  function getLogs(filterLevel) {
    if (!filterLevel) return logBuffer.slice();
    return logBuffer.filter(entry => entry.level === filterLevel);
  }

  function clearLogs() {
    logBuffer = [];
  }

  globalThis.Logger = {
    debug,
    info,
    warn,
    error,
    setLevel,
    getLogs,
    clearLogs
  };

  console.log("[GuardFlow:Logger] logger.js loaded.");
})();
