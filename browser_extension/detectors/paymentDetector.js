/**
 * GuardFlow — Payment Detector (paymentDetector.js)
 * -----------------------------------------------------
 * Role: Detector module. Identifies payment-related signals on the
 * page: UPI mentions, QR-payment prompts, registration fee requests,
 * payment gateway buttons, and currency amount patterns (₹).
 *
 * This is a pattern-recognition module only. It reports WHAT payment-
 * related text/markup was observed — it does not decide whether a
 * payment request is legitimate, does not sum or evaluate amounts, and
 * does not produce a risk score. That judgment belongs entirely to the
 * backend's risk_engine.py.
 *
 * NAMING FIX: this function is exposed as
 * window.GuardFlowDetectors.detectRegistrationFeeRequests (not the
 * previous window.GuardFlowDetectors.detectPaymentSignals) because
 * that is the key pageAnalyzer.js's DETECTOR_REGISTRY has always
 * looked up for its "registration_fee_requests" entry — the previous
 * mismatched name meant this detector was silently never invoked from
 * the aggregation pipeline. It is ALSO still exposed under
 * detectPaymentSignals (matching GuardFlowConstants.DETECTOR_NAMES.
 * PAYMENT_SIGNALS) so its full, richer output (upi_mentions,
 * qr_payment_prompts, payment_gateway_buttons, amount_mentions — not
 * just registration_fee_requests) is also available under its own
 * detector_findings key, without losing any existing behavior.
 *
 * Must be loaded before pageAnalyzer.js in manifest.json's
 * content_scripts "js" array.
 *
 * Input: the page's visible text (raw.visible_text_excerpt) and,
 * optionally, pre-extracted buttons array (raw.buttons) from
 * content.js. Falls back to live DOM queries where needed (payment
 * gateway button/branding detection).
 *
 * The canonical keyword groups now come from utils/constants.js's
 * PAYMENT_KEYWORDS (single source of truth); the matching regex per
 * phrase remains defined here.
 */

(function () {
  "use strict";

  if (
    window.GuardFlowDetectors &&
    window.GuardFlowDetectors.detectRegistrationFeeRequests &&
    window.GuardFlowDetectors.detectPaymentSignals
  ) {
    Logger.info("PaymentDetector", "Already loaded, skipping re-init.");
    return;
  }

  // -----------------------------------------------------------------
  // UPI mention patterns — driven by GuardFlowConstants.PAYMENT_KEYWORDS.UPI_TERMS,
  // plus a structural VPA-handle regex that isn't a simple phrase.
  // -----------------------------------------------------------------

  const UPI_PATTERNS = [
    ...GuardFlowConstants.PAYMENT_KEYWORDS.UPI_TERMS.map(
      (term) => new RegExp(`\\b${term.replace(/\s+/g, "\\s*")}\\b`, "i")
    ),
    /[a-z0-9.\-_]{2,256}@(ok(hdfcbank|axis|icici|sbi)?|ybl|paytm|apl|ibl|axl|jio|airtel)\b/i,
  ];

  // -----------------------------------------------------------------
  // QR payment prompt phrasing (text-based; actual QR image/canvas/svg
  // detection is qrDetector.js's job — this catches the surrounding
  // call-to-action wording, e.g. "Scan the QR to pay").
  // -----------------------------------------------------------------

  const QR_PAYMENT_PROMPT_PATTERNS = [
    /\bscan\s*(the|this)?\s*qr\s*(code)?\s*(to\s*pay)?\b/i,
    /\bscan\s*to\s*pay\b/i,
    /\bpay\s*(via|using|through)\s*qr\b/i,
    /\bqr\s*code\s*for\s*payment\b/i,
  ];

  // -----------------------------------------------------------------
  // Registration fee request phrasing — driven by
  // GuardFlowConstants.PAYMENT_KEYWORDS.REGISTRATION_FEE_PHRASES, plus
  // a couple of looser phrasing patterns not expressible as a fixed phrase.
  // -----------------------------------------------------------------

  const REGISTRATION_FEE_PATTERNS = [
    ...GuardFlowConstants.PAYMENT_KEYWORDS.REGISTRATION_FEE_PHRASES.map(
      (phrase) => new RegExp(`\\b${phrase.replace(/[-\s]+/g, "[-\\s]?")}\\b`, "i")
    ),
    /\bpay\s*(a|the)?\s*(nominal|small|token)?\s*fee\s*to\s*(register|confirm|proceed|claim)\b/i,
  ];

  // -----------------------------------------------------------------
  // Payment gateway button/branding phrasing — driven by
  // GuardFlowConstants.PAYMENT_KEYWORDS.PAYMENT_GATEWAYS and
  // .PAYMENT_ACTION_PHRASES.
  // -----------------------------------------------------------------

  const PAYMENT_GATEWAY_PATTERNS = [
    ...GuardFlowConstants.PAYMENT_KEYWORDS.PAYMENT_GATEWAYS.map(
      (name) => new RegExp(`\\b${name.replace(/\s+/g, "\\s*")}\\b`, "i")
    ),
    ...GuardFlowConstants.PAYMENT_KEYWORDS.PAYMENT_ACTION_PHRASES.map(
      (phrase) => new RegExp(`\\b${phrase.replace(/\s+/g, "\\s*")}\\b`, "i")
    ),
  ];

  // -----------------------------------------------------------------
  // Amount pattern (₹ symbol, "Rs.", "INR")
  // -----------------------------------------------------------------

  const AMOUNT_PATTERN = /(₹|rs\.?|inr)\s*[\d,]+(\.\d{1,2})?/gi;

  /**
   * Detects payment-related signals on the page.
   *
   * @param {string} visibleText - The page's extracted visible text.
   * @param {Array|undefined} preExtractedButtons - Optional buttons
   *   array from content.js's extractButtons(), used to cross-check
   *   gateway phrasing against actual clickable elements.
   * @returns {Object} {
   *   upi_mentions: string[],
   *   qr_payment_prompts: string[],
   *   registration_fee_requests: string[],
   *   payment_gateway_buttons: string[],
   *   amount_mentions: string[]
   * }
   */
  function detectPaymentSignals(visibleText, preExtractedButtons) {
    try {
      const text = typeof visibleText === "string" ? visibleText : "";

      return {
        upi_mentions: collectMatches(text, UPI_PATTERNS),
        qr_payment_prompts: collectMatches(text, QR_PAYMENT_PROMPT_PATTERNS),
        registration_fee_requests: collectMatches(text, REGISTRATION_FEE_PATTERNS),
        payment_gateway_buttons: detectPaymentGatewayButtons(text, preExtractedButtons),
        amount_mentions: collectAmountMatches(text),
      };
    } catch (err) {
      Logger.error("PaymentDetector", "detectPaymentSignals failed", err);
      return {
        upi_mentions: [],
        qr_payment_prompts: [],
        registration_fee_requests: [],
        payment_gateway_buttons: [],
        amount_mentions: [],
      };
    }
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  /** Runs a list of patterns against text, collecting deduped first-matches. */
  function collectMatches(text, patterns) {
    const found = [];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) found.push(match[0].trim());
    }
    return GuardFlowDomUtils.dedupe(found.filter(Boolean));
  }

  /** Collects all ₹/Rs./INR amount occurrences, capped for payload size. */
  function collectAmountMatches(text) {
    const matches = [];
    let match;
    const regex = new RegExp(AMOUNT_PATTERN.source, "gi");
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[0].trim());
      if (matches.length >= 30) break;
    }
    return GuardFlowDomUtils.dedupe(matches.filter(Boolean));
  }

  /**
   * Detects payment gateway references, cross-checking button text
   * (if provided) against gateway phrasing, and falling back to a
   * general text scan for gateway names anywhere on the page (e.g.
   * badges/logos with alt text, footer branding).
   */
  function detectPaymentGatewayButtons(text, preExtractedButtons) {
    const found = new Set();

    if (Array.isArray(preExtractedButtons)) {
      for (const btn of preExtractedButtons) {
        const btnText = (btn.text || "").trim();
        if (!btnText) continue;
        for (const pattern of PAYMENT_GATEWAY_PATTERNS) {
          if (pattern.test(btnText)) {
            found.add(btnText.slice(0, 200));
            break;
          }
        }
      }
    }

    // Also scan general page text for gateway branding not necessarily
    // tied to a button (e.g. "Payments secured by Razorpay").
    for (const pattern of PAYMENT_GATEWAY_PATTERNS) {
      const match = text.match(pattern);
      if (match) found.add(match[0].trim());
    }

    return Array.from(found).slice(0, 20);
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  // Fixes the pageAnalyzer.js registry naming mismatch (see file header).
  window.GuardFlowDetectors.detectRegistrationFeeRequests = detectPaymentSignals;
  // Kept for backward compatibility / GuardFlowConstants.DETECTOR_NAMES.PAYMENT_SIGNALS.
  window.GuardFlowDetectors.detectPaymentSignals = detectPaymentSignals;

  Logger.info("PaymentDetector", "paymentDetector.js loaded.");
})();
