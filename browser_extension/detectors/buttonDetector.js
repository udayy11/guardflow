/**
 * GuardFlow — Button Detector (buttonDetector.js)
 * ---------------------------------------------------
 * Role: Detector module. Identifies buttons on the page and flags which
 * ones look like payment-flow actions (e.g. "Pay Now", "Proceed to
 * Payment") versus generic flow buttons (e.g. "Continue", "Submit").
 *
 * This is a pattern-recognition module only — it reports WHAT button
 * text was observed and WHICH buttons match payment-style phrasing. It
 * does not decide whether the page is a scam and does not produce a
 * risk score; that judgment belongs entirely to the backend's
 * risk_engine.py.
 *
 * Exposed as window.GuardFlowDetectors.detectButtons so it plugs into
 * pageAnalyzer.js's DETECTOR_REGISTRY like every other detector. Must
 * be loaded before pageAnalyzer.js in manifest.json's content_scripts
 * "js" array.
 *
 * Input: operates directly on the live document (queries clickable
 * elements itself), OR can be called with a pre-extracted buttons
 * array from content.js.
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectButtons) {
    Logger.info("ButtonDetector", "Already loaded, skipping re-init.");
    return;
  }

  const CLICKABLE_SELECTOR = 'button, [role="button"], input[type="submit"], input[type="button"], a[href="#"]';

  // -----------------------------------------------------------------
  // Payment-style phrasing — buttons whose text suggests they trigger
  // or move toward an actual money transfer. Checked first since these
  // are the most specific / highest-signal category.
  // -----------------------------------------------------------------
  const PAYMENT_PATTERNS = [
    /\bpay\s*now\b/i,
    /\bproceed\s*to\s*payment\b/i,
    /\bmake\s*payment\b/i,
    /\bcomplete\s*payment\b/i,
    /\bpay\s*(fee|now|online|amount)?\b/i,
    /\bcheckout\b/i,
    /\bconfirm\s*payment\b/i,
    /\bdeposit\b/i,
    /\btransfer\s*(now|funds|amount)?\b/i,
  ];

  // -----------------------------------------------------------------
  // Generic flow phrasing — common step-progression buttons that aren't
  // themselves payment actions but often precede or follow one.
  // -----------------------------------------------------------------
  const FLOW_PATTERNS = [
    /\bcontinue\b/i,
    /\bregister\b/i,
    /\bverify\b/i,
    /\bsubmit\b/i,
    /\bproceed\b/i,
    /\bnext\b/i,
    /\bconfirm\b/i,
    /\bget\s*started\b/i,
    /\bapply\s*now\b/i,
  ];

  /**
   * Determines the category of a single button's text.
   * "payment" takes precedence over "flow" if a text happens to match
   * both (e.g. "Confirm Payment" matches both /confirm/ and
   * /confirm\s*payment/; the payment check runs first so the more
   * specific match wins).
   */
  function classifyButtonText(text) {
    const normalized = (text || "").trim();

    if (PAYMENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return "payment";
    }
    if (FLOW_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return "flow";
    }
    return "other";
  }

  /**
   * Detects and classifies buttons on the page.
   *
   * @param {Array|undefined} preExtractedButtons - Optional buttons array
   *   already produced by content.js's extractButtons(). If provided,
   *   classification is applied to that data directly instead of
   *   re-querying the DOM.
   * @returns {Object} {
   *   buttons: [{ text, category }],
   *   payment_buttons: [{ text }],
   *   total_buttons: number
   * }
   */
  function detectButtons(preExtractedButtons) {
    try {
      const rawButtons = Array.isArray(preExtractedButtons)
        ? preExtractedButtons
        : extractButtonsFromDom();

      const classified = rawButtons.map((btn) => ({
        text: (btn.text || "").trim().slice(0, 200),
        category: classifyButtonText(btn.text),
      }));

      const paymentButtons = classified
        .filter((btn) => btn.category === "payment")
        .map((btn) => ({ text: btn.text }));

      return {
        buttons: classified,
        payment_buttons: paymentButtons,
        total_buttons: classified.length,
      };
    } catch (err) {
      Logger.error("ButtonDetector", "detectButtons failed", err);
      return { buttons: [], payment_buttons: [], total_buttons: 0 };
    }
  }

  /**
   * Fallback DOM query used only when no pre-extracted buttons array is
   * supplied — lets this detector run standalone.
   */
  function extractButtonsFromDom() {
    const elements = GuardFlowDomUtils.queryAll(CLICKABLE_SELECTOR);
    return elements.map((el) => ({
      text: (el.textContent || el.value || "").trim(),
    }));
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectButtons = detectButtons;

  Logger.info("ButtonDetector", "buttonDetector.js loaded.");
})();
