"use strict";

/* ═══════════════════════════════════════════════
     APPLICATION STATE
     Single shared object so every module can read
     and write the same instance without circular
     imports on individual variables.
  ═══════════════════════════════════════════════ */
export const state = {
  curFile:       null,
  curExtracted:  "",          // full extracted text (ground truth)
  curCalloutKeys: new Map(),  // normStr → original-cased text for iHead-strip lines
  citationIndex: new Map(),   // normStr(line) → citations stripped from it, for restore
  originalDocHtml: "",        // mammoth HTML of the original docx, notes removed
  docNotesHtml:  "",          // trailing footnote/endnote <ol>(s), rendered on their own page
  insertMode:    false,
  isPaidAccount: true,        // paid (default) vs free - controls canvas size
  canvasTexts:   [],          // extracted text per canvas
  revisedTexts: [],         // revised text per canvas (parallel)
};
