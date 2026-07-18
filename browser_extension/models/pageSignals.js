/**
 * pageSignals.js
 * Defines the standardized "page signals" schema used by pageAnalyzer.js
 * to assemble the final PAGE_ANALYSIS observation object. Every raw DOM
 * extraction + detector output gets normalized into this shape before
 * being sent to background.js, the popup, or the backend — so consumers
 * never have to know the internals of each individual detector.
 *
 * IMPORTANT: this schema intentionally mirrors the actual, existing
 * PAGE_ANALYSIS wire contract already produced by content.js/
 * pageAnalyzer.js and consumed by the FastAPI backend (url, domain,
 * title, metadata, https, links, buttons, forms, images, summary,
 * detector_findings, ...) rather than inventing a different shape.
 * Changing that wire shape is explicitly out of scope for this refactor
 * — this file exists so pageAnalyzer.js can build that same object via a
 * shared, reusable shape helper instead of one large inline object
 * literal, not to redefine what gets sent over the wire.
 *
 * Exposes: globalThis.PageSignals = { createEmpty, build, validate }
 */

(function () {
  if (globalThis.PageSignals) {
    console.log("[GuardFlow:PageSignals] Already loaded, skipping re-init.");
    return;
  }

  /**
   * Returns a fresh, empty signals object matching the schema. Used as
   * pageAnalyzer.js's fallback when analyze() is called with invalid
   * input.
   */
  function createEmpty() {
    return {
      url: null,
      domain: null,
      title: "",
      metadata: {},
      favicon: null,
      https: false,

      visible_text_excerpt: "",
      text: "",
      visible_text_truncated: false,

      links: [],
      buttons: [],
      forms: [],
      images: [],

      password_fields: 0,
      iframes: 0,
      hidden_elements: 0,
      javascript: 0,
      meta_refresh: false,
      network_requests: [],
      cookies: [],
      permissions_requested: [],

      summary: {
        form_count: 0,
        forms_with_sensitive_fields: 0,
        link_count: 0,
        external_link_count: 0,
        image_count: 0,
        iframe_count: 0,
        password_field_count: 0,
        hidden_element_count: 0,
        script_count: 0,
        scam_keyword_count: 0,
        countdown_timer_count: 0,
        registration_fee_mention_count: 0,
        government_reference_count: 0,
        qr_candidate_count: 0,
        total_buttons: 0,
        qr_present: false,
      },

      detector_findings: {},

      analyzed_at: new Date().toISOString(),
    };
  }

  /**
   * Builds the normalized signals object from a raw DOM extraction
   * (content.js's output) plus the detector findings pageAnalyzer.js
   * has already run. This is the exact object pageAnalyzer.js's
   * analyze() returns — extracted here so it's built via one shared,
   * testable shape helper instead of an inline literal.
   *
   * @param {Object} rawExtraction - content.js's raw extraction object.
   * @param {Object} detectorFindings - keyed detector outputs (see
   *   pageAnalyzer.js's DETECTOR_REGISTRY).
   * @param {Object} summary - pre-computed summary counts (pageAnalyzer.js's
   *   buildSummary()).
   * @returns {Object}
   */
  function build(rawExtraction, detectorFindings, summary) {
    const raw = rawExtraction || {};
    const findings = detectorFindings || {};

    return {
      // --- Structural observations, passed through unchanged from content.js ---
      url: raw.url ?? null,
      domain: raw.domain ?? null,
      title: raw.title ?? "",
      metadata: raw.metadata ?? {},
      favicon: raw.metadata?.favicon || null,
      https: !!raw.https,

      visible_text_excerpt: raw.visible_text_excerpt ?? "",
      text: raw.visible_text_excerpt ?? "",
      visible_text_truncated: !!raw.visible_text_truncated,

      links: raw.links ?? [],
      buttons: raw.buttons ?? [],
      forms: raw.forms ?? [],
      images: raw.images ?? [],

      password_fields: raw.password_fields ?? 0,
      iframes: raw.iframes ?? 0,
      hidden_elements: raw.hidden_elements ?? 0,
      javascript: raw.javascript ?? 0,
      meta_refresh: !!raw.meta_refresh,
      network_requests: raw.network_requests ?? [],
      cookies: raw.cookies ?? [],
      permissions_requested: raw.permissions_requested ?? [],

      // --- Aggregated summary counts (pure counting, not scoring) ---
      summary: summary ?? {},

      // --- Detector findings (descriptive, not evaluative) ---
      detector_findings: findings,

      analyzed_at: new Date().toISOString(),
    };
  }

  /**
   * Checks that an object at least has the top-level keys the real
   * PAGE_ANALYSIS contract expects. Not a strict schema validator —
   * just a quick shape sanity check, useful before sending/storing.
   */
  function validate(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const requiredKeys = [
      'url', 'domain', 'title', 'metadata', 'links',
      'buttons', 'forms', 'images', 'summary', 'detector_findings'
    ];
    return requiredKeys.every(key => Object.prototype.hasOwnProperty.call(obj, key));
  }

  globalThis.PageSignals = { createEmpty, build, validate };

  (globalThis.Logger?.info || console.log)("PageSignals", "pageSignals.js loaded.");
})();
