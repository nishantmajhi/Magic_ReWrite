"use strict";

/* ═══════════════════════════════════════════════
     MAMMOTH HELPERS
     Utilities for walking the mammoth AST and
     extracting text / metadata from its nodes.
  ═══════════════════════════════════════════════ */

/** Recursively extract plain text from a mammoth element. */
export function gtxt(el) {
  if (!el) return "";
  if (el.type === "text") return el.value || "";
  // mammoth reports Shift+Enter, page and column breaks as type "break".
  // A space, not "\n": a newline inside a paragraph would make it two lines
  // of extracted text, neither of which matches the one paragraph it came
  // from when the revision is written back.
  if (el.type === "break") return " ";
  if (el.children && el.children.length) return el.children.map(gtxt).join("");
  return "";
}

/**
 * Returns:
 *   true  - all runs are bold
 *   false - no runs are bold
 *   null  - mixed (some bold, some not)
 */
export function bFlag(p) {
  const r = (p.children || []).filter((c) => c.type === "run");
  if (!r.length) return false;
  const bc = r.filter((x) => x.bold === true).length;
  if (bc === 0) return false;
  if (bc === r.length) return true;
  return null;
}

/** Extract cell values from a mammoth table element as a 2-D array. */
export function tVals(t) {
  return (t.children || []).map((row) =>
    (row.children || []).map((cell) =>
      (cell.children || [])
        .filter((p) => p.type === "paragraph")
        .map((p) => gtxt(p).trim())
        .filter(Boolean)
        .join(" "),
    ),
  );
}
