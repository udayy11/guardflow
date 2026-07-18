/**
 * GuardFlow — Page Analyzer (pageAnalyzer.js)
 * ---------------------------------------------
 * Role: Pure aggregation layer. Sits between content.js (raw DOM
 * extraction) and detectors.js (pattern-recognition modules).
 *
 * content.js extracts raw structural pieces (text, links, forms, images,
 * metadata). pageAnalyzer.js takes those raw pieces, runs every detector
 * module against them, and merges everything into ONE final structured
 * JSON object — the complete "webpage observation" that gets sent to
 * FastAPI as PAGE_ANALYSIS.
 *
 * This file does NOT:
 *   - calculate a risk score
 *   - apply weights or thresholds
 *   - decide safe/medium/high
 *   - contain any pattern-matching logic itself (that lives in detectors.js)
 *
 * It ONLY calls detector functions and assembles their outputs alongside
 * the raw extraction into a single object (via models/pageSignals.js's
 * shape helper, rather than one large inline object literal). If a
 * detector is missing or throws, aggregation still completes — a missing
 * signal is reported as an empty finding, never as a fatal error for the
 * whole payload.
 *
 * Exposed as window.GuardFlowPageAnalyzer.analyze(rawExtraction) so
 * content.js can call it synchronously without any module bundler.
 * Must be loaded AFTER detectors.js, domUtils.js, constants.js,
 * models/pageSignals.js, and BEFORE content.js in manifest.json's
 * content_scripts "js" array.
 */

(function () {
  "use strict";

  if (window.GuardFlowPageAnalyzer) {
    Logger.info("PageAnalyzer", "Already loaded, skipping re-init.");
    return;
  }

  const DETECTOR_NAMES = GuardFlowConstants.DETECTOR_NAMES;

  /**
   * Names of every detector this analyzer knows how to call, mapped to
   * the key each one's output will be stored under in the final object,
   * and the piece of raw extraction it needs as input.
   *
   * Adding a new detector to detectors.js only requires adding one entry
   * here — pageAnalyzer.js doesn't need to know how any detector works.
   * `fn` values come from GuardFlowConstants.DETECTOR_NAMES (single
   * source of truth for detector function names) rather than being
   * repeated as inline string literals.
   */
  const DETECTOR_REGISTRY = [
    {
      key: "scam_keywords",
      fn: DETECTOR_NAMES.SCAM_KEYWORDS,
      input: (raw) => raw.visible_text_excerpt,
    },
    {
      key: "countdown_timers",
      fn: DETECTOR_NAMES.COUNTDOWN_TIMERS,
      input: (raw) => raw.visible_text_excerpt,
    },
    {
      key: "registration_fee_requests",
      fn: DETECTOR_NAMES.REGISTRATION_FEE_REQUESTS,
      input: (raw) => raw.visible_text_excerpt,
    },
    {
      key: "government_references",
      fn: DETECTOR_NAMES.GOVERNMENT_REFERENCES,
      input: (raw) => raw.visible_text_excerpt,
    },
    {
      key: "qr_candidates",
      fn: DETECTOR_NAMES.QR_CANDIDATES,
      input: (raw) => raw.images,
    },
    {
      // Previously unused (buttonDetector.js was never registered here).
      // Its total_buttons/payment_buttons output is what buildSummary()
      // below now surfaces as summary.total_buttons for the popup.
      key: "buttons",
      fn: DETECTOR_NAMES.BUTTONS,
      input: (raw) => raw.buttons,
    },
    {
      // Previously unused (formDetector.js was never registered here).
      // Distinct from the top-level `forms` structural array — this adds
      // per-field category classification (password/otp/aadhaar/pan/upi/
      // bank_account/email/phone/other) without replacing the raw list.
      key: "form_field_classification",
      fn: DETECTOR_NAMES.FORM_FIELDS,
      input: (raw) => raw.forms,
    },
    {
      // Richer payment-signal detail (upi_mentions, qr_payment_prompts,
      // payment_gateway_buttons, amount_mentions) alongside
      // registration_fee_requests above — both point at the same
      // detector function (see paymentDetector.js's naming-mismatch fix).
      key: "payment_signals",
      fn: DETECTOR_NAMES.PAYMENT_SIGNALS,
      input: (raw) => raw.visible_text_excerpt,
    },
    {
      // Previously unused (urlAnalyzer.js was never registered here).
      key: "url_analysis",
      fn: DETECTOR_NAMES.URL_ANALYSIS,
      input: (raw) => raw.url,
    },
    {
      // Previously unused (linkDetector.js was window.LinkDetector,
      // not window.GuardFlowDetectors, so it could never have been
      // registered here even if an entry had existed).
      key: "link_analysis",
      fn: DETECTOR_NAMES.LINKS,
      input: () => undefined, // detectLinks() operates on the live DOM directly
    },
    {
      // Previously unused (metadataDetector.js was window.MetadataDetector,
      // same issue as linkDetector.js above). Stored under a distinct key
      // (page_metadata) from the top-level `metadata` field so neither
      // is lost.
      key: "page_metadata",
      fn: DETECTOR_NAMES.PAGE_METADATA,
      input: () => undefined, // detectPageMetadata() operates on the live DOM directly
    },
  ];

  /**
   * Aggregates raw DOM extraction + all detector outputs into a single
   * structured observation object.
   *
   * @param {Object} rawExtraction - Output of content.js's DOM extractors.
   *   Expected shape:
   *   {
   *     url, domain, title, metadata, favicon, https,
   *     visible_text_excerpt, visible_text_truncated,
   *     links, buttons, forms, images,
   *     password_fields, iframes, hidden_elements,
   *     javascript, meta_refresh, network_requests,
   *     cookies, permissions_requested
   *   }
   * @returns {Object} Complete observation object, ready to send as
   *   PAGE_ANALYSIS. Contains no risk score or verdict of any kind.
   */
  function analyze(rawExtraction) {
    if (!rawExtraction || typeof rawExtraction !== "object") {
      Logger.error("PageAnalyzer", "analyze() called with invalid rawExtraction");
      return {
        ...PageSignals.createEmpty(),
        error: "analyze() called with invalid input",
      };
    }

    const detectorFindings = runAllDetectors(rawExtraction);
    const summary = buildSummary(rawExtraction, detectorFindings);

    return PageSignals.build(rawExtraction, detectorFindings, summary);
  }

  /**
   * Runs every registered detector against the relevant slice of raw
   * extraction, collecting results keyed by detector name. Failures in
   * one detector never block the others.
   */
  function runAllDetectors(rawExtraction) {
    const detectors = window.GuardFlowDetectors || {};
    const findings = {};

    for (const entry of DETECTOR_REGISTRY) {
      const detectorFn = detectors[entry.fn];
      const input = safeGetInput(entry.input, rawExtraction);

      findings[entry.key] = safeRunDetector(entry.fn, detectorFn, input);
    }

    return findings;
  }

  function safeGetInput(inputSelector, rawExtraction) {
    try {
      return inputSelector(rawExtraction);
    } catch (err) {
      Logger.error("PageAnalyzer", "Failed to derive detector input", err);
      return null;
    }
  }

  function safeRunDetector(name, fn, input) {
    if (typeof fn !== "function") {
      Logger.warn("PageAnalyzer", `Detector "${name}" not found on window.GuardFlowDetectors`);
      return [];
    }
    try {
      const result = input === undefined ? fn() : fn(input);
      return Array.isArray(result) ? result : (result ?? []);
    } catch (err) {
      Logger.error("PageAnalyzer", `Detector "${name}" threw`, err);
      return [];
    }
  }

  /**
   * Produces plain descriptive counts of what was observed — e.g. "3 forms,
   * 1 with a sensitive field" — as a convenience for the backend so it
   * doesn't have to re-derive counts from the full arrays. These are counts
   * of observations, not risk indicators; the backend's risk_engine.py
   * decides what any of these numbers mean.
   */
  function buildSummary(rawExtraction, detectorFindings) {
    const forms = rawExtraction.forms ?? [];
    const links = rawExtraction.links ?? [];
    const images = rawExtraction.images ?? [];

    return {
      form_count: forms.length,
      forms_with_sensitive_fields: forms.filter((f) => f.has_sensitive_fields)
        .length,
      link_count: links.length,
      external_link_count: links.filter((l) => l.is_external).length,
      image_count: images.length,
      iframe_count: rawExtraction.iframes ?? 0,
      password_field_count: rawExtraction.password_fields ?? 0,
      hidden_element_count: rawExtraction.hidden_elements ?? 0,
      script_count: rawExtraction.javascript ?? 0,

      scam_keyword_count: (detectorFindings.scam_keywords ?? []).length,
      countdown_timer_count: (detectorFindings.countdown_timers ?? []).length,
      registration_fee_mention_count: (
        detectorFindings.registration_fee_requests ?? []
      ).length,
      government_reference_count: (detectorFindings.government_references ?? [])
        .length,
      qr_candidate_count: (detectorFindings.qr_candidates ?? []).length,

      // Newly available now that buttonDetector.js/qrDetector.js are
      // wired into DETECTOR_REGISTRY above — consumed by popup.js's
      // "Buttons Detected" / "QR Detected" tiles.
      total_buttons: detectorFindings.buttons?.total_buttons ?? 0,
      qr_present: !!detectorFindings.qr_candidates?.qr_present,
    };
  }

  // -----------------------------------------------------------------
  // Public interface
  // -----------------------------------------------------------------

  window.GuardFlowPageAnalyzer = Object.freeze({
    analyze,
  });

  Logger.info("PageAnalyzer", "pageAnalyzer.js loaded.");
})();
