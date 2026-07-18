/**
 * GuardFlow — Countdown Detector (countdownDetector.js)
 * ---------------------------------------------------------
 * Role: Detector module. Identifies urgency-manufacturing timers on the
 * page — countdown clocks, expiry notices, limited-time-offer wording,
 * and common countdown JS widget markup.
 *
 * This is a pattern-recognition module only — it reports WHAT was
 * observed (timer text, estimated remaining value if parseable) and
 * does not decide whether that urgency is legitimate or manipulative.
 * That judgment belongs entirely to the backend's risk_engine.py.
 *
 * Exposed as window.GuardFlowDetectors.detectCountdownTimers so it
 * plugs into pageAnalyzer.js's DETECTOR_REGISTRY like every other
 * detector. Must be loaded before pageAnalyzer.js in manifest.json's
 * content_scripts "js" array.
 *
 * Input: primarily operates on the visible-text string produced by
 * content.js (raw.visible_text_excerpt), and additionally inspects the
 * live DOM for known countdown-widget markup patterns.
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectCountdownTimers) {
    Logger.info("CountdownDetector", "Already loaded, skipping re-init.");
    return;
  }

  // -----------------------------------------------------------------
  // Text patterns: explicit clock-style countdowns (HH:MM:SS / MM:SS),
  // expiry language, and limited-time-offer phrasing.
  // -----------------------------------------------------------------

  // Matches things like "23:59:59", "05:00", "2:15:09 remaining"
  const CLOCK_PATTERN = /\b(\d{1,2}:){1,2}\d{2}\b/g;

  // Matches "X days/hours/minutes/seconds left/remaining"
  const RELATIVE_TIME_PATTERN =
    /\b(\d+)\s*(day|days|hour|hours|hr|hrs|minute|minutes|min|mins|second|seconds|sec|secs)\s*(left|remaining|to go)\b/gi;

  const EXPIRY_PATTERNS = [
    /\boffer\s*expires?\b/gi,
    /\bexpires?\s*(in|on|at)?\b/gi,
    /\blast\s*date\b/gi,
    /\bdeadline\b/gi,
    /\bclosing\s*(soon|today)\b/gi,
    /\bhurry\b/gi,
    /\bact\s*now\b/gi,
  ];

  const LIMITED_TIME_PATTERNS = [
    /\blimited[-\s]*time\s*offer\b/gi,
    /\bonly\s*\d+\s*(seats?|spots?|slots?)\s*(left|remaining)\b/gi,
    /\bregistration\s*closes?\s*(soon|today|tonight)\b/gi,
    /\bfew\s*hours?\s*left\b/gi,
    /\bdon't\s*miss\s*out\b/gi,
    /\bflash\s*sale\b/gi,
  ];

  // -----------------------------------------------------------------
  // DOM patterns: markup/attribute signatures used by common countdown
  // JS widgets (e.g. jQuery countdown plugins, generic timer libraries).
  // These are structural signals — presence of a widget, not its content.
  // -----------------------------------------------------------------

  const COUNTDOWN_WIDGET_SELECTORS = [
    "[class*='countdown' i]",
    "[id*='countdown' i]",
    "[data-countdown]",
    "[data-expiry]",
    "[data-deadline]",
    "[data-timer]",
    "[class*='timer' i][class*='expir' i]",
  ];

  /**
   * Detects countdown/expiry/limited-time signals on the page.
   *
   * @param {string} visibleText - The page's extracted visible text
   *   (e.g. rawExtraction.visible_text_excerpt from content.js).
   * @returns {Object} {
   *   detected: boolean,
   *   countdown_text: string[],       // raw matched phrases/snippets
   *   estimated_remaining_seconds: number|null,  // best-effort parse
   *   widget_detected: boolean         // known countdown JS markup present
   * }
   */
  function detectCountdownTimers(visibleText) {
    let countdownText = [];
    try {
      const text = typeof visibleText === "string" ? visibleText : "";

      const clockMatches = matchAll(text, CLOCK_PATTERN);
      const relativeMatches = matchAll(text, RELATIVE_TIME_PATTERN);
      const expiryMatches = collectPatternMatches(text, EXPIRY_PATTERNS);
      const limitedTimeMatches = collectPatternMatches(text, LIMITED_TIME_PATTERNS);

      const widgetDetected = detectCountdownWidgetMarkup();

      countdownText = dedupe([
        ...clockMatches,
        ...relativeMatches,
        ...expiryMatches,
        ...limitedTimeMatches,
      ]).slice(0, 20); // cap payload size

      const estimatedRemainingSeconds = estimateRemainingSeconds(clockMatches[0], relativeMatches[0]);

      return {
        detected: countdownText.length > 0 || widgetDetected,
        countdown_text: countdownText,
        estimated_remaining_seconds: estimatedRemainingSeconds,
        widget_detected: widgetDetected,
      };
    } catch (err) {
      Logger.error("CountdownDetector", "detectCountdownTimers failed", err);
      return {
        detected: false,
        countdown_text: [],
        estimated_remaining_seconds: null,
        widget_detected: false,
        countdown_count: countdownText.length,
      };
    }
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  function matchAll(text, regex) {
    const matches = [];
    let match;
    const globalRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    while ((match = globalRegex.exec(text)) !== null) {
      matches.push(match[0].trim());
      if (matches.length >= 20) break; // safety cap
    }
    return matches;
  }

  function collectPatternMatches(text, patterns) {
    const found = [];
    for (const pattern of patterns) {
      const globalPattern = new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"
      );

      let match;

      while ((match = globalPattern.exec(text)) !== null) {
        found.push(match[0].trim());

        if (found.length >= 20) {
          return dedupe(found);
        }
      }
    }
    return dedupe(found);
  }

  /** De-duplication is delegated to the shared domUtils helper. */
  function dedupe(arr) {
    return GuardFlowDomUtils.dedupe(arr.filter(Boolean));
  }

  /**
   * Checks the live DOM for markup/attribute signatures commonly used
   * by countdown timer JS widgets. Presence-only check — does not read
   * or execute any widget logic.
   */
  function detectCountdownWidgetMarkup() {
    return GuardFlowDomUtils.queryAllMulti(COUNTDOWN_WIDGET_SELECTORS).length > 0;
  }

  /**
   * Best-effort conversion of the first matched clock-style or
   * relative-time string into total seconds. Returns null if nothing
   * parseable was found — this is a convenience estimate, not a
   * guaranteed-accurate parse (widgets render dynamically and text can
   * be mid-tick when captured).
   */
  function estimateRemainingSeconds(clockText, relativeText) {
    if (clockText) {
      const parts = clockText.split(":").map((p) => parseInt(p, 10));
      if (parts.every((n) => !Number.isNaN(n))) {
        if (parts.length === 3) {
          const [h, m, s] = parts;
          return h * 3600 + m * 60 + s;
        }
        if (parts.length === 2) {
          const [m, s] = parts;
          return m * 60 + s;
        }
      }
    }

    if (relativeText) {
      const match = relativeText.match(
        /(\d+)\s*(day|days|hour|hours|hr|hrs|minute|minutes|min|mins|second|seconds|sec|secs)/i
      );
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        if (!Number.isNaN(value)) {
          if (unit.startsWith("day")) return value * 86400;
          if (unit.startsWith("hour") || unit.startsWith("hr")) return value * 3600;
          if (unit.startsWith("min")) return value * 60;
          if (unit.startsWith("sec")) return value;
        }
      }
    }

    return null;
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectCountdownTimers = detectCountdownTimers;

  Logger.info("CountdownDetector", "countdownDetector.js loaded.");
})();
