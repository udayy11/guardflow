/**
 * GuardFlow — URL Analyzer (urlAnalyzer.js)
 * ---------------------------------------------
 * Role: Detector module. Parses the current page's URL into its
 * structural components and flags surface-level anomalies commonly
 * seen in phishing/scam URLs (raw IP addresses, punycode, excessive
 * hyphenation, suspicious TLDs, unusual length).
 *
 * This is a pattern-recognition module only. It reports structural
 * facts and boolean observations about the URL's shape — it does NOT
 * decide that any given URL is malicious, does NOT score risk, and
 * does NOT block navigation. A suspicious-looking URL can be entirely
 * legitimate (e.g. a legitimate site using a raw IP in a dev/staging
 * environment); that judgment belongs entirely to the backend's
 * risk_engine.py, weighing this alongside every other signal.
 *
 * Exposed as window.GuardFlowDetectors.detectUrlCharacteristics so it plugs into
 * pageAnalyzer.js's DETECTOR_REGISTRY like every other detector. Must
 * be loaded before pageAnalyzer.js in manifest.json's content_scripts
 * "js" array.
 *
 * Input: the page's URL (raw.url from content.js, or defaults to
 * window.location.href if not provided).
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectUrlCharacteristics) {
    Logger.info("UrlAnalyzer", "Already loaded, skipping re-init.");
    return;
  }

  // -----------------------------------------------------------------
  // Thresholds / reference lists
  // -----------------------------------------------------------------

  const LONG_URL_THRESHOLD = 100; // chars; beyond this, flagged as "unusually long"
  const EXCESSIVE_HYPHEN_THRESHOLD = 4; // hyphens in hostname beyond this is unusual

  // Not exhaustive — a known-abused-TLD watchlist commonly cited in
  // phishing research. Presence in this list is an observation only;
  // many legitimate sites use these TLDs too. Sourced from
  // GuardFlowConstants.SUSPICIOUS_TLDS (single source of truth, shared
  // with any other module needing the same watchlist).
  const SUSPICIOUS_TLDS = new Set(GuardFlowConstants.SUSPICIOUS_TLDS);

  const MULTI_LEVEL_TLDS = new Set([
    "co.in",
    "gov.in",
    "ac.in",
    "org.in",
    "net.in",
    "co.uk",
    "gov.uk"
  ]);

  const URL_SHORTENERS = new Set([
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "is.gd",
    "cutt.ly",
    "rebrand.ly",
    "ow.ly",
    "buff.ly"
]);


  const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const IPV6_PATTERN = /^\[?[0-9a-f:]+:[0-9a-f:]+\]?$/i;
  const PUNYCODE_LABEL_PATTERN = /(^|\.)xn--/i;

  /**
   * Parses and analyzes the given URL (or the current page URL).
   *
   * @param {string} [url] - URL to analyze. Defaults to window.location.href.
   * @returns {Object} {
   *   components: {
   *     protocol, hostname, domain, tld, subdomain, path,
   *     query_parameters: { [key]: value }
   *   },
   *   observations: {
   *     is_ip_address_url: boolean,
   *     is_punycode: boolean,
   *     has_excessive_hyphens: boolean,
   *     hyphen_count: number,
   *     has_suspicious_tld: boolean,
   *     is_unusually_long: boolean,
   *     url_length: number,
   * 
   *   }
   * }
   */
  function detectUrlCharacteristics(url) {
    const targetUrl = url || safeGetCurrentUrl();

    try {
      const parsed = new URL(targetUrl);
      const components = extractComponents(parsed);
      const observations = buildObservations(targetUrl,parsed, components);

      return { components, observations };
    } catch (err) {
      Logger.error("UrlAnalyzer", "Failed to parse URL", err);
      return buildEmptyResult(targetUrl);
    }
  }

  // -----------------------------------------------------------------
  // Component extraction
  // -----------------------------------------------------------------

  function extractComponents(parsed) {
    const hostname = parsed.hostname || "";
    const { domain, tld, subdomain } = splitHostname(hostname);

    return {
      protocol: parsed.protocol ? parsed.protocol.replace(":", "") : null,
      hostname,
      domain,
      tld,
      subdomain,
      path: parsed.pathname || "/",
      query_parameters: extractQueryParameters(parsed.searchParams),
    };
  }

  /**
   * Splits a hostname into subdomain / domain / TLD. Uses a simple
   * last-two-labels heuristic (domain = second-to-last label + TLD =
   * last label), which is a reasonable approximation without bundling
   * a full public-suffix-list dependency. Known limitation: this won't
   * perfectly handle multi-part TLDs like ".co.in" or ".gov.in" (it
   * would treat "in" as the TLD and "co"/"gov" as part of the domain
   * label) — acceptable for observation purposes, not a security
   * boundary in itself.
   */
  // function splitHostname(hostname) {
  //   if (!hostname) return { domain: null, tld: null, subdomain: null };

  //   // Raw IP addresses have no meaningful domain/TLD/subdomain split.
  //   if (isIpAddress(hostname)) {
  //     return { domain: hostname, tld: null, subdomain: null };
  //   }

  //   const labels = hostname.split(".");
  //   if (labels.length < 2) {
  //     return { domain: hostname, tld: null, subdomain: null };
  //   }

  //   const tld = labels[labels.length - 1];
  //   const domainLabel = labels[labels.length - 2];
  //   const domain = `${domainLabel}.${tld}`;
  //   const subdomainLabels = labels.slice(0, labels.length - 2);
  //   const subdomain = subdomainLabels.length > 0 ? subdomainLabels.join(".") : null;

  //   return { domain, tld, subdomain };
  // }

  function splitHostname(hostname) {

    if (!hostname)
        return {
            domain: null,
            tld: null,
            subdomain: null
        };

    if (isIpAddress(hostname)) {
        return {
            domain: hostname,
            tld: null,
            subdomain: null
        };
    }

    const labels = hostname.split(".");

    if (labels.length < 2) {
        return {
            domain: hostname,
            tld: null,
            subdomain: null
        };
    }

    const lastTwo = labels.slice(-2).join(".");

    if (MULTI_LEVEL_TLDS.has(lastTwo)) {

        const tld = lastTwo;

        const domainLabel = labels[labels.length - 3];

        const domain = domainLabel
            ? `${domainLabel}.${tld}`
            : tld;

        const subdomainLabels = labels.slice(0, labels.length - 3);

        const subdomain = subdomainLabels.length
            ? subdomainLabels.join(".")
            : null;

        return {
            domain,
            tld,
            subdomain
        };
    }

    const tld = labels[labels.length - 1];

    const domainLabel = labels[labels.length - 2];

    const domain = `${domainLabel}.${tld}`;

    const subdomainLabels = labels.slice(0, labels.length - 2);

    const subdomain = subdomainLabels.length
        ? subdomainLabels.join(".")
        : null;

    return {
        domain,
        tld,
        subdomain
    };
}

  function extractQueryParameters(searchParams) {
    const params = {};
    for (const [key, value] of searchParams.entries()) {
      // Cap value length to avoid bloating payload with long tokens.
      params[key] = value.length > 500 ? value.slice(0, 500) + "…[truncated]" : value;
    }
    return params;
  }

  // -----------------------------------------------------------------
  // Anomaly observations
  // -----------------------------------------------------------------

  function buildObservations(rawUrl, parsed, components) {
    const hostname = components.hostname || "";
    const hyphenCount = (hostname.match(/-/g) || []).length;

    return {

        // ---------- URL Structure ----------
        is_ip_address_url: isIpAddress(hostname),

        is_punycode: PUNYCODE_LABEL_PATTERN.test(hostname),

        has_excessive_hyphens:
            hyphenCount > EXCESSIVE_HYPHEN_THRESHOLD,

        hyphen_count: hyphenCount,

        has_suspicious_tld:
            components.tld
                ? SUSPICIOUS_TLDS.has(components.tld.toLowerCase())
                : false,

        is_unusually_long:
            rawUrl.length > LONG_URL_THRESHOLD,

        url_length: rawUrl.length,

        is_url_shortener:
            URL_SHORTENERS.has(hostname.toLowerCase()),

        // ---------- Protocol ----------
        has_https:
            components.protocol === "https",

        has_http:
            components.protocol === "http",

        // ---------- Port ----------
        contains_port:
            parsed.port !== "",

        port_number:
            parsed.port || null,

        // ---------- Query Parameters ----------
        has_query_parameters:
            Object.keys(components.query_parameters).length > 0,

        query_parameter_count:
            Object.keys(components.query_parameters).length,

        // ---------- Fragment ----------
        has_fragment:
            parsed.hash!=="",

        fragment:
            parsed.hash || null,

        // ---------- Subdomains ----------
        has_subdomain:
            !!components.subdomain,

        subdomain_depth:
            components.subdomain
                ? components.subdomain.split(".").length
                : 0,

        // ---------- Hostname Statistics ----------
        hostname_length:
            hostname.length,

        digit_count:
            (hostname.match(/\d/g) || []).length,

        letter_count:
            (hostname.match(/[a-z]/gi) || []).length,

        special_character_count:
            (hostname.match(/[^a-zA-Z0-9.-]/g) || []).length,

        // ---------- URL Characteristics ----------
        path_length:
            components.path.length,

        path_segment_count:
            components.path
                .split("/")
                .filter(Boolean)
                .length,

        // ---------- Timestamp ----------
        analyzed_at:
            new Date().toISOString()
    };
}

  function isIpAddress(hostname) {
    if (!hostname) return false;
    const stripped = hostname.replace(/^\[|\]$/g, "");
    if (IPV4_PATTERN.test(stripped)) {
      // Confirm each octet is within 0-255 to avoid false positives on
      // version-number-like strings (e.g. "999.999.999.999" isn't a
      // real IP, but the regex alone wouldn't catch that).
      const octets = stripped.split(".").map(Number);
      return octets.every((n) => n >= 0 && n <= 255);
    }
    return IPV6_PATTERN.test(stripped) && stripped.includes(":");
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  function safeGetCurrentUrl() {
    try {
      return window.location.href;
    } catch {
      return "";
    }
  }

  function buildEmptyResult(rawUrl) {
    return {
      components: {
        protocol: null,
        hostname: null,
        domain: null,
        tld: null,
        subdomain: null,
        path: null,
        query_parameters: {},
      },
      observations: {
        is_ip_address_url: false,
        is_punycode: false,
        has_excessive_hyphens: false,
        hyphen_count: 0,
        has_suspicious_tld: false,
        is_unusually_long: false,
        url_length: 0,
        is_url_shortener: false,
        has_https: false,
        has_http: false,
        contains_port: false,
        port_number: null,
        has_query_parameters: false,
        query_parameter_count: 0,
        has_fragment: false,
        fragment: null,
        has_subdomain: false,
        subdomain_depth: 0,
        hostname_length: 0,
        digit_count: 0,
        letter_count: 0,
        special_character_count: 0,
        path_length: 0,
        path_segment_count: 0,
        analyzed_at: new Date().toISOString()
    },
      error: "Failed to parse URL",
    };
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectUrlCharacteristics = detectUrlCharacteristics;

  Logger.info("UrlAnalyzer", "urlAnalyzer.js loaded.");
})();
