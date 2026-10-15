// Build small .docx files from WordprocessingML, and run them through the
// same steps the app takes between opening a file and saving the result.
import JSZip from "jszip";
import mammoth from "mammoth";
import { DOMParser as XmlParser } from "@xmldom/xmldom";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A run of text, optionally with run properties. */
export const run = (text, rPr = "") => `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

/** A paragraph; `inner` is raw XML (use run() for text). */
export const para = (inner, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${inner}</w:p>`;

/** A paragraph of plain text. */
export const text = (t, style) => para(run(t), style);

export const heading = (t) => text(t, "Heading1");

export const cell = (inner) => `<w:tc>${inner}</w:tc>`;
export const table = (rows) =>
  `<w:tbl>${rows.map((cells) => `<w:tr>${cells.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;

export const LINK_REL = "rIdLink";
const HYPERLINK_REL = `<Relationship Id="${LINK_REL}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>`;

/** A .docx whose body is `bodyXml`, with a Heading1 style and one external
 *  hyperlink relationship (LINK_REL) available. */
export async function buildDocx(bodyXml) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      HYPERLINK_REL +
      "</Relationships>",
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>` +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
      "</w:styles>",
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** The descriptor list file-processor.js builds from mammoth's document. */
function collect(mods, elems) {
  const { gtxt, bFlag, tVals } = mods.helpers;
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

/** Open a document the way processFile does: mammoth HTML with the note list
 *  split off, plus the extraction. */
export async function open(mods, buf) {
  const elems = [];
  const { value: html } = await mammoth.convertToHtml(
    { buffer: buf },
    { transformDocument: collect(mods, elems) },
  );
  const { bodyHtml } = mods.footnotes.splitNoteList(html);
  const ex = mods.extractor.processElements(elems);
  return { buf, html: bodyHtml, ...ex };
}

/** The paragraphs the download handler and the live preview both cut the
 *  pasted text into. */
export const paragraphsOf = (revised) =>
  revised
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/** What the Download button writes: the patched document.xml, whether it
 *  parses, and the document's text as mammoth reads it back. */
export async function download(mods, doc, revised) {
  const zip = await JSZip.loadAsync(doc.buf);
  const inputXml = await zip.file("word/document.xml").async("string");
  const xml = mods.writer.patchDocumentXml(
    inputXml,
    doc.out,
    paragraphsOf(revised),
    doc.calloutKeys,
    doc.citationIndex,
  );
  const errors = xmlErrors(xml);
  zip.file("word/document.xml", xml);
  let outText = null;
  if (!errors.length) {
    const out = await zip.generateAsync({ type: "nodebuffer" });
    outText = (await mammoth.extractRawText({ buffer: out })).value;
  }
  return { inputXml, xml, errors, text: outText };
}

/** What the Revise tab's live preview shows, as plain text. */
export function preview(mods, doc, revised) {
  const { html } = mods.preview.buildRevisedHtml(
    doc.html,
    paragraphsOf(revised),
    doc.out,
    doc.calloutKeys,
    doc.citationIndex,
  );
  const el = new DOMParser().parseFromString(html, "text/html").body;
  return el.textContent;
}

/** Well-formedness errors in an XML string; empty when it parses. */
export function xmlErrors(xml) {
  const errors = [];
  try {
    new XmlParser({
      onError: (level, msg) => {
        if (level !== "warning") errors.push(msg);
      },
    }).parseFromString(xml, "text/xml");
  } catch (e) {
    if (!errors.length) errors.push(e.message);
  }
  return errors;
}
