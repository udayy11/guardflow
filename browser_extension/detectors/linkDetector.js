/**
 * GuardFlow — Link Detector (linkDetector.js)
 * ---------------------------------------------
 * Role: Detector module. Scans all hyperlinks on the current page and
 * classifies them for suspicious/scam-detection purposes: external
 * links, shortened URLs, suspicious-looking domains (IP hosts,
 * punycode, excessive subdomains/hyphenation), download links, and
 * text/href mismatches (a common phishing trick).
 *
 * NORMALIZATION: previously exposed as window.LinkDetector.analyze() —
 * a naming convention inconsistent with every other detector module in
 * this codebase. Now exposed as
 * window.GuardFlowDetectors.detectLinks so it plugs into
 * pageAnalyzer.js's DETECTOR_REGISTRY like every other detector. Must
 * be loaded before pageAnalyzer.js in manifest.json's content_scripts
 * "js" array.
 *
 * NOTE: this module computes its own `riskScore` (result.summary.riskScore),
 * unlike every other detector in this codebase (which report descriptive
 * findings only and leave scoring entirely to the backend's
 * risk_engine.py). That pre-existing behavior is left intact here since
 * removing it would be a functional change beyond this refactor's scope
 * — flagged here for visibility rather than silently kept or silently
 * removed.
 *
 * Input: operates directly on the live document (optionally scoped to
 * a root element).
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectLinks) {
    Logger.info("LinkDetector", "Already loaded, skipping re-init.");
    return;
  }

  const SHORTENER_DOMAINS = [
    'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd',
    'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorte.st', 'adf.ly',
    'tiny.cc', 'lnkd.in', 'rb.gy', 'shorturl.at', 'bl.ink', 'v.gd'
  ];

  const DOWNLOAD_EXTENSIONS = [
    '.exe', '.msi', '.apk', '.dmg', '.pkg', '.bat', '.cmd', '.sh',
    '.jar', '.zip', '.rar', '.7z', '.scr', '.vbs', '.ps1', '.deb', '.rpm'
  ];

  // Heuristics indicating a suspicious domain: IP-based hosts, punycode/xn--,
  // excessive subdomains, hyphen-stuffed lookalikes, or mismatched display text.
  function isIpAddress(hostname) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  }

  function isPunycode(hostname) {
    return hostname.split('.').some(part => part.startsWith('xn--'));
  }

  function hasExcessiveSubdomains(hostname) {
    return hostname.split('.').length > 4;
  }

  function hasSuspiciousHyphenation(hostname) {
    const hyphenCount = (hostname.match(/-/g) || []).length;
    return hyphenCount >= 3;
  }

  function isShortenedUrl(hostname) {
    return SHORTENER_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  }

  function isDownloadLink(href) {
    try {
      const pathname = new URL(href, window.location.href).pathname.toLowerCase();
      return DOWNLOAD_EXTENSIONS.some(ext => pathname.endsWith(ext));
    } catch (e) {
      return false;
    }
  }

  function isExternal(url, pageHostname) {
    return url.hostname !== pageHostname;
  }

  // Detects when the visible link text looks like a URL/domain that differs
  // from the actual href target — a common phishing trick.
  function isTextHrefMismatch(anchor, actualUrl) {
    const text = (anchor.textContent || '').trim();
    const urlLikePattern = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})/i;
    const match = text.match(urlLikePattern);
    if (!match) return false;
    const displayedDomain = match[1].toLowerCase();
    return displayedDomain !== actualUrl.hostname.toLowerCase();
  }

  function detectLinks(root) {
    try {
      const scope = root || document;
      const anchors = GuardFlowDomUtils.queryAll('a[href]', scope);
      const pageHostname = window.location.hostname;

      const result = {
        totalLinks: anchors.length,
        externalLinks: [],
        shortenedUrls: [],
        suspiciousDomains: [],
        downloadLinks: [],
        textHrefMismatches: [],
        summary: {}
      };

      anchors.forEach(anchor => {
        const rawHref = anchor.getAttribute('href');
        if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) {
          return;
        }

        let url;
        try {
          url = new URL(rawHref, window.location.href);
        } catch (e) {
          return;
        }

        const hostname = url.hostname;
        const entry = { href: url.href, hostname, text: (anchor.textContent || '').trim().slice(0, 120) };

        if (isExternal(url, pageHostname)) {
          result.externalLinks.push(entry);
        }

        if (isShortenedUrl(hostname)) {
          result.shortenedUrls.push(entry);
        }

        const suspiciousReasons = [];
        if (isIpAddress(hostname)) suspiciousReasons.push('ip-address-host');
        if (isPunycode(hostname)) suspiciousReasons.push('punycode-domain');
        if (hasExcessiveSubdomains(hostname)) suspiciousReasons.push('excessive-subdomains');
        if (hasSuspiciousHyphenation(hostname)) suspiciousReasons.push('suspicious-hyphenation');

        if (suspiciousReasons.length > 0) {
          result.suspiciousDomains.push({ ...entry, reasons: suspiciousReasons });
        }

        if (isDownloadLink(url.href)) {
          result.downloadLinks.push(entry);
        }

        if (isTextHrefMismatch(anchor, url)) {
          result.textHrefMismatches.push(entry);
        }
      });

      result.summary = {
        totalLinks: result.totalLinks,
        externalLinkCount: result.externalLinks.length,
        shortenedUrlCount: result.shortenedUrls.length,
        suspiciousDomainCount: result.suspiciousDomains.length,
        downloadLinkCount: result.downloadLinks.length,
        textHrefMismatchCount: result.textHrefMismatches.length,
        riskScore: computeRiskScore(result)
      };

      return result;
    } catch (err) {
      Logger.error("LinkDetector", "detectLinks failed", err);
      return {
        totalLinks: 0,
        externalLinks: [],
        shortenedUrls: [],
        suspiciousDomains: [],
        downloadLinks: [],
        textHrefMismatches: [],
        summary: {
          totalLinks: 0,
          externalLinkCount: 0,
          shortenedUrlCount: 0,
          suspiciousDomainCount: 0,
          downloadLinkCount: 0,
          textHrefMismatchCount: 0,
          riskScore: 0
        }
      };
    }
  }

  function computeRiskScore(result) {
    let score = 0;
    score += result.suspiciousDomains.length * 15;
    score += result.shortenedUrls.length * 8;
    score += result.downloadLinks.length * 10;
    score += result.textHrefMismatches.length * 20;
    return Math.min(100, score);
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectLinks = detectLinks;

  Logger.info("LinkDetector", "linkDetector.js loaded.");
})();
