// Shared test harness - runs the REAL app pipeline (unmodified source
// modules from js/modules/) against an input .docx + revised paragraph
// array, and returns everything a test might want to assert on.
import fs from "fs";
import mammoth from "mammoth";
import JSZip from "jszip";
import { gtxt, bFlag, tVals } from "../../js/modules/mammoth-helpers.js";
import { processElements } from "../../js/modules/extractor.js";
import { patchDocumentXml } from "../../js/modules/docx-writer.js";

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
 * @param {string} docxPath        - path to input .docx
 * @param {string[]} revisedParas  - array of revised paragraph strings (already split)
 * @returns {{ extracted, calloutKeys, inputXml, outputXml, outputBuf, extractRawText }}
 */
export async function runPipeline(docxPath, revisedParas) {
  const buf = fs.readFileSync(docxPath);
  const elems = [];
  await mammoth.convertToHtml(
    { buffer: buf },
    { transformDocument: buildTransform(elems) },
  );
  const { out, calloutKeys, pills, nW } = processElements(elems);

  const zip = await JSZip.loadAsync(buf);
  const inputXml = await zip.file("word/document.xml").async("string");
  const outputXml = patchDocumentXml(inputXml, out, revisedParas, calloutKeys);
  zip.file("word/document.xml", outputXml);
  const outputBuf = await zip.generateAsync({ type: "nodebuffer" });

  return {
    extracted: out,
    calloutKeys,
    pills,
    nW,
    inputXml,
    outputXml,
    outputBuf,
    async extractOutputText() {
      const { value } = await mammoth.extractRawText({ buffer: outputBuf });
      return value;
    },
  };
}

/** Split a flat revised-text blob into paragraphs the way app.js does
 *  (2+ newlines = paragraph boundary). */
export function splitRevisedParas(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Extract all <w:tbl>...</w:tbl> blocks from a document.xml string. */
export function extractTables(xml) {
  const re = /<w:tbl[ >][\s\S]*?<\/w:tbl>/g;
  return xml.match(re) || [];
}

/** Extract all w:footnoteReference ids in document order. */
export function extractFootnoteIds(xml) {
  const re = /<w:footnoteReference\s+w:id="(-?\d+)"/g;
  const ids = [];
  let m;
  while ((m = re.exec(xml)) !== null) ids.push(m[1]);
  return ids;
}
