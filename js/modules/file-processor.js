"use strict";

import { gtxt, bFlag, tVals } from "./mammoth-helpers.js";
import { processElements } from "./extractor.js";
import { state } from "./state.js";
import {
  showLoad,
  hideLoad,
  setTitle,
  showBadges,
  setLpWords,
  docHTML,
  docNotesPage,
  docNotesHtml,
  initOv,
  reextBtn,
  closeBtn,
  insertTab,
  tbTitle,
  lpTitle,
} from "./ui.js";
import { renderExtractedCanvases } from "./canvases.js";
import { splitNoteList, renderNotesPage } from "./footnotes.js";

/* ═══════════════════════════════════════════════
     MAIN FILE PROCESSOR
  ═══════════════════════════════════════════════ */

/**
 * Build the mammoth transformDocument callback that populates `elems`.
 * Extracted so it can be shared between processFile and re-extract.
 */
function buildTransform(elems) {
  return (doc) => {
    for (const ch of doc.children || []) {
      if (ch.type === "paragraph")
        elems.push({
          type: "p",
          st: ch.styleName || ch.styleId || "Normal",
          raw: gtxt(ch).trim(),
          bold: bFlag(ch),
          isList: !!ch.numbering,
          ni: ch.numbering?.numId ?? null,
          lv: ch.numbering?.level ?? 0,
        });
      else if (ch.type === "table") elems.push({ type: "t", v: tVals(ch) });
    }
    return doc;
  };
}

/**
 * Load a .docx File, render it via mammoth, extract body text,
 * and populate all relevant state + DOM.
 */
export async function processFile(file) {
  if (!file || !file.name.toLowerCase().endsWith(".docx")) return;
  const previous = state.curFile;
  showLoad("Reading document…");
  setTitle(file.name);
  try {
    const buf = await file.arrayBuffer();
    const elems = [];
    showLoad("Rendering document…");
    const { value: html } = await mammoth.convertToHtml(
      { arrayBuffer: buf },
      { transformDocument: buildTransform(elems) },
    );
    // Only now is this the open document. Setting it before mammoth had
    // read the file left a file that could not be read as the one Download
    // would patch, under the previous document's extraction.
    state.curFile = file;
    // Notes are pulled out before anything else touches the HTML, so the
    // main canvas holds the body alone and the alignment walk in preview.js
    // never sees a note <li> to mistake for a paragraph.
    const { bodyHtml, notesHtml } = splitNoteList(html);
    state.docNotesHtml = notesHtml;
    docHTML.innerHTML = bodyHtml;
    renderNotesPage(docNotesPage, docNotesHtml, notesHtml);
    initOv.style.display = "none";

    // Freeze image dimensions so layout doesn't shift on re-render
    const imgs = Array.from(docHTML.querySelectorAll("img"));
    if (imgs.length > 0) {
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((res) => {
                img.onload = res;
                img.onerror = res;
              }),
        ),
      );
      await new Promise((res) => requestAnimationFrame(res));
      imgs.forEach((img) => {
        const w = img.offsetWidth,
          h = img.offsetHeight;
        if (w > 0 && h > 0) {
          img.style.width = w + "px";
          img.style.height = h + "px";
          img.setAttribute("width", w);
          img.setAttribute("height", h);
        }
      });
    }
    state.originalDocHtml = docHTML.innerHTML;

    showLoad("Extracting body text…");
    const { out, pills, nW, calloutKeys, citationIndex } = processElements(elems);
    state.curExtracted = out;
    state.curCalloutKeys = calloutKeys;
    state.citationIndex = citationIndex;
    showBadges(pills, nW);
    // Counted across both pages, so moving the notes onto their own canvas
    // doesn't silently change the number shown for the same document.
    setLpWords(
      (docHTML.innerText + " " + docNotesHtml.innerText)
        .split(/\s+/)
        .filter(Boolean).length,
    );
    renderExtractedCanvases();
    [reextBtn, closeBtn].forEach((b) => (b.disabled = false));
    insertTab.classList.add("ready");
    hideLoad();
  } catch (err) {
    hideLoad();
    // Whatever was open before is still what is on screen; say so.
    if (previous) setTitle(previous.name);
    else {
      tbTitle.textContent = "Magic ReWrite";
      lpTitle.textContent = "No document open";
    }
    console.error(err);
  }
}

/* ═══════════════════════════════════════════════
     RE-EXTRACT
  ═══════════════════════════════════════════════ */

/**
 * Re-run mammoth extraction on the already-loaded file (e.g. after an
 * editing session has dirtied the canvases).
 */
export async function reExtract() {
  if (!state.curFile) return;
  showLoad("Re-extracting…");
  try {
    const buf = await state.curFile.arrayBuffer();
    const elems = [];
    await mammoth.convertToHtml(
      { arrayBuffer: buf },
      { transformDocument: buildTransform(elems) },
    );
    const { out, pills, nW, calloutKeys, citationIndex } = processElements(elems);
    state.curExtracted = out;
    state.curCalloutKeys = calloutKeys;
    state.citationIndex = citationIndex;
    showBadges(pills, nW);
    renderExtractedCanvases();
  } catch (err) {
    console.error(err);
  } finally {
    hideLoad();
  }
}
