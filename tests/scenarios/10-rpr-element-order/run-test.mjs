// Test 10 - OOXML run-properties (rPr) element ordering
//
// docx-writer.js splits a "Label: body" callout paragraph into a bold
// label run + a plain body run. To do that it needs to insert <w:b/> and
// <w:bCs/> into the original run's <w:rPr>. The OOXML schema (CT_RPr)
// requires run-property children in a FIXED ORDER - rStyle, rFonts, b,
// bCs, i, iCs, ..., sz, szCs, ... - and Word enforces this strictly on
// load (unlike lenient tools like mammoth or LibreOffice).
//
// The original implementation always inserted <w:b/> immediately after
// <w:rPr>, which is correct ONLY when the run has no rFonts/rStyle before
// it. Any run with additional formatting (a custom font here) got <w:b/>
// inserted BEFORE <w:rFonts> - a schema-order violation that real Word
// rejects with "Word experienced an error trying to open the file."
//
// This test uses a fixture where the callout's original run has an extra
// <w:rFonts> + <w:sz> beyond just bold, and checks that the fix places
// <w:b/><w:bCs/> in the schema-correct position (after rFonts, before sz)
// rather than corrupting the element order.
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
  "Output document.xml is well-formed XML",
  parseErrors.length === 0,
  parseErrors.join("; "),
);

/* ── Schema element order ───────────────────────────────────────── */
const rPrMatch = result.outputXml.match(
  /<w:rPr>((?:(?!<\/w:rPr>)[\s\S])*)<\/w:rPr><w:t[^>]*>Note: /,
);
check("Found the bold label run's rPr block in the output", !!rPrMatch);

if (rPrMatch) {
  const childTags = [...rPrMatch[1].matchAll(/<(w:[a-zA-Z]+)/g)].map(
    (m) => m[1],
  );
  const rFontsIdx = childTags.indexOf("w:rFonts");
  const bIdx = childTags.indexOf("w:b");
  const bCsIdx = childTags.indexOf("w:bCs");
  const szIdx = childTags.indexOf("w:sz");

  check(
    "rPr contains rFonts, b, bCs, and sz",
    rFontsIdx >= 0 && bIdx >= 0 && bCsIdx >= 0 && szIdx >= 0,
    childTags.join(","),
  );
  check(
    "Schema order preserved: rFonts before b before bCs before sz",
    rFontsIdx < bIdx && bIdx < bCsIdx && bCsIdx < szIdx,
    `actual order: ${childTags.join(", ")}`,
  );
}

/* ── The plain body run must NOT be bold ────────────────────────── */
const bodyTextIdx = result.outputXml.indexOf("This is the REVISED");
const bodyRunStart = result.outputXml.lastIndexOf("<w:r>", bodyTextIdx);
const bodyRunXml = result.outputXml.slice(
  bodyRunStart,
  result.outputXml.indexOf("</w:r>", bodyTextIdx) + 6,
);
check(
  "Found the plain body run in the output",
  bodyRunStart >= 0 && bodyRunXml.includes("This is the REVISED"),
);
if (bodyRunStart >= 0) {
  check(
    "Plain body run has no <w:b/> or <w:bCs/> (bold correctly stripped, not leaked onto the body)",
    !/<w:b[\s\/]/.test(bodyRunXml) && !/<w:bCs[\s\/]/.test(bodyRunXml),
    `body run xml: ${bodyRunXml}`,
  );
  check(
    "Plain body run still keeps the original font formatting (rFonts/sz preserved)",
    bodyRunXml.includes("Georgia"),
  );
}

const text = await result.extractOutputText();
check(
  "Revised label body text applied",
  text.includes(
    "This is the REVISED label text with different wording entirely.",
  ),
);

