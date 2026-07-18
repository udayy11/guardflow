/**
 * GuardFlow — Content Script (content.js)
 * -----------------------------------------
 * Role: Runs automatically on every webpage (per manifest.json's
 * content_scripts declaration). Its ONLY job is to read the DOM and
 * produce a structured, privacy-safe JSON snapshot of the page.
 *
 * This file contains NO business logic and NO risk scoring:
 *   - It does not decide if a page is a scam.
 *   - It does not weigh, score, or threshold anything.
 *   - It only extracts raw structural observations and calls out to
 *     detector modules (detectors.js) for pattern-recognition tasks
 *     (e.g. "does this text contain scam-style keywords?"). Detector
 *     modules return descriptive findings, not verdicts.
 *
 * Privacy contract (enforced here, not just documented):
 *   - Never reads input/textarea VALUES the user typed (only field
 *     metadata: type, name, placeholder, required).
 *   - Never captures passwords or OTP-shaped fields' contents.
 *   - Never serializes raw HTML — only derived, structured fields.
 *
 * Communication:
 *   Listens for a single message type from background.js:
 *     { type: "EXTRACT_SIGNALS", session_id }
 *   Responds with:
 *     { type: "SIGNALS_RESULT", session_id, signals: {...} }
 *
 * Detector modules (detectors.js) must be loaded before this script
 * (declared earlier in manifest.json's content_scripts "js" array) and
 * expose their functions on `window.GuardFlowDetectors`.
 */

(function () {
  "use strict";

  // -----------------------------------------------------------------
  // Guard against double-injection (this script may be injected both
  // automatically via content_scripts AND on-demand via chrome.scripting
  // from background.js's ensureContentScriptInjected()).
  // -----------------------------------------------------------------

  if (window.__guardflowContentScriptLoaded) {
    Logger.info("Content", "Already loaded, skipping re-init.");
    return;
  }
  window.__guardflowContentScriptLoaded = true;

  const MAX_VISIBLE_TEXT_LENGTH = 5000; // cap payload size, avoid huge pages
  const MAX_ITEMS_PER_LIST = 100; // cap links/buttons/images arrays

  // -----------------------------------------------------------------
  // Field types considered sensitive — metadata only, values never read.
  // -----------------------------------------------------------------

  const SENSITIVE_FIELD_TYPES = new Set(["password"]);
  const SENSITIVE_NAME_HINTS = [
    "otp",
    "password",
    "pin",
    "cvv",
    "ssn",
    "aadhaar",
  ];

  // -----------------------------------------------------------------
  // Top-level extraction orchestrator
  // -----------------------------------------------------------------

  /**
   * Builds the full structured signals object for the current page.
   * Pure extraction/orchestration — delegates all pattern-matching
   * ("is this a scam keyword", "does this look like a QR code", etc.)
   * to window.GuardFlowDetectors.
   */
  async function extractPageSignals() {
    const textResult =
      window.GuardFlowTextExtractor?.extractVisibleText?.() || {
        text: "",
        truncated: false,
      };
    const visibleText = textResult.text || "";

    const rawExtraction = {
      url: window.location.href,
      domain: window.location.hostname,
      title: document.title || "",
      metadata: extractMetadata(),
      https: window.location.protocol === "https:",
      forms: extractForms(),
      buttons: extractButtons(),
      images: extractImages(),
      links: extractLinks(),
      visible_text_excerpt: visibleText.slice(0, MAX_VISIBLE_TEXT_LENGTH),
      visible_text_truncated: !!textResult.truncated,
      password_fields: extractPasswordFieldCount(),
      iframes: extractIframeCount(),
      hidden_elements: extractHiddenElementCount(),
      javascript: extractScriptCount(),
      meta_refresh: extractMetaRefresh(),
      network_requests: extractNetworkRequests(),
      cookies: extractCookies(),
      permissions_requested: await extractPermissionsRequested(),
    };

    if (
      window.GuardFlowPageAnalyzer &&
      typeof window.GuardFlowPageAnalyzer.analyze === "function"
    ) {
      return window.GuardFlowPageAnalyzer.analyze(rawExtraction);
    }

    const detectors = window.GuardFlowDetectors || {};
    const DETECTOR_NAMES = GuardFlowConstants.DETECTOR_NAMES;

    return {
      ...rawExtraction,
      qr_candidates: safeDetectorCall(
        detectors[DETECTOR_NAMES.QR_CANDIDATES],
        rawExtraction.images,
      ),
      countdown_timers: safeDetectorCall(
        detectors[DETECTOR_NAMES.COUNTDOWN_TIMERS],
        visibleText,
      ),
      scam_keywords: safeDetectorCall(
        detectors[DETECTOR_NAMES.SCAM_KEYWORDS],
        visibleText,
      ),
      registration_fee_requests: safeDetectorCall(
        detectors[DETECTOR_NAMES.REGISTRATION_FEE_REQUESTS],
        visibleText,
      ),
      government_references: safeDetectorCall(
        detectors[DETECTOR_NAMES.GOVERNMENT_REFERENCES],
        visibleText,
      ),
      extracted_at: new Date().toISOString(),
    };
  }

  /**
   * Calls a detector function defensively — if a detector module is
   * missing or throws, extraction still completes and returns an
   * empty result rather than failing the whole payload.
   */
  function safeDetectorCall(fn, input) {
    if (typeof fn !== "function") {
      Logger.warn("Content", "Detector function missing, skipping.");
      return [];
    }
    try {
      return fn(input) ?? [];
    } catch (err) {
      Logger.error("Content", "Detector threw", err);
      return [];
    }
  }

  // -----------------------------------------------------------------
  // Individual extractors
  // -----------------------------------------------------------------

  /** Page-level metadata: description, OG tags, charset, language. */
  function extractMetadata() {
    const getMeta = (name) =>
      GuardFlowDomUtils.queryOne(`meta[name="${name}"]`)?.getAttribute("content") ??
      GuardFlowDomUtils.queryOne(`meta[property="${name}"]`)?.getAttribute("content") ??
      null;

    return {
      description: getMeta("description"),
      og_title: getMeta("og:title"),
      og_site_name: getMeta("og:site_name"),
      language: document.documentElement.lang || null,
      charset: document.characterSet || null,
      favicon: extractFavicon(),
    };
  }

  /** Extracts outbound/inbound links with basic structural metadata. */
  function extractLinks() {
    const anchors = GuardFlowDomUtils.queryAll("a[href]").slice(
      0,
      MAX_ITEMS_PER_LIST,
    );
    return anchors.map((a) => ({
      text: (a.textContent || "").trim().slice(0, 200),
      href: a.href,
      is_external: safeIsExternal(a.href),
      opens_new_tab: a.target === "_blank",
    }));
  }

  function safeIsExternal(href) {
    try {
      const linkUrl = new URL(href, window.location.href);
      return linkUrl.hostname !== window.location.hostname;
    } catch {
      return false;
    }
  }

  /** Extracts clickable buttons (both <button> and role="button"/input[type=submit]). */
  function extractButtons() {
    const selector =
      'button, [role="button"], input[type="submit"], input[type="button"]';
    const elements = GuardFlowDomUtils.queryAll(selector).slice(
      0,
      MAX_ITEMS_PER_LIST,
    );
    return elements.map((el) => ({
      text: (el.textContent || el.value || "").trim().slice(0, 200),
      type: el.tagName.toLowerCase(),
      disabled: !!el.disabled,
    }));
  }

  /**
   * Extracts form structure and field metadata ONLY — never field values.
   * Flags sensitive field types so downstream systems know a password/OTP
   * field exists without ever seeing what's typed into it.
   */
  function extractForms() {
    const forms = GuardFlowDomUtils.queryAll("form");
    return forms.map((form) => {
      const fields = GuardFlowDomUtils.queryAll("input, textarea, select", form).map((field) => {
        const type = (
          field.getAttribute("type") || field.tagName.toLowerCase()
        ).toLowerCase();
        const name = (field.getAttribute("name") || "").toLowerCase();

        const isSensitive =
          SENSITIVE_FIELD_TYPES.has(type) ||
          SENSITIVE_NAME_HINTS.some((hint) => name.includes(hint));

        return {
          type,
          name: field.getAttribute("name") || null,
          placeholder: field.getAttribute("placeholder") || null,
          required: !!field.required,
          is_sensitive: isSensitive,
          // Deliberately no `value` field — never captured.
        };
      });

      return {
        action: form.getAttribute("action") || null,
        method: (form.getAttribute("method") || "get").toLowerCase(),
        field_count: fields.length,
        fields,
        has_sensitive_fields: fields.some((f) => f.is_sensitive),
      };
    });
  }

  /** Extracts image references — src, alt, dimensions — for detector use (e.g. QR heuristics). */
  function extractImages() {
    const images = GuardFlowDomUtils.queryAll("img").slice(
      0,
      MAX_ITEMS_PER_LIST,
    );
    return images.map((img) => ({
      src: img.src || null,
      alt: img.alt || null,
      width: img.naturalWidth || img.width || null,
      height: img.naturalHeight || img.height || null,
    }));
  }

  function extractFavicon() {
    const iconSelectors = [
      "link[rel='icon']",
      "link[rel='shortcut icon']",
      "link[rel='apple-touch-icon']",
      "link[rel='apple-touch-icon-precomposed']",
    ];
    for (const selector of iconSelectors) {
      const el = GuardFlowDomUtils.queryOne(selector);
      if (el && el.getAttribute("href")) {
        try {
          return new URL(el.getAttribute("href"), window.location.href).href;
        } catch {
          continue;
        }
      }
    }
    try {
      return new URL("/favicon.ico", window.location.href).href;
    } catch {
      return null;
    }
  }

  function extractPasswordFieldCount() {
    return GuardFlowDomUtils.queryAll("input[type='password']").length;
  }

  function extractIframeCount() {
    return GuardFlowDomUtils.queryAll("iframe").length;
  }

  function extractHiddenElementCount() {
    const allElements = GuardFlowDomUtils.queryAll("*").slice(
      0,
      2000,
    );
    let count = 0;
    for (const element of allElements) {
      if (isHiddenElement(element)) {
        count += 1;
      }
    }
    return count;
  }

  function extractScriptCount() {
    return GuardFlowDomUtils.queryAll("script").length;
  }

  function extractMetaRefresh() {
    return !!GuardFlowDomUtils.queryOne(
      "meta[http-equiv='refresh'], meta[http-equiv='Refresh']",
    );
  }

  function extractNetworkRequests() {
    try {
      const resources = performance.getEntriesByType("resource") || [];
      return resources.slice(0, MAX_ITEMS_PER_LIST).map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize,
        duration: entry.duration,
      }));
    } catch (err) {
      Logger.error("Content", "extractNetworkRequests failed", err);
      return [];
    }
  }

  function extractCookies() {
    try {
      const cookieString = document.cookie || "";
      if (!cookieString) return [];
      return cookieString.split(";").map((cookie) => {
        const [rawName] = cookie.split("=");
        return { name: rawName.trim() };
      });
    } catch (err) {
      Logger.error("Content", "extractCookies failed", err);
      return [];
    }
  }

  async function extractPermissionsRequested() {
    if (!navigator.permissions || !navigator.permissions.query) {
      return [];
    }

    const permissionNames = [
      "geolocation",
      "notifications",
      "camera",
      "microphone",
      "clipboard-read",
      "clipboard-write",
      "persistent-storage",
      "push",
      "background-sync",
    ];

    const results = [];
    for (const name of permissionNames) {
      try {
        const status = await navigator.permissions.query({ name });
        results.push({ name, state: status.state });
      } catch {
        // Some permission names are unsupported in some browsers.
      }
    }
    return results;
  }

  function isHiddenElement(element) {
    if (element.hasAttribute("hidden")) return true;
    if (element.getAttribute("aria-hidden") === "true") return true;

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return true;
    }

    if (
      style.overflow === "hidden" &&
      (element.offsetWidth <= 1 || element.offsetHeight <= 1) &&
      element.textContent.trim().length > 0
    ) {
      return true;
    }

    return false;
  }

  // -----------------------------------------------------------------
  // Message handling — respond to background.js's EXTRACT_SIGNALS request
  // -----------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== GuardFlowConstants.MESSAGE_TYPES.EXTRACT_SIGNALS) {
      return false; // not for us; let other listeners handle it
    }

    (async () => {
      try {
        const signals = await extractPageSignals();
        sendResponse({
          type: GuardFlowConstants.MESSAGE_TYPES.SIGNALS_RESULT,
          session_id: message.session_id,
          signals,
        });
      } catch (err) {
        Logger.error("Content", "Extraction failed", err);
        sendResponse({
          type: GuardFlowConstants.MESSAGE_TYPES.SIGNALS_RESULT,
          session_id: message.session_id,
          signals: null,
          error: String(err?.message ?? err),
        });
      }
    })();

    return true; // indicates async response
  });

  Logger.info("Content", "content.js loaded and listening on " + window.location.href);
})();
