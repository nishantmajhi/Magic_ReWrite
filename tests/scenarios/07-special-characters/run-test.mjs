// Test 07 - XML special characters in revised text
//
// docx-writer.js's xmlEsc() escapes &, <, > when writing revised text back
// into word/document.xml. This test throws a paragraph full of exactly the
// characters that break naive string-substitution approaches - raw `&`,
// `<`, `>`, straight/curly quotes, an em dash, and Unicode math symbols -
// and checks that: (1) the resulting document.xml is still well-formed
// XML, (2) the characters are correctly escaped in the raw XML, and
// (3) mammoth can round-trip them back to the ORIGINAL unescaped
// characters (no double-escaping like "&amp;amp;", no corruption).
import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import { runPipeline, splitRevisedParas } from "../../helpers/harness.mjs";
import { check } from "../../helpers/assert.mjs";

const revisedText = fs.readFileSync(
  new URL("./revised.txt", import.meta.url),
  "utf8",
);
const revisedParas = splitRevisedParas(revisedText);

const result = await runPipeline(
  new URL("./input.docx", import.meta.url),
  revisedParas,
);
fs.writeFileSync(
  new URL("./actual_output.docx", import.meta.url),
  result.outputBuf,
);

/* ── Well-formedness ────────────────────────────────────────────── */
let parseErrors = [];
const parser = new DOMParser({
  onError: (level, m) => { if (level !== 'warning') parseErrors.push(m); },
});
parser.parseFromString(result.outputXml, "text/xml");
check(
  "Output document.xml is still well-formed XML after inserting &, <, > in revised text",
  parseErrors.length === 0,
  parseErrors.join("; "),
);

/* ── Correct escaping in the raw XML ────────────────────────────── */
check(
  "Raw '&' is escaped to &amp; in the XML",
  result.outputXml.includes("R&amp;D teams"),
);
check(
  "Raw '<' is escaped to &lt; in the XML",
  result.outputXml.includes("is x &lt; y"),
);
check(
  "Raw '>' is escaped to &gt; in the XML",
  result.outputXml.includes("y &gt; x?"),
);
check(
  "No double-escaping artifacts (&amp;amp; / &amp;lt; etc.) anywhere in the XML",
  !/&amp;(amp|lt|gt);/.test(result.outputXml),
);

/* ── Round-trip back to original characters via mammoth ─────────── */
const text = await result.extractOutputText();
check(
  "'&' round-trips back to a literal ampersand",
  text.includes("R&D teams") && text.includes("statistical & neural"),
);
check(
  "'<' and '>' round-trip back to literal angle brackets",
  text.includes("is x < y") &&
    text.includes("y > x?") &&
    text.includes("<unlocked>"),
);
check(
  "Curly quotes / em dash survive untouched",
  text.includes("\u201cimplications\u201d") &&
    text.includes("\u2014 including em-dashes"),
);
check(
  "Unicode math symbols survive untouched",
  text.includes("x\u2081") &&
    text.includes("\u2211\u1d62") &&
    text.includes("\u2248"),
);

check(
  "Footnote reference immediately after the special-character sentence is still intact",
  (result.outputXml.match(/<w:footnoteReference\s+w:id="1"/) || []).length ===
    1,
);

