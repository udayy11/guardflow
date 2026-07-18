/**
 * GuardFlow — Message Router (messageRouter.js)
 * ---------------------------------------------
 * Role: Central dispatch table for every WebSocket message the
 * extension receives from FastAPI. Replaces an if/else-if chain that
 * would otherwise live inline in background.js with a registry:
 * handlers are registered once per message type, and routing a
 * message becomes a single lookup + call.
 *
 *   Instead of (in background.js):
 *     if (type === "ANALYZE_URL") { ... }
 *     else if (type === "HEARTBEAT") { ... }
 *     else if (type === "STATUS") { ... }
 *
 *   background.js does:
 *     const router = new GuardFlowMessageRouter();
 *     router.on(MESSAGE_TYPES.ANALYZE_URL, handleAnalyzeUrl);
 *     router.on(MESSAGE_TYPES.HEARTBEAT, handleHeartbeat);
 *     router.on(MESSAGE_TYPES.STATUS, handleStatus);
 *     ...
 *     router.route(incomingMessage);
 *
 * This module contains NO business logic of its own — it does not
 * decide what ANALYZE_URL or any other message means, does not touch
 * tabs/DOM/risk scoring. It only matches a message's `type` field to
 * a registered handler and invokes it, defensively. All actual
 * behavior lives in the handler functions background.js registers.
 *
 * Exposed as window.GuardFlowMessageRouter for content-script contexts,
 * and as a named export for background.js (an ES module) to import
 * directly.
 */

// ---------------------------------------------------------------------------
// GuardFlowMessageRouter
// ---------------------------------------------------------------------------

class GuardFlowMessageRouter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();

    /**
     * Optional fallback invoked when a message's type has no
     * registered handler. Defaults to a no-op logger; override with
     * setDefaultHandler() if the caller wants different behavior
     * (e.g. reporting unknown message types back to the backend).
     */
    this._defaultHandler = (message) => {
      console.warn("[GuardFlow:MessageRouter] No handler registered for type:", message?.type);
    };

    /**
     * Optional hook invoked before a message's handler(s) run — useful
     * for shared cross-cutting behavior (logging, metrics) without
     * every handler needing to implement it individually.
     */
    this._beforeRouteHook = null;
  }

  // -------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------

  /**
   * Registers a handler function for a given message type. Multiple
   * handlers may be registered for the same type; all run in
   * registration order when a matching message arrives.
   * @param {string} type - A message type string (e.g. "ANALYZE_URL").
   * @param {(message: Object) => void|Promise<void>} handler
   * @returns {this} for chaining, e.g. router.on(...).on(...).on(...)
   */
  on(type, handler) {
    if (typeof type !== "string" || !type) {
      throw new Error("GuardFlowMessageRouter.on() requires a non-empty string type");
    }
    if (typeof handler !== "function") {
      throw new Error(`GuardFlowMessageRouter.on(${type}) requires a function handler`);
    }

    if (!this._handlers.has(type)) {
      this._handlers.set(type, new Set());
    }
    this._handlers.get(type).add(handler);
    return this;
  }

  /**
   * Removes a previously registered handler for a type.
   * @param {string} type
   * @param {Function} handler
   */
  off(type, handler) {
    this._handlers.get(type)?.delete(handler);
  }

  /**
   * Replaces the fallback invoked when no handler matches a message's
   * type. Receives the full message object.
   * @param {(message: Object) => void} handler
   */
  setDefaultHandler(handler) {
    if (typeof handler === "function") {
      this._defaultHandler = handler;
    }
  }

  /**
   * Registers a hook that runs before every routed message, regardless
   * of type — e.g. for centralized logging. Receives the message; its
   * return value is ignored and it must not throw (errors are caught
   * and logged so a bad hook never blocks routing).
   * @param {(message: Object) => void} hook
   */
  beforeRoute(hook) {
    this._beforeRouteHook = typeof hook === "function" ? hook : null;
  }

  // -------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------

  /**
   * Routes a single message to its registered handler(s), based on
   * `message.type`. Handlers may be async; route() awaits all of them
   * and never throws itself — handler errors are caught per-handler so
   * one failing handler doesn't prevent others (or future messages)
   * from running.
   * @param {Object} message - Must have a `type` field.
   * @returns {Promise<{ routed: boolean, type: string|undefined, handlerCount: number }>}
   */
  async route(message) {
    if (this._beforeRouteHook) {
      try {
        this._beforeRouteHook(message);
      } catch (err) {
        console.error("[GuardFlow:MessageRouter] beforeRoute hook threw:", err);
      }
    }

    if (!message || typeof message !== "object" || !message.type) {
      console.warn("[GuardFlow:MessageRouter] Cannot route message — missing `type`:", message);
      return { routed: false, type: undefined, handlerCount: 0 };
    }

    const handlers = this._handlers.get(message.type);

    if (!handlers || handlers.size === 0) {
      this._defaultHandler(message);
      return { routed: false, type: message.type, handlerCount: 0 };
    }

    const results = await Promise.allSettled(
      Array.from(handlers).map((handler) => Promise.resolve().then(() => handler(message)))
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `[GuardFlow:MessageRouter] Handler #${index} for type "${message.type}" threw:`,
          result.reason
        );
      }
    });

    return { routed: true, type: message.type, handlerCount: handlers.size };
  }

  /**
   * Returns the list of message types currently registered — useful
   * for debugging/logging what the router knows how to handle.
   * @returns {string[]}
   */
  getRegisteredTypes() {
    return Array.from(this._handlers.keys());
  }
}

// ---------------------------------------------------------------------------
// Namespace registration (content-script / non-module contexts)
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  if (!window.GuardFlowMessageRouter) {
    window.GuardFlowMessageRouter = GuardFlowMessageRouter;
    console.log("[GuardFlow:MessageRouter] messageRouter.js loaded.");
  } else {
    console.log("[GuardFlow:MessageRouter] Already loaded, skipping re-init.");
  }
}

// ---------------------------------------------------------------------------
// ES module export (for background.js, which is loaded as type: "module")
// ---------------------------------------------------------------------------

export { GuardFlowMessageRouter };
