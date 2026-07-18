/**
 * GuardFlow — Keyword Detector (keywordDetector.js)
 * -------------------------------------------------------
 * Role: Detector module. Pure string/regex pattern matching — no AI,
 * no ML model, no external API calls. Scans the page's visible text
 * for a fixed list of scam-adjacent keywords/phrases and reports where
 * and how often each one appears.
 *
 * "Total keyword score" here means a FREQUENCY COUNT ONLY (total
 * number of keyword occurrences found) — it is NOT a risk score, has
 * no weights, and is not compared against any threshold. Whether a
 * high or low count means anything about fraud risk is decided
 * entirely by the backend's risk_engine.py, which may weigh individual
 * keywords very differently from one another. This module has no
 * opinion on that.
 *
 * Exposed as window.GuardFlowDetectors.detectScamKeywords so it plugs
 * into pageAnalyzer.js's DETECTOR_REGISTRY like every other detector.
 * Must be loaded before pageAnalyzer.js in manifest.json's
 * content_scripts "js" array.
 *
 * Input: the page's visible text (raw.visible_text_excerpt from
 * content.js / textExtractor.js).
 *
 * The canonical list of WHICH keywords to scan for now comes from
 * utils/constants.js's SCAM_KEYWORDS (single source of truth, shared
 * with any other tooling that needs the same list). The regex used to
 * *find* each keyword remains defined here, per constants.js's own
 * documentation — pattern construction (word boundaries, pluralization,
 * etc.) is detector-specific logic, not shared data.
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectScamKeywords) {
    Logger.info("KeywordDetector", "Already loaded, skipping re-init.");
    return;
  }

  // -----------------------------------------------------------------
  // Keyword regex lookup — one entry per keyword in
  // GuardFlowConstants.SCAM_KEYWORDS. Patterns use word boundaries to
  // avoid partial-word false positives (e.g. "pan" shouldn't match
  // inside "panel").
  // -----------------------------------------------------------------

  const KEYWORD_REGEX_MAP = {
    "scholarship": /\bscholarships?\b/gi,
    "registration fee": /\bregistration\s*fees?\b/gi,
    "kyc": /\bkyc\b/gi,
    "pan": /\bpan\s*(card|number)?\b/gi,
    "aadhaar": /\baadhaar|aadhar\b/gi,
    "urgent": /\burgent(ly)?\b/gi,
    "verify account": /\bverify\s*(your)?\s*account\b/gi,
    "lottery": /\blottery|lotteries\b/gi,
    "reward": /\brewards?\b/gi,
    "payment": /\bpayments?\b/gi,
    "upi": /\bupi\b/gi,
    "bank": /\bbanks?\b/gi,
    "refund": /\brefunds?\b/gi,
    "internship": /\binternships?\b/gi,
    "admission fee": /\badmission\s*fees?\b/gi,
  };

  /**
   * Builds a generic word-boundary regex for any keyword in
   * GuardFlowConstants.SCAM_KEYWORDS that doesn't have a hand-tuned
   * entry above — keeps this detector correct even if constants.js
   * gains a new keyword before this file's regex map is updated.
   */
  function buildFallbackPattern(keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    return new RegExp(`\\b${escaped}s?\\b`, "gi");
  }

  const KEYWORD_PATTERNS = GuardFlowConstants.SCAM_KEYWORDS.map((keyword) => ({
    keyword,
    pattern: KEYWORD_REGEX_MAP[keyword] || buildFallbackPattern(keyword),
  }));

  /**
   * Detects scam-adjacent keywords in the given text via plain regex
   * matching — no AI/ML involved.
   *
   * @param {string} visibleText - The page's extracted visible text.
   * @returns {Object} {
   *   matched_keywords: string[],           // distinct keywords found, in list order
   *   counts: { [keyword]: number },        // occurrence count per matched keyword
   *   positions: { [keyword]: number[] },   // character offsets of each match, per keyword
   *   total_keyword_occurences: number      // sum of all occurrence counts (frequency only, NOT a risk score)
   * }
   */
  function detectScamKeywords(visibleText) {
    try {
      const text = typeof visibleText === "string" ? visibleText : "";

      const matchedKeywords = [];
      const counts = {};
      const positions = {};
      let totalKeywordOccurences = 0;

      for (const entry of KEYWORD_PATTERNS) {
        const occurrencePositions = findOccurrencePositions(text, entry.pattern);

        if (occurrencePositions.length > 0) {
          matchedKeywords.push(entry.keyword);
          counts[entry.keyword] = occurrencePositions.length;
          positions[entry.keyword] = occurrencePositions;
          totalKeywordOccurences += occurrencePositions.length;
        }
      }

      return {
        matched_keywords: matchedKeywords,
        counts,
        positions,
        total_keyword_occurences: totalKeywordOccurences,
        keyword_count: matchedKeywords.length,
        analyzed_at: new Date().toISOString()
      };
    } catch (err) {
      Logger.error("KeywordDetector", "detectScamKeywords failed", err);
      return {
        matched_keywords: [],
        counts: {},
        positions: {},
        total_keyword_occurences: 0,
        keyword_count: 0,
      };
    }
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  /**
   * Finds every match of `pattern` in `text`, returning the character
   * offset (index) of each occurrence. Rebuilds the regex with the
   * global flag guaranteed, since exec()-based iteration requires it,
   * and uses a fresh RegExp instance each call to avoid lastIndex
   * state leaking across invocations.
   */
  function findOccurrencePositions(text, pattern) {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const globalPattern = new RegExp(pattern.source, flags);

    const offsets = [];
    let match;
    let safetyCounter = 0;
    const MAX_MATCHES = 200; // safety cap against pathological input

    while ((match = globalPattern.exec(text)) !== null) {
      offsets.push(match.index);
      safetyCounter++;

      // Guard against zero-width matches causing an infinite loop.
      if (match.index === globalPattern.lastIndex) {
        globalPattern.lastIndex++;
      }
      if (safetyCounter >= MAX_MATCHES) break;
    }

    return offsets;
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectScamKeywords = detectScamKeywords;

  Logger.info("KeywordDetector", "keywordDetector.js loaded.");
})();
