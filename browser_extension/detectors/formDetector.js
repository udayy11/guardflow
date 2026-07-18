/**
 * GuardFlow — Form Detector (formDetector.js)
 * -----------------------------------------------
 * Role: Detector module. Classifies form fields by TYPE ONLY —
 * phone, email, password, PAN, Aadhaar, OTP, UPI, bank account, etc.
 *
 * This is a pattern-recognition module, same tier as detectors.js's
 * other detectors: it identifies WHAT KIND of field something is by
 * inspecting field metadata (type/name/id/placeholder/autocomplete/
 * maxlength/pattern attributes). It never reads what the user typed
 * into any field, and it never assigns a risk score — that judgment
 * belongs entirely to the backend's risk_engine.py.
 *
 * Exposed as window.GuardFlowDetectors.detectFormFields so it plugs
 * into pageAnalyzer.js's DETECTOR_REGISTRY like every other detector.
 * Must be loaded before pageAnalyzer.js in manifest.json's
 * content_scripts "js" array.
 *
 * Input: operates directly on the live document (queries <form>
 * elements itself), OR can be called with a pre-extracted forms array
 * from content.js — see detectFormFields() below for both entry points.
 *
 * Privacy contract:
 *   - NEVER reads .value from any field, of any type, ever.
 *   - NEVER logs, stores, or transmits user-entered content.
 *   - Only inspects static DOM attributes (type, name, id, placeholder,
 *     autocomplete, maxlength, pattern, inputmode).
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectFormFields) {
    Logger.info("FormDetector", "Already loaded, skipping re-init.");
    return;
  }

  // -----------------------------------------------------------------
  // Classification rules
  // -----------------------------------------------------------------
  // Each field category is defined by a set of heuristics evaluated
  // against attribute metadata only. Order matters: more specific
  // categories (PAN, Aadhaar, OTP, UPI) are checked before generic
  // ones (email, phone) so a field named "aadhaar_otp" classifies as
  // OTP-related to Aadhaar verification, not a bare phone/text field.

  const FIELD_CATEGORIES = [
    {
      category: "password",
      test: (f) => f.type === "password",
    },
    {
      category: "otp",
      test: (f) =>
        /\botp\b|one[-_ ]?time[-_ ]?(pass|code)|verification[-_ ]?code/.test(f.combinedText) ||
        (f.maxLength && f.maxLength <= 6 && /code|otp/.test(f.combinedText)),
    },
    {
      category: "aadhaar",
      test: (f) =>
        /aadhaar|aadhar|uidai/.test(f.combinedText) ||
        (f.pattern && /\d{4}.?\d{4}.?\d{4}/.test(f.pattern)),
    },
    {
      category: "pan",
      test: (f) =>
        /\bpan\b|pan[-_ ]?card|pan[-_ ]?number/.test(f.combinedText) ||
        (f.pattern && /[A-Z]{5}[0-9]{4}[A-Z]/i.test(f.pattern)),
    },
    {
      category: "upi",
      test: (f) =>
        /\bupi\b|vpa|@(ok|ybl|paytm|apl|ibl)|upi[-_ ]?id/.test(f.combinedText),
    },
    {
      category: "bank_account",
      test: (f) =>
        /account[-_ ]?number|acc[-_ ]?no|ifsc|bank[-_ ]?account|routing[-_ ]?number/.test(f.combinedText),
    },
    {
      category: "email",
      test: (f) => f.type === "email" || /\bemail\b|e-?mail/.test(f.combinedText),
    },
    {
      category: "phone",
      test: (f) =>
        f.type === "tel" ||
        /\bphone\b|mobile|contact[-_ ]?number|whatsapp/.test(f.combinedText),
    },
  ];

  const DEFAULT_CATEGORY = "other";

  // -----------------------------------------------------------------
  // Public entry point
  // -----------------------------------------------------------------

  /**
   * Detects and classifies form fields on the page.
   *
   * @param {Array|undefined} preExtractedForms - Optional forms array
   *   already produced by content.js's extractForms(). If omitted,
   *   this function queries the live DOM directly so it can also run
   *   standalone.
   * @returns {Array<Object>} One entry per <form>, each containing
   *   classified field metadata. Structure only — no values.
   */
  function detectFormFields(preExtractedForms) {
    try {
      const formElements = GuardFlowDomUtils.queryAll("form");

      // If content.js already extracted forms, use that structural data
      // as the base and enrich it with categories. Otherwise build from
      // the live DOM directly (standalone-use fallback).
      if (Array.isArray(preExtractedForms) && preExtractedForms.length === formElements.length) {
        return formElements.map((formEl, idx) =>
          classifyForm(formEl, preExtractedForms[idx])
        );
      }

      return formElements.map((formEl) => classifyForm(formEl));
    } catch (err) {
      Logger.error("FormDetector", "detectFormFields failed", err);
      return {
        forms : [],
        status : "ERROR"
      };
    }
  }

  /**
   * Builds the classified representation of a single form.
   * @param {HTMLFormElement} formEl
   * @param {Object} [baseForm] - Optional pre-extracted structural data to enrich.
   */
  function classifyForm(formEl, baseForm) {
    const fieldElements = GuardFlowDomUtils.queryAll("input, textarea, select", formEl);

    const classifiedFields = fieldElements.map((fieldEl) => classifyField(fieldEl));

    const categoryCounts = classifiedFields.reduce((acc, field) => {
      acc[field.category] = (acc[field.category] || 0) + 1;
      return acc;
    }, {});

    return {
      ...(baseForm||{}),
      form_index : baseForm?.form_index ?? null,
      action: formEl.getAttribute("action") || null,
      has_action : !!formEl.getAttribute("action"),
      method: (formEl.getAttribute("method") || "get").toLowerCase(),
      field_count: classifiedFields.length,
      sensitive_field_count : classifiedFields.filter((f)=>[
        "password", "otp", "aadhaar", "pan", "upi", "bank_account"
      ].includes(f.category)).length,
      fields: classifiedFields,
      category_counts: categoryCounts,
      has_sensitive_fields: classifiedFields.some((f) =>
        ["password", "otp", "aadhaar", "pan", "upi", "bank_account"].includes(f.category)
      ),
      analyzed_at : new Date().toISOString()
    };
  }

  /**
   * Classifies a single field by inspecting attribute metadata ONLY.
   * Deliberately never touches `.value`.
   * @param {HTMLElement} fieldEl
   * @returns {Object} Structural, value-free field descriptor.
   */
  function classifyField(fieldEl) {
    const type = (fieldEl.getAttribute("type") || fieldEl.tagName.toLowerCase()).toLowerCase();
    const name = fieldEl.getAttribute("name") || "";
    const id = fieldEl.getAttribute("id") || "";
    const placeholder = fieldEl.getAttribute("placeholder") || "";
    const autocomplete = fieldEl.getAttribute("autocomplete") || "";
    const inputmode = fieldEl.getAttribute("inputmode") || "";
    const pattern = fieldEl.getAttribute("pattern") || "";
    const maxLength = fieldEl.maxLength && fieldEl.maxLength > 0 ? fieldEl.maxLength : null;

    // Combine all textual metadata into one lowercase string for regex
    // matching — this is attribute text, never field content.
    const combinedText = [name, id, placeholder, autocomplete, inputmode]
      .join(" ")
      .toLowerCase();

    const fieldContext = { type, combinedText, pattern, maxLength };

    const matchedRule = FIELD_CATEGORIES.find((rule) => {
      try {
        return rule.test(fieldContext);
      } catch {
        return false;
      }
    });

    return {
      category: matchedRule ? matchedRule.category : DEFAULT_CATEGORY,
      type,
      name: name || null,
      placeholder: placeholder || null,
      required: !!fieldEl.required,
      max_length: maxLength,
      id : id || null,
      autocomplete : autocomplete || null,
      inputmode : autocomplete || null,
      pattern : pattern || null
      // Deliberately no `value` field — never read, never included.
    };
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectFormFields = detectFormFields;

  Logger.info("FormDetector", "formDetector.js loaded.");
})();
