/**
 * GuardFlow — Shared Constants (constants.js)
 * ---------------------------------------------
 * Role: Single source of truth for fixed values referenced across the
 * extension — message types, detector names, keyword lists, TLD
 * watchlists, and event names. Consolidating these here means a
 * keyword or message-type change only needs to happen in one place,
 * rather than being edited independently inside each detector file
 * where it currently lives inline.
 *
 * This file contains NO logic — no functions, no scoring, no
 * detection. Just named, frozen constant values.
 *
 * Exposed as window.GuardFlowConstants in content-script contexts, and
 * as named exports for background.js (an ES module, per manifest.json)
 * to `import { ... } from "./constants.js"`.
 *
 * NOTE ON INTEGRATION: detector files generated earlier (keywordDetector.js,
 * urlAnalyzer.js, governmentDetector.js, paymentDetector.js,
 * websocketClient.js) each currently define their own local copies of
 * these same lists. This file does not retroactively remove those —
 * consolidating them to import from here instead is a follow-up
 * refactor, not something silently assumed to have already happened.
 */

// ---------------------------------------------------------------------------
// WebSocket message types — the full protocol contract between the
// extension and FastAPI, plus internal (extension-only) message types
// used between background.js, content scripts, and the popup.
// ---------------------------------------------------------------------------

const MESSAGE_TYPES = Object.freeze({
  ANALYZE_URL: "ANALYZE_URL",             // backend -> extension
  PAGE_ANALYSIS: "PAGE_ANALYSIS",         // extension -> backend
  PAGE_ANALYSIS_ERROR: "PAGE_ANALYSIS_ERROR", // extension -> backend
  STATUS: "STATUS",                       // either direction
  STATUS_UPDATE: "STATUS_UPDATE",         // background -> popup (internal)
  HEARTBEAT: "HEARTBEAT",                 // either direction
  ERROR: "ERROR",                         // either direction
  GET_STATUS: "GET_STATUS",               // popup -> background (internal)
  EXTRACT_SIGNALS: "EXTRACT_SIGNALS",     // background -> content script (internal)
  SIGNALS_RESULT: "SIGNALS_RESULT",       // content script -> background (internal)
  VIEW_LAST_SCAN: "VIEW_LAST_SCAN",       // popup -> background (internal): open the last-scan JSON debug tab
});

// ---------------------------------------------------------------------------
// Detector names — canonical keys used in pageAnalyzer.js's
// DETECTOR_REGISTRY and in the aggregated detector_findings object.
// Keeping these as named constants avoids typo drift between the
// registry, the detector modules themselves, and the backend's
// expectations of the PAGE_ANALYSIS payload shape.
// ---------------------------------------------------------------------------

const DETECTOR_NAMES = Object.freeze({
  SCAM_KEYWORDS: "detectScamKeywords",
  COUNTDOWN_TIMERS: "detectCountdownTimers",
  REGISTRATION_FEE_REQUESTS: "detectRegistrationFeeRequests",
  GOVERNMENT_REFERENCES: "detectGovernmentReferences",
  QR_CANDIDATES: "detectQrCandidates",
  FORM_FIELDS: "detectFormFields",
  BUTTONS: "detectButtons",
  PAYMENT_SIGNALS: "detectPaymentSignals",
  // NOTE: this key intentionally matches urlAnalyzer.js's actual exposed
  // function name (detectUrlCharacteristics), not the aspirational
  // "analyzeUrl" name this constant previously held — that mismatch was
  // never wired into pageAnalyzer.js, so it never actually mattered, but
  // as the single source of truth this must reflect reality.
  URL_ANALYSIS: "detectUrlCharacteristics",
  LINKS: "detectLinks",
  PAGE_METADATA: "detectPageMetadata",
});

// ---------------------------------------------------------------------------
// Scam keyword list — canonical labels used by keywordDetector.js.
// Listed here as plain strings (not regexes) since regex construction
// details (word boundaries, pluralization) belong in the detector
// itself; this is the authoritative "which keywords do we care about"
// list other tooling (docs, eval scripts, demo_data fixtures) can read
// without parsing regex source.
// ---------------------------------------------------------------------------

const SCAM_KEYWORDS = Object.freeze([
  "scholarship",
  "registration fee",
  "kyc",
  "pan",
  "aadhaar",
  "urgent",
  "verify account",
  "lottery",
  "reward",
  "payment",
  "upi",
  "bank",
  "refund",
  "internship",
  "admission fee",
]);

// ---------------------------------------------------------------------------
// Suspicious TLD watchlist — used by urlAnalyzer.js. Non-exhaustive;
// presence here is an observation signal, not proof of malicious intent.
// ---------------------------------------------------------------------------

const SUSPICIOUS_TLDS = Object.freeze([
  "tk", "ml", "ga", "cf", "gq",
  "xyz", "top", "club", "work", "click", "link",
  "loan", "win", "download", "review", "party", "men",
]);

// ---------------------------------------------------------------------------
// Government entity/scheme reference labels — used by governmentDetector.js.
// ---------------------------------------------------------------------------

const GOVERNMENT_KEYWORDS = Object.freeze([
  "Government of India",
  "National Scholarship Portal",
  "AICTE",
  "UGC",
  "Digital India",
  "PM Scholarship",
  "State Government Scheme",
]);

// Official government domain suffixes — used alongside GOVERNMENT_KEYWORDS
// to observe (not conclude) whether a page's domain matches known
// official conventions.
const OFFICIAL_GOVERNMENT_DOMAIN_SUFFIXES = Object.freeze([
  ".gov.in",
  ".nic.in",
]);

// ---------------------------------------------------------------------------
// Payment-related keyword groups — used by paymentDetector.js.
// Grouped by sub-category since paymentDetector.js reports each
// separately rather than as one flat list.
// ---------------------------------------------------------------------------

const PAYMENT_KEYWORDS = Object.freeze({
  UPI_TERMS: Object.freeze(["upi", "vpa", "upi id"]),

  QR_PAYMENT_PHRASES: Object.freeze([
    "scan the qr",
    "scan to pay",
    "pay via qr",
    "qr code for payment",
  ]),

  REGISTRATION_FEE_PHRASES: Object.freeze([
    "registration fee",
    "application fee",
    "processing fee",
    "confirmation fee",
    "security deposit",
    "one-time fee",
    "refundable fee",
  ]),

  PAYMENT_GATEWAYS: Object.freeze([
    "razorpay",
    "paytm",
    "phonepe",
    "google pay",
    "gpay",
    "cashfree",
    "instamojo",
    "ccavenue",
    "paypal",
    "stripe",
    "billdesk",
  ]),

  PAYMENT_ACTION_PHRASES: Object.freeze([
    "pay now",
    "proceed to payment",
    "make payment",
    "complete payment",
    "checkout",
    "confirm payment",
  ]),
});

// ---------------------------------------------------------------------------
// Event names — Android Accessibility Service observation events (per
// GuardFlow's architecture doc) that the extension may reference when
// correlating its own PAGE_ANALYSIS output against the timeline the
// backend is assembling from Android. The extension does not emit
// these itself; it emits PAGE_ANALYSIS/STATUS/HEARTBEAT only. Included
// here so any extension-side logging/debugging that references an
// Android event by name uses the same spelling as the backend.
// ---------------------------------------------------------------------------

const ANDROID_EVENT_NAMES = Object.freeze({
  SMS_RECEIVED: "SMS_RECEIVED",
  LINK_CLICKED: "LINK_CLICKED",
  BROWSER_OPENED: "BROWSER_OPENED",
  FORM_FIELD_FILLED: "FORM_FIELD_FILLED",
  FORM_SUBMITTED: "FORM_SUBMITTED",
  PAYMENT_INITIATED: "PAYMENT_INITIATED",
  SCREEN_SHARE_STARTED: "SCREEN_SHARE_STARTED",
  APP_SWITCHED: "APP_SWITCHED",
});

// Extension-side lifecycle/event names — for internal logging and
// alarm scheduling (background.js), distinct from the Android events above.
const EXTENSION_EVENT_NAMES = Object.freeze({
  WEBSOCKET_CONNECTED: "WEBSOCKET_CONNECTED",
  WEBSOCKET_DISCONNECTED: "WEBSOCKET_DISCONNECTED",
  WEBSOCKET_RECONNECTING: "WEBSOCKET_RECONNECTING",
  ANALYSIS_STARTED: "ANALYSIS_STARTED",
  ANALYSIS_COMPLETED: "ANALYSIS_COMPLETED",
  ANALYSIS_FAILED: "ANALYSIS_FAILED",
  ALARM_RECONNECT: "guardflow-reconnect",
  ALARM_HEARTBEAT: "guardflow-heartbeat",
});

// ---------------------------------------------------------------------------
// Namespace registration — globalThis works unmodified whether this file is
// loaded as a classic content script (globalThis === window), as a classic
// script in popup.html/debug.html, or side-effect-imported as an ES module
// by background.js's service worker (globalThis === self). Consumers in
// background.js do `import "../utils/constants.js"` for the side effect,
// then read `globalThis.GuardFlowConstants` — a plain top-level `export`
// statement here would be a SyntaxError when this same file is loaded as a
// classic (non-module) content script, so we deliberately avoid one.
// ---------------------------------------------------------------------------

const GuardFlowConstants = Object.freeze({
  MESSAGE_TYPES,
  DETECTOR_NAMES,
  SCAM_KEYWORDS,
  SUSPICIOUS_TLDS,
  GOVERNMENT_KEYWORDS,
  OFFICIAL_GOVERNMENT_DOMAIN_SUFFIXES,
  PAYMENT_KEYWORDS,
  ANDROID_EVENT_NAMES,
  EXTENSION_EVENT_NAMES,
});

if (!globalThis.GuardFlowConstants) {
  globalThis.GuardFlowConstants = GuardFlowConstants;
  (globalThis.Logger?.info || console.log)("Constants", "constants.js loaded.");
} else {
  (globalThis.Logger?.debug || console.log)("Constants", "Already loaded, skipping re-init.");
}
