"use strict";

import { restoreFor, sc } from "./citations.js";

/**
 * The form a paragraph's text is compared in, wherever a paragraph of the
 * document is looked up against an extracted line: citations out, spacing
 * collapsed, lower case.
 *
 * The extracted lines had their citations removed before anyone saw them,
 * but the paragraphs they are matched back to - in document.xml and in the
 * preview's DOM - still carry them. Comparing the two as they stood meant
 * a cited paragraph matched nothing, and in any section of more than one
 * paragraph it was silently left unrevised.
 */
export const matchKey = (text) =>
  sc(text).replace(/\s+/g, " ").trim().toLowerCase();

/* ═══════════════════════════════════════════════
     SIMILARITY-BASED PARAGRAPH ALIGNMENT
     Allows live partial preview: revised paras
     are matched to original extracted blocks by
     word-overlap similarity. Unmatched originals
     stay as-is so partial paste renders correctly.
  ═══════════════════════════════════════════════ */

/** Tokenise text into a Set of lowercase word-tokens (length > 2).
 *  Letters, combining marks and digits of any script count: an ASCII-only
 *  filter left a Cyrillic or Devanagari paragraph with no tokens at all, so
 *  it could only ever match if pasted back unchanged. */
export function tokenSet(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Jaccard-like similarity between two token sets. Returns [0..1]. */
export function tokenSimilarity(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

/**
 * Build a mapping: extractedIdx → revisedText (or null if not yet revised).
 *
 * Strategy (greedy, order-preserving):
 *   1. Parse both sides into paragraph arrays.
 *   2. For each revised paragraph, find the best-matching extracted paragraph
 *      that hasn't been claimed yet, searching forward from the last matched
 *      position to preserve document order.
 *   3. Similarity threshold: 0.35 for block-level; 0.10 / 0.12 for wide scans.
 *   4. Extracted paragraphs with no revised match keep their original text.
 *
 * @param {string}  extractedText   - full extracted text (ground truth)
 * @param {Array}   revisedParas  - array of revised paragraph strings
 * @param {Map}     calloutKeys     - normStr → original-cased text from processElements
 * @returns {{ extBlocks, mapping, lineMapping, calloutMap }}
 */
export function buildAlignmentMap(
  extractedText,
  revisedParas,
  calloutKeys = new Map(),
  citationIndex = new Map(),
) {
  // Citations were stripped out of the extracted text before it was handed
  // over for revision, so the revised text comes back without them. They are
  // put back here, at the single point both consumers (the live preview and
  // the .docx writer) share - restoring in either one alone would leave the
  // other showing uncited prose.
  const restore = (originalLine, revisedValue) =>
    restoreFor(citationIndex, originalLine, revisedValue);
  // rawExtBlocks preserves intra-block \n so lineMapping can split on them.
  // extBlocks collapses \n→space for similarity/exact matching.
  const rawExtBlocks = extractedText
    .split(/\n{4}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const extBlocks = rawExtBlocks.map((p) => p.replace(/\n/g, " ").trim());

  if (!revisedParas.length)
    return {
      extBlocks: rawExtBlocks,
      mapping: new Map(),
      lineMapping: new Map(),
    };

  const extSets = extBlocks.map((b) => tokenSet(b));
  const claimed = new Set();
  const mapping = new Map();

  const normStr = (t) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const extNorm = extBlocks.map(normStr);

  // matchOrder tracks, in revisedParas array order, which extIdx (if any)
  // each entry resolved to - used below for orphan-paragraph reattachment.
  const matchOrder = [];

  // Non-empty revised paragraphs, keeping their original array position
  // (needed for orphan reattachment) but matched independently of it.
  const entries = revisedParas
    .map((t) => t.trim())
    .filter(Boolean)
    .map((hTrim) => ({ hTrim, hNorm: normStr(hTrim), hSet: tokenSet(hTrim) }));
  const assigned = new Array(entries.length).fill(-1);

  // Pass 1: exact matches. Unambiguous, so order truly doesn't matter here -
  // walk every (entry, block) pair and claim exact text matches first.
  for (let i = 0; i < entries.length; i++) {
    for (let b = 0; b < extBlocks.length; b++) {
      if (claimed.has(b)) continue;
      if (extNorm[b] === entries[i].hNorm) {
        assigned[i] = b;
        claimed.add(b);
        break;
      }
    }
  }

  // Pass 2: similarity - GLOBAL greedy max-weight matching, not a
  // sequential per-paragraph search. Sequentially processing revised
  // paragraphs one at a time (in whatever order they're supplied) lets an
  // earlier-processed paragraph grab a "good enough" block before a later
  // paragraph that's actually the BEST match for that block gets a chance
  // to claim it - so reordering the input could silently steal a block out
  // from under its true match. Instead, score every remaining (entry,
  // block) pair up front and assign strictly in descending score order, so
  // the strongest matches always win regardless of array order.
  {
    const candidates = [];
    for (let i = 0; i < entries.length; i++) {
      if (assigned[i] >= 0) continue;
      for (let b = 0; b < extBlocks.length; b++) {
        if (claimed.has(b)) continue;
        const sim = tokenSimilarity(entries[i].hSet, extSets[b]);
        if (sim >= 0.08) candidates.push([sim, i, b]);
      }
    }
    candidates.sort((a, b) => b[0] - a[0]);
    for (const [, i, b] of candidates) {
      if (assigned[i] >= 0 || claimed.has(b)) continue;
      assigned[i] = b;
      claimed.add(b);
    }
  }

  for (let i = 0; i < entries.length; i++) {
    if (assigned[i] >= 0) mapping.set(assigned[i], entries[i].hTrim);
    matchOrder.push({ hTrim: entries[i].hTrim, bestIdx: assigned[i] });
  }

  /* ── Orphan-paragraph reattachment ──────────────────────────────────
     If a revised paragraph didn't match anything on its own, but the
     paragraph immediately before it (in the order the user supplied them)
     DID match a block that still has unfilled lines, attach this orphan
     as additional content for that block. This recovers cases where a
     multi-line section got split into extra paragraphs by a stray blank
     line, so the trailing part isn't silently dropped. */
  for (let k = 0; k < matchOrder.length; k++) {
    const entry = matchOrder[k];
    if (entry.bestIdx >= 0) continue;
    if (k === 0) continue;
    const prev = matchOrder[k - 1];
    if (prev.bestIdx < 0) continue;
    const B = prev.bestIdx;
    const origLineCount = rawExtBlocks[B].split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean).length;
    const curHum = mapping.get(B) || "";
    const curHumLineCount = curHum
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean).length;
    if (curHumLineCount >= origLineCount) continue;
    mapping.set(B, curHum + "\n" + entry.hTrim);
    entry.bestIdx = B;
  }

  // The revised text as pasted, before any citation goes back in. The line
  // mapping below restores citations itself, so it must be built from this -
  // building it from the restored blocks would put every citation in twice.
  const orderedMapping = [...mapping.entries()].sort((a, b) => a[0] - b[0]);

  /* ── Block-level citation restore ───────────────────────────────────
     `mapping` is consulted as a fallback for single-line blocks, so it has
     to carry restored text too - otherwise the same paragraph would render
     with citations via lineMapping and without them via this path. */
  for (const [extIdx, humBlock] of mapping) {
    const origLines = rawExtBlocks[extIdx]
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (origLines.length === 1) {
      mapping.set(extIdx, restore(normStr(origLines[0]), humBlock));
    }
  }

  /* ── Line-level mapping ────────────────────────────────────────────── */
  // For every \n-separated line within each block, map its normalised text
  // → the corresponding revised line at the same relative position.
  //
  // Stored as key → Array<{extIdx, value}>, sorted by extIdx (document
  // order), rather than key → single value. When the exact same sentence
  // appears in more than one block, a plain key→value map would let the
  // last-processed block silently overwrite the first's entry, causing
  // both physical occurrences to end up with the same revision. Consumers
  // (docx-writer.js) pick the candidate matching the specific extIdx (or
  // the first not-yet-used one) instead of relying on a single shared slot.
  const lineMapping = new Map();
  const normStr2 = matchKey;

  function pushLineMapping(key, extIdx, value) {
    if (!lineMapping.has(key)) lineMapping.set(key, []);
    const arr = lineMapping.get(key);
    // `key` is the normalised ORIGINAL line, which is exactly how the
    // citation index is keyed - so this is where a revised line gets its
    // citations back.
    arr.push({ extIdx, value: restore(key, value) });
    arr.sort((a, b) => a.extIdx - b.extIdx);
  }

  for (const [extIdx, humBlock] of orderedMapping) {
    const origBlock = rawExtBlocks[extIdx];
    const origLines = origBlock
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const humLines = humBlock
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (origLines.length === 1) {
      pushLineMapping(normStr2(origLines[0]), extIdx, humBlock.trim());
    } else {
      if (origLines.length === humLines.length) {
        origLines.forEach((ol, i) => {
          pushLineMapping(normStr2(ol), extIdx, humLines[i]);
          // Also register without list prefix for XML para matching
          const stripped = ol.replace(/^(-\s+|\d+\.\s+)/, "").trim();
          if (stripped !== ol)
            pushLineMapping(normStr2(stripped), extIdx, humLines[i]);
        });
      } else {
        // Align by best Jaccard match, greedy order-preserving
        const humSets = humLines.map(tokenSet);
        const usedH = new Set();
        let lastH = 0;
        for (const ol of origLines) {
          const oSet = tokenSet(ol);
          const windowEnd = Math.min(humLines.length, lastH + 6);
          let bi = -1,
            bs = 0;
          for (let h = lastH; h < windowEnd; h++) {
            if (usedH.has(h)) continue;
            const s = tokenSimilarity(oSet, humSets[h]);
            if (s > bs) {
              bs = s;
              bi = h;
            }
          }
          if (bi < 0) {
            for (let h = 0; h < humLines.length; h++) {
              if (usedH.has(h)) continue;
              const s = tokenSimilarity(oSet, humSets[h]);
              if (s > bs) {
                bs = s;
                bi = h;
              }
            }
          }
          if (bi >= 0 && bs >= 0.08) {
            pushLineMapping(normStr2(ol), extIdx, humLines[bi]);
            const stripped = ol.replace(/^(-\s+|\d+\.\s+)/, "").trim();
            if (stripped !== ol)
              pushLineMapping(normStr2(stripped), extIdx, humLines[bi]);
            usedH.add(bi);
            if (bi >= lastH) lastH = bi + 1;
          }
        }
      }
    }
  }

  /* ── Leftover-hum pass ─────────────────────────────────────────────── */
  // When a revised block has MORE lines than its matched extracted block,
  // match orphaned hum lines to unmapped orig lines via token similarity.
  {
    const allOrigLines = new Map();
    for (const raw of rawExtBlocks) {
      for (const l of raw
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean)) {
        const k = normStr2(l);
        if (!allOrigLines.has(k)) allOrigLines.set(k, l);
      }
    }
    const unmappedOrigKeys = new Set(
      [...allOrigLines.keys()].filter(
        (k) =>
          !lineMapping.has(k) &&
          !lineMapping.has(normStr2(k.replace(/^(-\s+|\d+\.\s+)/, "").trim())),
      ),
    );
    const unmappedOrigSets = new Map(
      [...unmappedOrigKeys].map((k) => [k, tokenSet(k)]),
    );

    for (const [extIdx, humBlock] of orderedMapping) {
      const origBlock = rawExtBlocks[extIdx];
      const oL = origBlock
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const hL = humBlock
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (hL.length <= oL.length) continue;

      const mappedHumLines = new Set(
        oL
          .map((ol) => normStr2(ol))
          .flatMap((k) =>
            (lineMapping.get(k) || [])
              .filter((c) => c.extIdx === extIdx)
              .map((c) => c.value),
          ),
      );
      for (const hl of hL) {
        const hlTrim = hl.trim();
        if (!hlTrim || mappedHumLines.has(hlTrim)) continue;
        const hlSet = tokenSet(hlTrim.replace(/^-\s+/, ""));
        let bestKey = null,
          bestSim = 0;
        for (const [k, kSet] of unmappedOrigSets) {
          const sim = tokenSimilarity(hlSet, kSet);
          if (sim > bestSim) {
            bestSim = sim;
            bestKey = k;
          }
        }
        if (bestKey && bestSim >= 0.25) {
          pushLineMapping(bestKey, extIdx, hlTrim);
          const stripped = bestKey.replace(/^(-\s+|\d+\.\s+)/, "").trim();
          if (stripped !== bestKey) pushLineMapping(stripped, extIdx, hlTrim);
          unmappedOrigSets.delete(bestKey);
          unmappedOrigKeys.delete(bestKey);
        }
      }
    }
  }

  /* ── calloutMap ────────────────────────────────────────────────────── */
  // normStr(line) → original-cased label (e.g. "Scope", "Key insight")
  const calloutMap = new Map();
  for (const [key] of lineMapping) {
    if (!calloutKeys.has(key)) continue;
    const orig = calloutKeys.get(key) || "";
    const mOrig = orig.match(/^([A-Z][A-Za-z\s]{0,59}):\s+/);
    if (mOrig) calloutMap.set(key, mOrig[1].trim());
  }

  return { extBlocks: rawExtBlocks, mapping, lineMapping, calloutMap };
}
