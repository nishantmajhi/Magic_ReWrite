// Test 11 - Footnotes get their own canvas, and links stay legible on it
//
// Two UI defects, both reported against the ELL_917 pipeline.
//
// 1. Mammoth appends every footnote to the end of the body as a bare <ol>,
//    with no heading and no separator. When the document's last section is a
//    reference list, the rendered result is:
//
//      <h1>Bibliography</h1><p>[Insert bibliography…]</p><ol><li id="footnote-1">…
//
//    so 29 footnote URLs sit directly beneath the Bibliography heading and
//    read as its entries. There is nothing on the page to tell them apart.
//    splitNoteList() moves them onto their own canvas under a "Footnotes"
//    heading. This also keeps the note <li> elements out of preview.js's
//    paragraph walk, which would otherwise try to align each one against the
//    extracted body text as though it were a body paragraph.
//
// 2. The Insert tab's dark canvas had no `a` colour rule at all, so links
//    fell through to the browser default #0000EE on a #262626 page: 1.6:1,
//    far below the 4.5:1 floor, and saturated blue on near-black on top of
//    that. The File tab's own link colour cannot simply be reused - #0563c1
//    measures 2.6:1 there.
import fs from "fs";
import { JSDOM } from "jsdom";
import mammoth from "mammoth";
import { check } from "../../helpers/assert.mjs";

// footnotes.js runs in the browser against the native DOMParser.
global.DOMParser = new JSDOM("").window.DOMParser;
const { splitNoteList, renderNotesPage } = await import(
  "../../../js/modules/footnotes.js"
);

const cssPath = new URL("../../../css/style.css", import.meta.url);
const css = fs.readFileSync(cssPath, "utf8");

/* ── 1. Splitting the note list off a real document ──────────────────── */

const { value: html } = await mammoth.convertToHtml({
  buffer: fs.readFileSync(new URL("./input.docx", import.meta.url)),
});
const { bodyHtml, notesHtml } = splitNoteList(html);

const noteItemsIn = (html.match(/<li id="footnote-/g) || []).length;
const noteItemsMoved = (notesHtml.match(/<li id="footnote-/g) || []).length;

check(
  "Input fixture really does carry footnotes to split",
  noteItemsIn === 29,
  `expected 29, got ${noteItemsIn}`,
);
check(
  "Every footnote item moved onto the notes canvas",
  noteItemsMoved === noteItemsIn,
  `moved ${noteItemsMoved} of ${noteItemsIn}`,
);
check(
  "No footnote item is left in the body canvas",
  !/<li id="footnote-/.test(bodyHtml),
);
check(
  "Body now ends at the Bibliography placeholder, not a wall of URLs",
  /\[Insert bibliography in Harvard style\]<\/p>$/.test(bodyHtml.trim()),
  `tail: ${JSON.stringify(bodyHtml.trim().slice(-90))}`,
);

// The in-text markers are what make a footnote a footnote. Moving the note
// bodies must not disturb them.
const markersIn = (html.match(/id="footnote-ref-/g) || []).length;
const markersOut = (bodyHtml.match(/id="footnote-ref-/g) || []).length;
check(
  "All in-text footnote markers survive in the body",
  markersOut === markersIn && markersOut === 29,
  `in: ${markersIn}, out: ${markersOut}`,
);

/* ── 2. What must NOT be moved ───────────────────────────────────────── */

const notMoved = [
  ["a document with no notes at all", "<p>Hello</p><p>World</p>"],
  [
    "an ordinary numbered list that happens to end the document",
    "<p>Steps:</p><ol><li>First</li><li>Second</li></ol>",
  ],
  [
    "a list holding a note item AND a real item",
    '<p>B</p><ol><li id="footnote-1">n</li><li>real item</li></ol>',
  ],
  ["an empty document", ""],
];
for (const [label, input] of notMoved) {
  const r = splitNoteList(input);
  check(
    `Leaves ${label} alone`,
    r.notesHtml === "" && r.bodyHtml === input,
    `notes: ${JSON.stringify(r.notesHtml)}`,
  );
}

check(
  "Splits endnotes as well as footnotes",
  splitNoteList('<p>Body</p><ol><li id="endnote-1"><p>en</p></li></ol>')
    .notesHtml === '<ol><li id="endnote-1"><p>en</p></li></ol>',
);
check(
  "Takes only the trailing note list, leaving an earlier body list in place",
  (() => {
    const r = splitNoteList(
      '<p>Steps:</p><ol><li>First</li></ol><ol><li id="footnote-1">n</li></ol>',
    );
    return (
      r.bodyHtml === "<p>Steps:</p><ol><li>First</li></ol>" &&
      r.notesHtml === '<ol><li id="footnote-1">n</li></ol>'
    );
  })(),
);

/* ── 3. Rendering the notes page ─────────────────────────────────────── */

const doc = new JSDOM(
  '<div id="page" hidden><div id="content"></div></div>',
).window.document;
const pageEl = doc.getElementById("page");
const contentEl = doc.getElementById("content");

renderNotesPage(pageEl, contentEl, notesHtml);
check("Notes page is revealed when there are notes", pageEl.hidden === false);
check(
  "Notes page is headed 'Footnotes'",
  contentEl.querySelector("h1")?.textContent === "Footnotes",
);
check(
  "The heading is an <h1>, so it inherits the canvas's own Heading 1 style",
  contentEl.firstElementChild?.tagName === "H1",
);
check(
  "The note list sits below the heading",
  contentEl.querySelector("h1 + ol") !== null,
);

renderNotesPage(pageEl, contentEl, "");
check(
  "Notes page is hidden again for a document without footnotes",
  pageEl.hidden === true && contentEl.innerHTML === "",
);

/* ── 4. Link contrast on the two canvases ────────────────────────────── */

function luminance(hex) {
  const v = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

function cssValue(selector, prop) {
  const rule = css.match(
    new RegExp(
      selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}",
    ),
  );
  if (!rule) return null;
  const m = rule[1].match(new RegExp(prop + "\\s*:\\s*([^;]+)"));
  return m ? m[1].trim() : null;
}

const darkCard = cssValue(":root", "--sw-card");
const linkVar = cssValue(":root", "--sw-link");

check("The dark canvas declares a link colour at all", linkVar !== null);
check(
  "The Insert tab canvas has an `a` rule using it",
  cssValue(".humanized-doc-html a", "color") === "var(--sw-link)",
);

if (linkVar && darkCard) {
  const ratio = contrast(linkVar, darkCard);
  check(
    `Insert tab link colour meets WCAG AA on the dark page (${ratio.toFixed(2)}:1)`,
    ratio >= 4.5,
    `${linkVar} on ${darkCard}`,
  );
  // The regression this guards: reusing the File tab's blue looks like the
  // obvious fix and is not one.
  const fileBlue = cssValue(".doc-html a", "color");
  check(
    "Guard: the File tab's blue would NOT have passed here",
    contrast(fileBlue, darkCard) < 4.5,
    `${fileBlue} on ${darkCard} = ${contrast(fileBlue, darkCard).toFixed(2)}:1`,
  );
  check(
    "Guard: the browser default #0000EE would NOT have passed here",
    contrast("#0000EE", darkCard) < 4.5,
  );
  // The File tab was reported as fine and must stay that way.
  check(
    `File tab link colour still passes on white (${contrast(fileBlue, "#ffffff").toFixed(2)}:1)`,
    contrast(fileBlue, "#ffffff") >= 4.5,
  );
}

