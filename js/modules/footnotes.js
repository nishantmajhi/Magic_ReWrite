"use strict";

/* ═══════════════════════════════════════════════
     FOOTNOTE CANVAS
     Splits mammoth's trailing note list off the end
     of the body and renders it as its own page.
  ═══════════════════════════════════════════════ */

/**
 * Mammoth appends every footnote and endnote to the end of the body as a
 * bare <ol>, with no heading and no separator of any kind. On a document
 * whose last section is a reference list, the result reads like this:
 *
 *   <h1>Bibliography</h1>
 *   <p>[Insert bibliography in Harvard style]</p>
 *   <ol><li id="footnote-1">https://…</li>…</ol>
 *
 * so twenty-nine footnote URLs render immediately beneath the Bibliography
 * heading and look exactly like its entries. There is nothing on the page to
 * say otherwise - a reader has no way to tell the note list from the section
 * it happens to follow.
 *
 * Splitting the notes out onto their own page with their own heading is the
 * whole fix for that. It also keeps the note <li> elements away from
 * buildRevisedHtml's paragraph walk, which would otherwise try to align each
 * one against the extracted body text as though it were a paragraph.
 */

/** True when every <li> in this list is a mammoth note (footnote or endnote).
 *  Checked across all of them rather than just the first, so an ordinary
 *  numbered list that happens to end the document is never mistaken for the
 *  note list and hidden away on a second page. */
function isNoteList(el) {
  if (!el || el.tagName !== "OL") return false;
  const items = el.children;
  if (!items.length) return false;
  for (const li of items) {
    if (li.tagName !== "LI") return false;
    if (!/^(footnote|endnote)-/.test(li.id || "")) return false;
  }
  return true;
}

/**
 * Split mammoth HTML into body and notes.
 *
 * Only trailing lists are taken. A note list can only ever appear at the very
 * end of mammoth's output, so anything earlier in the document is a real list
 * belonging to the body and is left exactly where it is.
 *
 * @param {string} html - mammoth HTML for the whole document
 * @returns {{ bodyHtml: string, notesHtml: string }} - notesHtml is "" when
 *   the document has no footnotes, which is the common case.
 */
export function splitNoteList(html) {
  if (!html || html.indexOf("footnote-") === -1) {
    if (!html || html.indexOf("endnote-") === -1) {
      return { bodyHtml: html || "", notesHtml: "" };
    }
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const notes = [];

  // Walk backwards from the end, collecting note lists until something that
  // isn't one is reached.
  let node = doc.body.lastElementChild;
  while (node && isNoteList(node)) {
    const prev = node.previousElementSibling;
    notes.unshift(node);
    node.remove();
    node = prev;
  }

  if (!notes.length) return { bodyHtml: html, notesHtml: "" };

  return {
    bodyHtml: doc.body.innerHTML,
    notesHtml: notes.map((n) => n.outerHTML).join(""),
  };
}

/**
 * Render a notes page into `pageEl`, or hide it when there are no notes.
 *
 * The heading is a plain <h1> so it inherits the same rule as every other
 * heading in the canvas it belongs to - `.doc-html h1` on the File tab,
 * `.humanized-doc-html h1` on the Insert tab. Hard-coding a size here would
 * mean the Footnotes heading drifted out of step the moment either canvas's
 * heading style changed.
 *
 * @param {HTMLElement} pageEl    - the notes page wrapper (hidden when empty)
 * @param {HTMLElement} contentEl - element inside it that receives the HTML
 * @param {string} notesHtml      - from splitNoteList
 */
export function renderNotesPage(pageEl, contentEl, notesHtml) {
  if (!pageEl || !contentEl) return;
  if (!notesHtml) {
    pageEl.hidden = true;
    contentEl.innerHTML = "";
    return;
  }
  contentEl.innerHTML = `<h1>Footnotes</h1>${notesHtml}`;
  pageEl.hidden = false;
}
