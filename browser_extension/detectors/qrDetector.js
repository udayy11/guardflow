/**
 * GuardFlow — QR Detector (qrDetector.js)
 * ---------------------------------------------
 * Role: Detector module. Identifies elements on the page that are
 * LIKELY to be QR codes — inspecting <img>, <canvas>, and <svg>
 * elements for structural/metadata heuristics (square aspect ratio,
 * naming hints, size range typical of QR renders).
 *
 * This module NEVER decodes QR contents. It does not read pixel data,
 * does not run any QR-decoding library, and does not know what a QR
 * code, if present, points to. It only reports "this element looks
 * QR-shaped" based on structure and metadata — a descriptive signal,
 * not a verdict. Whether a QR code's presence matters for risk is
 * decided entirely by the backend's risk_engine.py.
 *
 * Exposed as window.GuardFlowDetectors.detectQrCandidates so it plugs
 * into pageAnalyzer.js's DETECTOR_REGISTRY like every other detector.
 * Must be loaded before pageAnalyzer.js in manifest.json's
 * content_scripts "js" array.
 *
 * Input: can be called with a pre-extracted images array from
 * content.js (raw.images), and additionally inspects the live DOM
 * directly for <canvas> and <svg> elements (which content.js's image
 * extractor does not cover, since those aren't <img> tags).
 */

(function () {
  "use strict";

  if (window.GuardFlowDetectors && window.GuardFlowDetectors.detectQrCandidates) {
    Logger.info("QrDetector", "Already loaded, skipping re-init.");
    return;
  }

  // -----------------------------------------------------------------
  // Heuristic thresholds
  // -----------------------------------------------------------------

  // QR codes are square or near-square. Allow a small tolerance for
  // rendering/border artifacts.
  const ASPECT_RATIO_TOLERANCE = 0.15;

  // Typical rendered QR sizes on web pages — too small (icons/logos)
  // or too large (banners/photos) reduces likelihood.
  const MIN_QR_DIMENSION = 60;
  const MAX_QR_DIMENSION = 1000;

  // Naming hints in filenames/alt text/class/id that suggest a QR image.
  const QR_NAME_HINT_PATTERN = /\bqr\b|qrcode|qr[-_]?code|scan[-_]?to[-_]?pay|scan[-_]?me/i;

  /**
   * Detects likely QR code candidates among img/canvas/svg elements.
   *
   * @param {Array|undefined} preExtractedImages - Optional images array
   *   already produced by content.js's extractImages(). If omitted,
   *   <img> elements are queried from the live DOM directly.
   * @returns {Object} {
   *   qr_present: boolean,
   *   image_sources: string[],   // src of <img> candidates likely to be QR codes
   *   canvas_present: boolean,   // any <canvas> element flagged as likely QR
   *   svg_present: boolean       // any <svg> element flagged as likely QR
   * }
   */
  function detectQrCandidates(preExtractedImages) {
    try {
      const imageCandidates = Array.isArray(preExtractedImages)
        ? evaluateExtractedImages(preExtractedImages)
        : evaluateDomImages();

      const canvasCandidates = evaluateCanvasElements();
      const svgCandidates = evaluateSvgElements();

      const qrPresent =
        imageCandidates.length > 0 || canvasCandidates.length > 0 || svgCandidates.length > 0;

      return {
        qr_present: qrPresent,
        image_sources: imageCandidates.map((img) => img.src).filter(Boolean).slice(0, 20),
        canvas_present: canvasCandidates.length > 0,
        svg_present: svgCandidates.length > 0,
      };
    } catch (err) {
      Logger.error("QrDetector", "detectQrCandidates failed", err);
      return {
        qr_present: false,
        image_sources: [],
        canvas_present: false,
        svg_present: false,
      };
    }
  }

  // -----------------------------------------------------------------
  // <img> evaluation
  // -----------------------------------------------------------------

  /**
   * Evaluates a pre-extracted images array (from content.js) for
   * QR-likelihood using dimensions + src/alt naming hints only.
   */
  function evaluateExtractedImages(images) {
    return images.filter((img) => isLikelyQrByMetadata(img.src, img.alt, img.width, img.height));
  }

  /**
   * Fallback: queries <img> elements from the live DOM directly.
   */
  function evaluateDomImages() {
    const elements = GuardFlowDomUtils.queryAll("img");
    return elements
      .map((el) => ({
        src: el.src || null,
        alt: el.alt || null,
        width: el.naturalWidth || el.width || null,
        height: el.naturalHeight || el.height || null,
      }))
      .filter((img) => isLikelyQrByMetadata(img.src, img.alt, img.width, img.height));
  }

  function isLikelyQrByMetadata(src, alt, width, height) {
    const nameText = `${src || ""} ${alt || ""}`.toLowerCase();
    const nameMatches = QR_NAME_HINT_PATTERN.test(nameText);

    const dimensionsMatch = isSquareWithinQrSizeRange(width, height);

    // Either a strong naming hint, or square-and-QR-sized dimensions,
    // is enough to flag as a candidate. Requiring both would miss QR
    // images with generic filenames (e.g. "image123.png").
    return nameMatches || dimensionsMatch;
  }

  // -----------------------------------------------------------------
  // <canvas> evaluation
  // -----------------------------------------------------------------

  /**
   * Flags <canvas> elements as QR candidates based on square dimensions
   * and/or naming hints on the element itself (id/class/data attributes).
   * Never reads canvas pixel data (no getImageData/toDataURL calls).
   */
  function evaluateCanvasElements() {
    const elements = GuardFlowDomUtils.queryAll("canvas");
    return elements.filter((el) => {
      const nameText = `${el.id || ""} ${el.className || ""}`.toLowerCase();
      const nameMatches = QR_NAME_HINT_PATTERN.test(nameText);
      const dimensionsMatch = isSquareWithinQrSizeRange(el.width, el.height);
      return nameMatches || dimensionsMatch;
    });
  }

  // -----------------------------------------------------------------
  // <svg> evaluation
  // -----------------------------------------------------------------

  /**
   * Flags <svg> elements as QR candidates based on square viewBox/
   * dimensions and/or naming hints. QR codes rendered as SVG are common
   * in payment-gateway "scan to pay" widgets.
   */
  function evaluateSvgElements() {
    const elements = GuardFlowDomUtils.queryAll("svg");
    return elements.filter((el) => {
      const nameText = `${el.getAttribute("id") || ""} ${el.getAttribute("class") || ""}`.toLowerCase();
      const nameMatches = QR_NAME_HINT_PATTERN.test(nameText);

      const { width, height } = getSvgDimensions(el);
      const dimensionsMatch = isSquareWithinQrSizeRange(width, height);

      return nameMatches || dimensionsMatch;
    });
  }

  function getSvgDimensions(svgEl) {
    // Prefer explicit width/height attributes; fall back to viewBox.
    const widthAttr = parseFloat(svgEl.getAttribute("width"));
    const heightAttr = parseFloat(svgEl.getAttribute("height"));

    if (!Number.isNaN(widthAttr) && !Number.isNaN(heightAttr)) {
      return { width: widthAttr, height: heightAttr };
    }

    const viewBox = svgEl.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox.split(/\s+/).map(Number);
      if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
        return { width: parts[2], height: parts[3] };
      }
    }

    return { width: null, height: null };
  }

  // -----------------------------------------------------------------
  // Shared dimension heuristic
  // -----------------------------------------------------------------

  function isSquareWithinQrSizeRange(width, height) {
    if (!width || !height || width <= 0 || height <= 0) return false;

    const ratio = width / height;
    const isSquare = Math.abs(ratio - 1) <= ASPECT_RATIO_TOLERANCE;

    const isWithinSizeRange =
      width >= MIN_QR_DIMENSION &&
      width <= MAX_QR_DIMENSION &&
      height >= MIN_QR_DIMENSION &&
      height <= MAX_QR_DIMENSION;

    return isSquare && isWithinSizeRange;
  }

  // -----------------------------------------------------------------
  // Register on the shared detectors namespace
  // -----------------------------------------------------------------

  window.GuardFlowDetectors = window.GuardFlowDetectors || {};
  window.GuardFlowDetectors.detectQrCandidates = detectQrCandidates;

  Logger.info("QrDetector", "qrDetector.js loaded.");
})();
