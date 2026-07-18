/**
 * GuardFlow — Text Extractor (textExtractor.js)
 * ---------------------------------------------------
 * Role: Utility module. Extracts ONLY visible, human-readable text from
 * the current page's DOM, normalizes whitespace, and hands back a
 * clean string for every detector module (scam keywords, countdown
 * timers, payment signals, government references, etc.) to run
 * pattern-matching against.
 *
 * This module contains NO pattern-matching and NO detection logic of
 * its own — it is purely a text-cleaning utility that sits upstream
 * of every detector. It does not decide anything about the page; it
 * just makes sure detectors see the same clean, human-visible text
 * rather than raw markup.
 *
 * Ignored during extraction:
 *   - <script>, <style>, <noscript> contents (never human-visible)
 *   - Elements hidden via CSS (display:none, visibility:hidden)
 *   - Elements hidden via the `hidden` attribute or aria-hidden="true"
 *   - Elements with effectively-invisible sizing (e.g. 0x0 clip-hack
 *     patterns sometimes used to hide text from users while keeping
 *     it in the DOM)
 *
 * Exposed as window.GuardFlowTextExtractor.extractVisibleText so both
 * content.js and any detector module needing raw access can call it
 * directly. Must be loaded before content.js and any detector module
 * in manifest.json's content_scripts "js" array.
 */

(function () {
  "use strict";

  if (window.GuardFlowTextExtractor) {
    Logger.info("TextExtractor", "Already loaded, skipping re-init.");
    return;
  }

  const MAX_TEXT_LENGTH = 5000; // cap returned text length for payload size

  const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

  /**
   * Extracts clean, visible-only text from the page (or a given root
   * element), with whitespace normalized to single spaces.
   *
   * @param {Element} [root] - Optional root to extract from. Defaults
   *   to document.body.
   * @param {Object} [options]
   * @param {number} [options.maxLength] - Cap on returned text length.
   *   Defaults to MAX_TEXT_LENGTH.
   * @returns {{ text: string, truncated: boolean }}
   */
  function extractVisibleText(root, options) {
    const maxLength = (options && options.maxLength) || MAX_TEXT_LENGTH;

    try {
      const rootElement = root || document.body || document.documentElement;
      if (!rootElement) {
        return { text: "", truncated: false };
      }

      const chunks = collectVisibleTextChunks(rootElement);
      const normalized = normalizeWhitespace(chunks.join(" "));

      return {
        text: normalized.slice(0, maxLength),
        truncated: normalized.length > maxLength,
      };
    } catch (err) {
      Logger.error("TextExtractor", "extractVisibleText failed", err);
      return { text: "", truncated: false };
    }
  }

  // -----------------------------------------------------------------
  // Internal: DOM walking
  // -----------------------------------------------------------------

  /**
   * Walks the DOM under `rootElement` collecting text node content,
   * rejecting anything inside a non-visible or non-content element.
   */
  function collectVisibleTextChunks(rootElement) {
    const walker = document.createTreeWalker(
      rootElement,
      NodeFilter.SHOW_TEXT,
      { acceptNode: (node) => filterTextNode(node) }
    );

    const chunks = [];
    let currentNode;
    while ((currentNode = walker.nextNode())) {
      const trimmed = currentNode.textContent.trim();
      if (trimmed.length > 0) {
        chunks.push(trimmed);
      }
    }
    return chunks;
  }

  /**
   * TreeWalker acceptNode callback — rejects text nodes that live
   * inside script/style/hidden elements, or that are themselves empty
   * after trimming.
   */
  function filterTextNode(node) {
    const parent = node.parentElement;
    if (!parent) return NodeFilter.FILTER_REJECT;

    if (SKIPPED_TAGS.has(parent.tagName)) {
      return NodeFilter.FILTER_REJECT;
    }

    if (isHiddenElement(parent)) {
      return NodeFilter.FILTER_REJECT;
    }

    return node.textContent.trim().length > 0
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT;
  }

  /**
   * Determines whether an element (or any of its ancestors) is hidden
   * from the user via CSS, attributes, or effectively-invisible sizing.
   * Walks up the ancestor chain because a text node's immediate parent
   * may be visible while a grandparent container is display:none.
   */
  function isHiddenElement(element) {
    let current = element;

    while (current && current !== document.documentElement) {
      if (current.hasAttribute("hidden")) return true;
      if (current.getAttribute("aria-hidden") === "true") return true;

      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") {
        return true;
      }

      // Effectively-invisible sizing hack: zero (or near-zero) width/height
      // combined with overflow hidden is a common way to hide text from
      // users while keeping it readable to naive scrapers.
      if (
        style.overflow === "hidden" &&
        (current.offsetWidth <= 1 || current.offsetHeight <= 1) &&
        current.textContent.trim().length > 0
      ) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  // -----------------------------------------------------------------
  // Internal: whitespace normalization
  // -----------------------------------------------------------------

  /**
   * Collapses all whitespace runs (spaces, tabs, newlines) into single
   * spaces and trims the result, producing clean, detector-friendly text.
   * Delegates to the shared GuardFlowUtils.normalizeWhitespace() (utils.js)
   * rather than duplicating the same regex here.
   */
  function normalizeWhitespace(text) {
    return GuardFlowUtils.normalizeWhitespace(text);
  }

  // -----------------------------------------------------------------
  // Register on the shared namespace
  // -----------------------------------------------------------------

  window.GuardFlowTextExtractor = Object.freeze({
    extractVisibleText,
  });

  Logger.info("TextExtractor", "textExtractor.js loaded.");
})();
