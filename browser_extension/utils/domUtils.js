/**
 * GuardFlow — DOM Utilities (domUtils.js)
 * ---------------------------------------------
 * Role: Shared low-level helper library. Provides generic, reusable
 * DOM helpers used by content.js, pageAnalyzer.js, and every detector
 * module — element selection, visibility checks, attribute extraction,
 * safe traversal, and duplicate removal.
 *
 * This module contains NO extraction orchestration, NO pattern-
 * matching, and NO detection logic of its own. It is pure plumbing:
 * small, defensive, single-purpose functions that other modules
 * compose. It does not know what a "scam" or "risk" is.
 *
 * Exposed as globalThis.GuardFlowDomUtils so any content-script-context
 * module can call it directly without an import/bundler step. Must be
 * loaded before content.js, pageAnalyzer.js, and any detector module
 * in manifest.json's content_scripts "js" array.
 */

(function () {
  "use strict";

  if (globalThis.GuardFlowDomUtils) {
    console.log("[GuardFlow:DomUtils] Already loaded, skipping re-init.");
    return;
  }

  // -----------------------------------------------------------------
  // Element selection
  // -----------------------------------------------------------------

  /**
   * Safely queries all elements matching a selector under a root.
   * Never throws on an invalid selector — returns an empty array instead.
   * @param {string} selector
   * @param {Element|Document} [root]
   * @returns {Element[]}
   */
  function queryAll(selector, root) {
    try {
      const scope = root || document;
      return Array.from(scope.querySelectorAll(selector));
    } catch (err) {
      Logger.warn("DomUtils", `Invalid selector: ${selector}`, err);
      return [];
    }
  }

  /**
   * Safely queries the first element matching a selector under a root.
   * Returns null on no match or invalid selector — never throws.
   * @param {string} selector
   * @param {Element|Document} [root]
   * @returns {Element|null}
   */
  function queryOne(selector, root) {
    try {
      const scope = root || document;
      return scope.querySelector(selector);
    } catch (err) {
      Logger.warn("DomUtils", `Invalid selector: ${selector}`, err);
      return null;
    }
  }

  /**
   * Queries across multiple selectors in one pass, merging and
   * de-duplicating results. Useful when several detector-specific
   * selectors should be treated as one candidate set.
   * @param {string[]} selectors
   * @param {Element|Document} [root]
   * @returns {Element[]}
   */
  function queryAllMulti(selectors, root) {
    const seen = new Set();
    const results = [];
    for (const selector of selectors) {
      for (const el of queryAll(selector, root)) {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      }
    }
    return results;
  }

  // -----------------------------------------------------------------
  // Visibility checks
  // -----------------------------------------------------------------

  /**
   * Determines whether an element is visible to the user — checks the
   * element itself and walks up the ancestor chain, since a visible
   * element can still be hidden by a non-visible parent.
   * Considers: display:none, visibility:hidden, the `hidden` attribute,
   * aria-hidden="true", and effectively-zero rendered size.
   * @param {Element} element
   * @returns {boolean}
   */
  function isVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") {
      return false;
    }

    let current = element;
    while (current && current !== document.documentElement) {
      if (current.hasAttribute && current.hasAttribute("hidden")) return false;
      if (current.getAttribute && current.getAttribute("aria-hidden") === "true") return false;

      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }

      current = current.parentElement;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    return true;
  }

  /**
   * Determines whether an element is currently within the visible
   * viewport (a stricter check than isVisible — an element can be
   * "visible" in the DOM/CSS sense but scrolled off-screen).
   * @param {Element} element
   * @returns {boolean}
   */
  function isInViewport(element) {
    if (!isVisible(element)) return false;

    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
  }

  // -----------------------------------------------------------------
  // Attribute extraction
  // -----------------------------------------------------------------

  /**
   * Safely retrieves a single attribute value, returning a fallback
   * (default null) instead of throwing if the element is missing.
   * @param {Element} element
   * @param {string} name
   * @param {*} [fallback]
   * @returns {string|*}
   */
  function getAttribute(element, name, fallback) {
    const resolvedFallback = fallback === undefined ? null : fallback;
    if (!element || typeof element.getAttribute !== "function") return resolvedFallback;
    const value = element.getAttribute(name);
    return value !== null ? value : resolvedFallback;
  }

  /**
   * Extracts a set of named attributes from an element into a plain
   * object, e.g. getAttributes(el, ["type", "name", "placeholder"]).
   * Missing attributes resolve to null, never throw.
   * @param {Element} element
   * @param {string[]} names
   * @returns {Object}
   */
  function getAttributes(element, names) {
    const result = {};
    for (const name of names) {
      result[name] = getAttribute(element, name, null);
    }
    return result;
  }

  /**
   * Builds a single lowercase "searchable text" string out of an
   * element's common naming attributes (name/id/placeholder/class/
   * aria-label) — a common need across detector modules doing
   * naming-hint pattern matches.
   * @param {Element} element
   * @returns {string}
   */
  function getSearchableAttributeText(element) {
    if (!element) return "";
    const parts = [
      getAttribute(element, "name", ""),
      getAttribute(element, "id", ""),
      getAttribute(element, "placeholder", ""),
      getAttribute(element, "class", ""),
      getAttribute(element, "aria-label", ""),
    ];
    return parts.join(" ").toLowerCase().trim();
  }

  // -----------------------------------------------------------------
  // Safe DOM traversal
  // -----------------------------------------------------------------

  /**
   * Safely walks up from an element to find the nearest ancestor
   * matching a selector, without throwing on detached nodes or
   * reaching document root.
   * @param {Element} element
   * @param {string} selector
   * @returns {Element|null}
   */
  function closest(element, selector) {
    try {
      return element && typeof element.closest === "function"
        ? element.closest(selector)
        : null;
    } catch (err) {
      Logger.warn("DomUtils", "closest() failed", err);
      return null;
    }
  }

  /**
   * Safely walks a TreeWalker over text nodes under a root, applying a
   * custom filter function, without throwing if root is missing.
   * Returns an array of matching text nodes (not yet trimmed/joined —
   * callers decide how to combine them).
   * @param {Element} root
   * @param {(node: Text) => boolean} filterFn
   * @returns {Text[]}
   */
  function walkTextNodes(root, filterFn) {
    if (!root) return [];
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          try {
            return filterFn(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          } catch {
            return NodeFilter.FILTER_REJECT;
          }
        },
      });

      const nodes = [];
      let current;
      while ((current = walker.nextNode())) {
        nodes.push(current);
      }
      return nodes;
    } catch (err) {
      Logger.warn("DomUtils", "walkTextNodes() failed", err);
      return [];
    }
  }

  /**
   * Safely retrieves an element's direct children as an array,
   * never throwing on null/detached elements.
   * @param {Element} element
   * @returns {Element[]}
   */
  function getChildren(element) {
    if (!element || !element.children) return [];
    try {
      return Array.from(element.children);
    } catch {
      return [];
    }
  }

  // -----------------------------------------------------------------
  // Duplicate removal
  // -----------------------------------------------------------------

  /**
   * De-duplicates an array of primitive values (strings, numbers)
   * while preserving first-seen order.
   * @param {Array} arr
   * @returns {Array}
   */
  function dedupe(arr) {
    return Array.from(new Set(arr));
  }

  /**
   * De-duplicates an array of objects by a derived key, preserving
   * first-seen order. Useful for e.g. deduping detector findings that
   * are objects rather than primitives.
   * @param {Array<Object>} arr
   * @param {(item: Object) => string} keyFn
   * @returns {Array<Object>}
   */
  function dedupeBy(arr, keyFn) {
    const seen = new Set();
    const result = [];
    for (const item of arr) {
      let key;
      try {
        key = keyFn(item);
      } catch {
        key = JSON.stringify(item);
      }
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  }

  /**
   * De-duplicates an array of DOM elements (by reference), preserving
   * first-seen order. Distinct from dedupe()/dedupeBy() since elements
   * aren't safely usable as Set values across all contexts without
   * this explicit helper for clarity of intent.
   * @param {Element[]} elements
   * @returns {Element[]}
   */
  function dedupeElements(elements) {
    const seen = new Set();
    const result = [];
    for (const el of elements) {
      if (!seen.has(el)) {
        seen.add(el);
        result.push(el);
      }
    }
    return result;
  }

  // -----------------------------------------------------------------
  // Register on the shared namespace
  // -----------------------------------------------------------------

  globalThis.GuardFlowDomUtils = Object.freeze({
    queryAll,
    queryOne,
    queryAllMulti,
    isVisible,
    isInViewport,
    getAttribute,
    getAttributes,
    getSearchableAttributeText,
    closest,
    walkTextNodes,
    getChildren,
    dedupe,
    dedupeBy,
    dedupeElements,
  });

  console.log("[GuardFlow:DomUtils] domUtils.js loaded.");
})();
