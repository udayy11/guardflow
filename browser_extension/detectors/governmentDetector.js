/**
 * GuardFlow — Government Reference Detector (governmentDetector.js)
 * ------------------------------------------------------------------
 * Role: Detector module. Identifies text references to Indian
 * government bodies/schemes (Government of India, National Scholarship
 * Portal, AICTE, UGC, Digital India, PM Scholarship, state government
 * schemes) and separately observes whether the page's own domain looks
 * like an official government domain.
 *
 * This module reports OBSERVATIONS ONLY:
 *   - which government references were found in the page text
 *   - what the page's domain is
 *   - whether that domain matches known official government domain
 *     patterns (.gov.in, .nic.in, specific known official hosts)
 *
 * It does NOT conclude that a mismatch means fraud, does NOT score
 * risk, and does NOT flag the page as legitimate or illegitimate. A
 * page can legitimately reference "Government of India" (e.g. a news
 * article, a college site, a private scholarship aggregator) without
 * being an official government site — that judgment is exclusively
 * the backend risk_engine.py's job, informed by many other signals.
 *
 * Exposed as window.GuardFlowDetectors.detectGovernmentReferences so
 * it plugs into pageAnalyzer.js's DETECTOR_REGISTRY like every other
 * detector. Must be loaded before pageAnalyzer.js in manifest.json's
 * content_scripts "js" array.
 *
 * Input: the page's visible text (raw.visible_text_excerpt) and the
 * current page domain (raw.domain, or derived from window.location).
 *
 * The canonical entity/scheme list and official domain suffix list now
 * come from utils/constants.js's GOVERNMENT_KEYWORDS and
 * OFFICIAL_GOVERNMENT_DOMAIN_SUFFIXES (single source of truth); the
 * matching regex per entity remains defined here.
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectGovernmentReferences) {
    Logger.info("GovernmentDetector", "Already loaded, skipping re-init.");
    return;
  }

  // -----------------------------------------------------------------
  // Reference patterns — keyed by the entity/scheme names in
  // GuardFlowConstants.GOVERNMENT_KEYWORDS.
  // -----------------------------------------------------------------

  const REFERENCE_REGEX_MAP = {
    "Government of India": /\bgovernment\s*of\s*india\b|\bgovt\.?\s*of\s*india\b/i,
    "National Scholarship Portal": /\bnational\s*scholarship\s*portal\b|\bnsp\.gov\.in\b/i,
    "AICTE": /\baicte\b|\ball\s*india\s*council\s*for\s*technical\s*education\b/i,
    "UGC": /\bugc\b|\buniversity\s*grants\s*commission\b/i,
    "Digital India": /\bdigital\s*india\b/i,
    "PM Scholarship": /\bpm\s*scholarship\b|\bprime\s*minister'?s?\s*scholarship\b|\bpmss\b/i,
    "State Government Scheme":
      /\bstate\s*government\s*scheme\b|\b(state|govt\.?)\s*sponsored\s*scholarship\b|\b(maharashtra|gujarat|rajasthan|karnataka|tamil\s*nadu|uttar\s*pradesh|bihar|west\s*bengal|kerala|punjab|haryana|madhya\s*pradesh)\s*government\b/i,
  };

  const REFERENCE_PATTERNS = GuardFlowConstants.GOVERNMENT_KEYWORDS
    .filter((entity) => REFERENCE_REGEX_MAP[entity])
    .map((entity) => ({ entity, pattern: REFERENCE_REGEX_MAP[entity] }));

  // -----------------------------------------------------------------
  // Official domain patterns — derived from
  // GuardFlowConstants.OFFICIAL_GOVERNMENT_DOMAIN_SUFFIXES (e.g.
  // ".gov.in", ".nic.in"). Used only to OBSERVE whether the current
  // domain matches known official government domain conventions. This
  // is not an exhaustive whitelist and absence of a match is not itself
  // a finding of illegitimacy — many legitimate education/aggregator
  // sites reference government schemes without being government domains.
  // -----------------------------------------------------------------

  const OFFICIAL_DOMAIN_PATTERNS = GuardFlowConstants.OFFICIAL_GOVERNMENT_DOMAIN_SUFFIXES.map(
    (suffix) => new RegExp(suffix.replace(/\./g, "\\.") + "$", "i")
  );

  /**
   * Detects government references in page text and observes the
   * relationship between those references and the page's own domain.
   *
   * @param {string} visibleText - The page's extracted visible text.
   * @param {string} [domain] - The page's domain. If omitted, derived
   *   from window.location.hostname.
   * @returns {Array<Object>} One entry per matched entity/scheme:
   *   {
   *     entity: string,
   *     matched_text: string,
   *     domain: string,
   *     domain_matches_official_pattern: boolean
   *   }
   */
  function detectGovernmentReferences(visibleText, domain) {
    try {
      const text = typeof visibleText === "string" ? visibleText : "";
      const currentDomain = domain || safeGetCurrentDomain();

      const domainMatchesOfficialPattern = isOfficialLookingDomain(currentDomain);

      const findings = [];
      for (const ref of REFERENCE_PATTERNS) {
        const match = text.match(ref.pattern);
        if (match) {
          findings.push({
            entity: ref.entity,
            matched_text: match[0].trim(),
            domain: currentDomain,
            domain_matches_official_pattern: domainMatchesOfficialPattern,
          });
        }
      }

      return findings;
    } catch (err) {
      Logger.error("GovernmentDetector", "detectGovernmentReferences failed", err);
      return [];
    }
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  function safeGetCurrentDomain() {
    try {
      return window.location.hostname || "";
    } catch {
      return "";
    }
  }

  /**
   * Checks whether the given domain matches a known official
   * government domain convention. Observation only — a false result
   * does not imply the page is fraudulent, only that its domain isn't
   * of the .gov.in/.nic.in form.
   */
  function isOfficialLookingDomain(domain) {
    if (!domain) return false;
    return OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain));
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectGovernmentReferences = detectGovernmentReferences;

  Logger.info("GovernmentDetector", "governmentDetector.js loaded.");
})();
