/**
 * GuardFlow — Page Metadata Detector (metadataDetector.js)
 * -----------------------------------------------------------
 * Role: Detector module. Extracts richer page metadata for webpage
 * profiling purposes: title/description (with Open Graph/Twitter Card
 * fallbacks), favicon, canonical URL, full Open Graph + Twitter Card
 * tag maps, author, site name, language, published date, and robots
 * directive.
 *
 * NORMALIZATION: previously exposed as window.MetadataDetector.analyze()
 * — a naming convention inconsistent with every other detector module
 * in this codebase. Now exposed as
 * window.GuardFlowDetectors.detectPageMetadata so it plugs into
 * pageAnalyzer.js's DETECTOR_REGISTRY like every other detector. Its
 * result is stored under detector_findings.page_metadata — distinct
 * from the top-level `metadata` field content.js/pageAnalyzer.js
 * already populate (description/og_title/og_site_name/language/
 * charset/favicon), since this detector's output is a superset with
 * different key names and both are kept intact.
 *
 * Must be loaded before pageAnalyzer.js in manifest.json's
 * content_scripts "js" array.
 *
 * Input: operates directly on the live document.
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectPageMetadata) {
    Logger.info("MetadataDetector", "Already loaded, skipping re-init.");
    return;
  }

  function getMetaContent(selectors) {
    for (const sel of selectors) {
      const el = GuardFlowDomUtils.queryOne(sel);
      if (el) {
        const content = el.getAttribute('content') || el.textContent;
        if (content && content.trim()) return content.trim();
      }
    }
    return null;
  }

  function getFavicon() {
    const iconSelectors = [
      "link[rel='icon']",
      "link[rel='shortcut icon']",
      "link[rel='apple-touch-icon']",
      "link[rel='apple-touch-icon-precomposed']"
    ];
    for (const sel of iconSelectors) {
      const el = GuardFlowDomUtils.queryOne(sel);
      if (el && el.getAttribute('href')) {
        try {
          return new URL(el.getAttribute('href'), window.location.href).href;
        } catch (e) {
          continue;
        }
      }
    }
    try {
      return new URL('/favicon.ico', window.location.href).href;
    } catch (e) {
      return null;
    }
  }

  function getCanonicalUrl() {
    const el = GuardFlowDomUtils.queryOne("link[rel='canonical']");
    if (el && el.getAttribute('href')) {
      try {
        return new URL(el.getAttribute('href'), window.location.href).href;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function getOpenGraphTags() {
    const ogTags = {};
    GuardFlowDomUtils.queryAll("meta[property^='og:']").forEach(el => {
      const property = el.getAttribute('property');
      const content = el.getAttribute('content');
      if (property && content) {
        const key = property.replace('og:', '');
        ogTags[key] = content;
      }
    });
    const twitterTags = {};
    GuardFlowDomUtils.queryAll("meta[name^='twitter:']").forEach(el => {
      const name = el.getAttribute('name');
      const content = el.getAttribute('content');
      if (name && content) {
        const key = name.replace('twitter:', '');
        twitterTags[key] = content;
      }
    });
    return { openGraph: ogTags, twitter: twitterTags };
  }

  function getAuthor() {
    return getMetaContent([
      "meta[name='author']",
      "meta[property='article:author']",
      "meta[property='og:article:author']",
      "meta[name='twitter:creator']"
    ]);
  }

  function getTitle() {
    return (document.title && document.title.trim()) ||
      getMetaContent(["meta[property='og:title']", "meta[name='twitter:title']"]) ||
      null;
  }

  function getDescription() {
    return getMetaContent([
      "meta[name='description']",
      "meta[property='og:description']",
      "meta[name='twitter:description']"
    ]);
  }

  function getLanguage() {
    return document.documentElement.getAttribute('lang') ||
      getMetaContent(["meta[property='og:locale']"]);
  }

  function getPublishedDate() {
    return getMetaContent([
      "meta[property='article:published_time']",
      "meta[name='date']",
      "meta[itemprop='datePublished']"
    ]);
  }

  function getSiteName() {
    return getMetaContent(["meta[property='og:site_name']"]);
  }

  function getRobotsDirective() {
    return getMetaContent(["meta[name='robots']"]);
  }

  function detectPageMetadata() {
    try {
      const og = getOpenGraphTags();

      return {
        title: getTitle(),
        description: getDescription(),
        favicon: getFavicon(),
        canonicalUrl: getCanonicalUrl(),
        openGraph: og.openGraph,
        twitterCard: og.twitter,
        author: getAuthor(),
        siteName: getSiteName(),
        language: getLanguage(),
        publishedDate: getPublishedDate(),
        robots: getRobotsDirective(),
        url: window.location.href,
        hostname: window.location.hostname
      };
    } catch (err) {
      Logger.error("MetadataDetector", "detectPageMetadata failed", err);
      return {
        title: null,
        description: null,
        favicon: null,
        canonicalUrl: null,
        openGraph: {},
        twitterCard: {},
        author: null,
        siteName: null,
        language: null,
        publishedDate: null,
        robots: null,
        url: null,
        hostname: null
      };
    }
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectPageMetadata = detectPageMetadata;

  Logger.info("MetadataDetector", "metadataDetector.js loaded.");
})();
