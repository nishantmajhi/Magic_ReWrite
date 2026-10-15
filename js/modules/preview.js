"use strict";

import { tokenSet, tokenSimilarity, buildAlignmentMap, matchKey } from "./alignment.js";

/* ═══════════════════════════════════════════════
     LIVE PARTIAL PREVIEW
     Builds the HTML preview using similarity-based
     paragraph alignment against the original mammoth
     HTML.  Partially filled canvases render immediately;
     unmatched originals stay as-is.
  ═══════════════════════════════════════════════ */

/** Collect every descendant text node of `el`, in document order, without
 *  descending into footnote/endnote reference anchors (their visible
 *  "[N]" marker text must never be overwritten or blanked). */
function collectTextNodes(el, out) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (
        node.matches &&
        node.matches('a[href^="#footnote"], a[href^="#endnote"]')
      )
        continue;
      collectTextNodes(node, out);
    }
  }
  return out;
}

/** Replace the text content of an element without touching child element nodes.
 *
 * Text nodes are gathered recursively (not just direct children of `el`),
 * because a short, single-sentence paragraph is often wrapped entirely in
 * one inline element by mammoth (e.g. `<p><strong>…</strong></p>` for a
 * fully-bold question/heading-like sentence). Direct-children-only lookup
 * finds no text node in that case and falls into the "insert new text
 * node" branch below - which left the ORIGINAL text sitting untouched
 * inside <strong> while inserting the revised text as a sibling, so both
 * the original and the revised sentence rendered side by side. Searching
 * recursively finds the real text node (inside <strong>) and updates it
 * in place instead. */
export function replaceTextOnly(el, newText) {
  const tnodes = collectTextNodes(el, []);
  if (!tnodes.length) {
    el.insertBefore(el.ownerDocument.createTextNode(newText), el.firstChild);
    return;
  }
  tnodes[0].nodeValue = newText;
  for (let i = 1; i < tnodes.length; i++) tnodes[i].nodeValue = "";
}

/**
 * Produce a new HTML string by replacing matched paragraphs in originalHtml
 * with their revised counterparts.
 *
 * @param {string} originalHtml    - mammoth HTML of the original docx
 * @param {Array}  revisedParas  - flat list of revised paragraph strings
 * @param {string} curExtracted    - full extracted text (ground truth)
 * @param {Map}    curCalloutKeys  - from processElements
 * @returns {{ html: string }} - patched inner HTML
 */
export function buildRevisedHtml(
  originalHtml,
  revisedParas,
  curExtracted,
  curCalloutKeys,
  citationIndex = new Map(),
) {
  if (!revisedParas.length) return { html: originalHtml };

  const { extBlocks, mapping, lineMapping, calloutMap } =
    buildAlignmentMap(curExtracted, revisedParas, curCalloutKeys, citationIndex);

  const norm = (t) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const extNormArr = extBlocks.map(norm);
  const usedExtIdx = new Set();

  /* ── findExtIdx ─────────────────────────────────────────────────── */
  function findExtIdx(rawText) {
    const en = matchKey(rawText);
    if (!en) return -1;

    // Pass 0: lineMapping hit - find parent block. lineMapping now stores
    // an array of {extIdx, value} candidates per key (one per physical
    // occurrence of that text, sorted by document position) rather than a
    // single value, so duplicate original text across different blocks
    // doesn't collide. Prefer a candidate whose block hasn't been used
    // yet in this preview pass.
    if (lineMapping.has(en)) {
      const candidates = lineMapping.get(en);
      for (const c of candidates) {
        if (!usedExtIdx.has(c.extIdx)) return c.extIdx;
      }
      if (candidates.length) return candidates[0].extIdx;
    }

    // Pass 1: exact block match
    for (let i = 0; i < extNormArr.length; i++)
      if (!usedExtIdx.has(i) && extNormArr[i] === en) return i;
    for (let i = 0; i < extNormArr.length; i++)
      if (extNormArr[i] === en) return i;

    // Pass 2: line-in-block containment
    for (let i = 0; i < extBlocks.length; i++) {
      if (usedExtIdx.has(i)) continue;
      const blockLines = extBlocks[i]
        .split(/\n/)
        .map((l) => norm(l))
        .filter(Boolean);
      for (const bl of blockLines) {
        if (bl === en) return i;
        const blStripped = bl.replace(/^(-\s+|\d+\.\s+)/, "").trim();
        if (blStripped === en) return i;
      }
      if (extNormArr[i].startsWith(en) || en.startsWith(extNormArr[i]))
        return i;
    }

    // Pass 3: token similarity
    const hSet = tokenSet(en);
    let bi = -1,
      bs = 0;
    for (let i = 0; i < extNormArr.length; i++) {
      if (usedExtIdx.has(i)) continue;
      const sim = tokenSimilarity(hSet, tokenSet(extBlocks[i]));
      if (sim > bs) {
        bs = sim;
        bi = i;
      }
    }
    return bs >= 0.35 ? bi : -1;
  }

  /* ── resolveHtmlReplacement ─────────────────────────────────────── */
  function resolveHtmlReplacement(rawText, extIdx) {
    const key = matchKey(rawText);
    if (lineMapping.has(key)) {
      const candidates = lineMapping.get(key);
      const exact = candidates.find((c) => c.extIdx === extIdx);
      if (exact) return exact.value;
      if (candidates.length) return candidates[0].value;
    }
    if (!mapping.has(extIdx)) return null;
    const blockLines = extBlocks[extIdx]
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (blockLines.length === 1) return mapping.get(extIdx);
    return null;
  }

  /* ── DOM walk ───────────────────────────────────────────────────── */
  function consumeTableBlocks(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll("tr"));
    if (!rows.length) return;
    const colCount = rows.reduce((mx, r) => Math.max(mx, r.cells.length), 0);
    for (let c = 0; c < colCount; c++) {
      const colTexts = rows
        .map((r) => {
          const cell = r.cells[c];
          return cell ? norm(cell.textContent) : "";
        })
        .filter(Boolean);
      if (!colTexts.length) continue;
      const colJoined = colTexts.join(" ");
      let bestI = -1,
        bs = 0;
      for (let i = 0; i < extNormArr.length; i++) {
        if (usedExtIdx.has(i)) continue;
        const mn = Math.min(colJoined.length, extNormArr[i].length);
        let com = 0;
        while (com < mn && colJoined[com] === extNormArr[i][com]) com++;
        const sc_ = com / Math.max(colJoined.length, extNormArr[i].length);
        if (sc_ > bs) {
          bs = sc_;
          bestI = i;
        }
      }
      if (bestI >= 0 && bs >= 0.4) usedExtIdx.add(bestI);
    }
  }

  /** Text used for matching against extracted blocks - excludes footnote/
   *  endnote reference markers (mammoth renders these as an inline
   *  <sup><a href="#footnote-N">[N]</a></sup>, whose visible "[N]" text is
   *  part of el.textContent but was never part of the extracted text used
   *  to build the alignment map, so including it here silently broke every
   *  match for any paragraph that has a footnote). */
  function matchText(el) {
    const clone = el.cloneNode(true);
    for (const a of clone.querySelectorAll(
      'a[href^="#footnote"], a[href^="#endnote"]',
    )) {
      const sup = a.closest("sup") || a;
      sup.remove();
    }
    // A soft line break is a space in the extracted text (see gtxt), but
    // contributes nothing to textContent.
    for (const br of clone.querySelectorAll("br"))
      br.replaceWith(clone.ownerDocument.createTextNode(" "));
    return clone.textContent.trim();
  }

  function walkNode(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (/^h[1-6]$/.test(tag)) return;
    if (tag === "table") {
      consumeTableBlocks(el);
      return;
    }
    if (tag === "ul" || tag === "ol") {
      for (const child of el.children) walkNode(child);
      return;
    }
    if (tag === "p" || tag === "li") {
      const txt = matchText(el);
      if (!txt) return;
      if (/\t\d+$/.test(txt)) return;
      if (/^\[\d[\d,\-\s]*\]$/.test(txt)) return;
      const extIdx = findExtIdx(txt);
      if (extIdx >= 0) {
        usedExtIdx.add(extIdx);
        const replacement = resolveHtmlReplacement(txt, extIdx);
        if (replacement) {
          const calloutLabel = calloutMap.get(matchKey(txt));
          if (calloutLabel) {
            const body = replacement.replace(
              new RegExp(
                "^" +
                  calloutLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                  ":\\s*",
                "i",
              ),
              "",
            );
            el.innerHTML = `<strong>${calloutLabel}:</strong> ${body
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")}`;
          } else {
            replaceTextOnly(el, replacement);
          }
        }
      }
      return;
    }
    for (const child of el.children) walkNode(child);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(originalHtml, "text/html");
  for (const child of doc.body.children) walkNode(child);
  return { html: doc.body.innerHTML };
}
