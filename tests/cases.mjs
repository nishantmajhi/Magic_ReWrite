// Cases run twice: against this working tree by cases.test.mjs, and against
// the original code by original.test.mjs.
//
// A case marked `regression: true` describes a defect. It must pass here and
// FAIL against the original - if it passes there too, it is not testing the
// defect it claims to. Every other case describes behaviour that already
// worked, and must pass against both.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers/roots.mjs";
import { LINK_REL, buildDocx, download, heading, open, para, preview, run, table, text } from "./helpers/docx.mjs";

const read = (mods, f) => fs.readFileSync(path.join(mods.root, f), "utf8");

/** Open `body` (or use an opened `doc`), paste `revised`, download; the
 *  result must parse. */
async function roundTrip(mods, body, revised, doc) {
  doc ??= await open(mods, await buildDocx(body));
  const out = await download(mods, doc, revised);
  assert.deepEqual(out.errors, [], "document.xml must be well-formed - Word refuses the file otherwise");
  return out;
}

// Elements that wrap runs inside a paragraph. The writer used to keep
// everything before the first text run and everything after the last one,
// and drop what lay between - so a wrapper that opened or closed in between
// lost one of its tags. (One lying wholly between two text runs lost both,
// which is why each of these sits at an edge.)
const WRAPPED = [
  ["a hyperlink at the start of a paragraph", (r) => `<w:hyperlink r:id="${LINK_REL}">${r("Example Corp")}</w:hyperlink>${r(" published its annual results in March.")}`],
  ["a hyperlink at the end of a paragraph", (r) => `${r("The full annual report is available from ")}<w:hyperlink r:id="${LINK_REL}">${r("the company website")}</w:hyperlink>`],
  ["a tracked insertion", (r) => `<w:ins w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">${r("Revenue grew ")}</w:ins>${r("by ten percent in the final quarter of the year.")}`],
  ["a content control at the end of a paragraph", (r) => `${r("The contract was signed in early April by ")}<w:sdt><w:sdtPr><w:alias w:val="Party"/></w:sdtPr><w:sdtContent>${r("the purchasing company")}</w:sdtContent></w:sdt>`],
  ["a smart tag", (r) => `<w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags" w:element="place">${r("Melbourne")}</w:smartTag>${r(" hosted the regional conference in June.")}`],
];

const CITED =
  heading("Findings") +
  text("Breaches rose sharply over the last financial year (OAIC 2025a).") +
  text("Regulators responded with far larger fines than before (ASIC 2026; Smith & Jones 2024).");
const CITED_REVISED =
  "Breaches climbed steeply during the past financial year.\nRegulators answered with much heavier penalties than previously.";
const CITED_EXPECTED = [
  "Breaches climbed steeply during the past financial year (OAIC 2025a).",
  "Regulators answered with much heavier penalties than previously (ASIC 2026; Smith & Jones 2024).",
];

// Shift+Enter in Word, and what text pasted in from a PDF or a web page is
// usually full of.
const SOFT_BREAK = para(
  "<w:r><w:t>The first line of the address block</w:t><w:br/><w:t>second line of the address block.</w:t></w:r>",
);
const SOFT_BREAK_REVISED =
  "The opening part of the address block, now reworded.\nA normal paragraph comes after the break.";

// Two paragraphs in one section, lightly reworded - the kind of edit the
// similarity matching exists for.
const SCRIPTS = [
  [
    "Cyrillic",
    ["Экономика региона выросла на пять процентов за прошлый год.", "Безработица в регионе снизилась впервые за десять лет."],
    ["Экономика региона выросла почти на пять процентов за прошлый год.", "Безработица в регионе заметно снизилась впервые за десять лет."],
  ],
  [
    "Devanagari",
    ["नेपालको अर्थतन्त्र गत वर्ष पाँच प्रतिशतले बढ्यो।", "बेरोजगारी दश वर्षमा पहिलो पटक घट्यो।"],
    ["नेपालको अर्थतन्त्र गत वर्ष झण्डै पाँच प्रतिशतले बढ्यो।", "बेरोजगारी दश वर्षमा पहिलो पटक उल्लेख्य रूपमा घट्यो।"],
  ],
];

const words = (t) => t.split(/\s+/).filter(Boolean).length;

// Deterministic prose: paragraph i of a section uses words no other
// paragraph shares, apart from a few ordinary function words.
const VOCAB = "archive budget census delta ember fabric garnet harbour island jigsaw kernel lantern meadow nectar orchard pylon quarry ribbon saddle timber umbra velvet walnut xenon yarrow zenith".split(" ");
const paragraph = (tag, i, n) =>
  Array.from({ length: n }, (_, k) => `${VOCAB[(i + k) % VOCAB.length]}${tag}${i}x${k % 7}`).join(" ") + " and the rest.";
/** Thirty paragraphs of about fifty words: 1,500 words in one section. */
const LONG_SECTION = () => Array.from({ length: 30 }, (_, i) => paragraph("long", i, 47)).join("\n");
const SHORT_SECTION = (tag) => Array.from({ length: 3 }, (_, i) => paragraph(tag, i, 40)).join("\n");

/** Each expected sentence appears, exactly once. */
function assertOnce(haystack, sentences) {
  for (const s of sentences) {
    const n = haystack.split(s).length - 1;
    assert.equal(n, 1, `expected once, found ${n} times: ${s}\nin: ${haystack}`);
  }
}

export const cases = [
  {
    name: "cited paragraphs in a section of several are revised in the download, citations restored",
    regression: true,
    async run(mods) {
      const out = await roundTrip(mods, CITED, CITED_REVISED);
      assertOnce(out.text, CITED_EXPECTED);
    },
  },
  {
    name: "cited paragraphs in a section of several are revised in the live preview, citations restored",
    regression: true,
    async run(mods) {
      const doc = await open(mods, await buildDocx(CITED));
      assertOnce(preview(mods, doc, CITED_REVISED), CITED_EXPECTED);
    },
  },
  {
    name: "every line of the reference document is revised in the download when every line is pasted back revised",
    regression: true,
    async run(mods) {
      const buf = fs.readFileSync(path.join(ROOT, "tests/scenarios/12-citations-and-references/input.docx"));
      const doc = await open(mods, buf);
      const lines = doc.out.split("\n").filter((l) => l.trim());
      const revised = doc.out.replace(/^(?=\S)/gm, "Revised ");
      const out = await roundTrip(mods, null, revised, doc);
      const paras = out.text.split(/\n+/).filter(Boolean);
      const done = paras.filter((p) => p.startsWith("Revised ")).length;
      assert.equal(done, lines.length, `${done} of ${lines.length} lines revised`);
      // Before the fix, not one paragraph carrying a citation was revised.
      const cited = paras.filter((p) => /\([A-Z][^()]*\d{4}[a-z]?\)/.test(p));
      assert.ok(cited.length > 0 && cited.every((p) => p.startsWith("Revised ")));
    },
  },
  {
    name: "a cited paragraph alone in its section gets its citation back exactly once",
    async run(mods) {
      const body = heading("Findings") + text("Breaches rose sharply over the last financial year (OAIC 2025a).") + heading("Method") + text("Forty firms were surveyed in three states.");
      const revised = "Breaches climbed steeply during the past financial year.\n\n\n\nThe study covered forty companies in three states.";
      const doc = await open(mods, await buildDocx(body));
      const expected = ["Breaches climbed steeply during the past financial year (OAIC 2025a)."];
      assertOnce((await download(mods, doc, revised)).text, expected);
      assertOnce(preview(mods, doc, revised), expected);
    },
  },
  {
    name: "a paragraph containing &, < or > is revised in the download",
    regression: true,
    async run(mods) {
      const body = heading("Costs") + text("Spending on R&D doubled while overheads stayed <5% of revenue.") + text("Hiring stayed flat for most of the period.");
      const out = await roundTrip(mods, body, "Investment in R&D grew twofold as overheads held under 5% of revenue.\nRecruitment held steady for much of the period.");
      assertOnce(out.text, ["Investment in R&D grew twofold as overheads held under 5% of revenue."]);
    },
  },
  {
    name: "a paragraph containing & is revised in the live preview",
    async run(mods) {
      const body = heading("Costs") + text("Spending on R&D doubled across the whole sector.") + text("Hiring stayed flat for most of the period.");
      const doc = await open(mods, await buildDocx(body));
      assertOnce(preview(mods, doc, "Investment in R&D grew twofold across the industry.\nRecruitment held steady for much of the period."), ["Investment in R&D grew twofold across the industry."]);
    },
  },
  {
    name: "a paragraph with a non-breaking hyphen is revised in the download",
    regression: true,
    async run(mods) {
      const body = heading("Trade") + para(run("Growth in e") + "<w:r><w:noBreakHyphen/></w:r>" + run("commerce outpaced every other retail channel.")) + text("Store sales fell for the third year running.");
      const out = await roundTrip(mods, body, "Online retail grew faster than any other channel.\nShop takings declined for a third straight year.");
      assertOnce(out.text, ["Online retail grew faster than any other channel."]);
    },
  },
  {
    name: "a soft line break keeps the words either side of it apart in the extracted text",
    regression: true,
    async run(mods) {
      const doc = await open(mods, await buildDocx(heading("Address") + SOFT_BREAK));
      assert.match(doc.out, /first line of the address block second line/);
    },
  },
  {
    name: "a paragraph with a soft line break is revised in the download",
    async run(mods) {
      const out = await roundTrip(mods, heading("Address") + SOFT_BREAK + text("An ordinary paragraph follows the break."), SOFT_BREAK_REVISED);
      assertOnce(out.text, ["The opening part of the address block, now reworded."]);
    },
  },
  {
    name: "a paragraph with a soft line break is revised in the live preview",
    async run(mods) {
      const doc = await open(mods, await buildDocx(heading("Address") + SOFT_BREAK + text("An ordinary paragraph follows the break.")));
      assertOnce(preview(mods, doc, SOFT_BREAK_REVISED), ["The opening part of the address block, now reworded."]);
    },
  },
  ...SCRIPTS.flatMap(([script, original, revised]) => [
    {
      name: `${script} paragraphs are revised in the download`,
      regression: true,
      async run(mods) {
        const out = await roundTrip(mods, heading("Intro") + original.map((t) => text(t)).join(""), revised.join("\n"));
        assertOnce(out.text, revised);
      },
    },
    {
      name: `${script} paragraphs are revised in the live preview`,
      regression: true,
      async run(mods) {
        const doc = await open(mods, await buildDocx(heading("Intro") + original.map((t) => text(t)).join("")));
        assertOnce(preview(mods, doc, revised.join("\n")), revised);
      },
    },
  ]),
  {
    name: "a table nested in another table leaves the outer table's later cells untouched",
    regression: true,
    async run(mods) {
      const inner = table([[text("Inner cell")]]);
      const outer = table([[inner + text("Quarterly revenue grew by ten percent overall."), text("Second column")]]);
      const body = heading("Results") + text("Quarterly revenue grew by ten percent overall.") + outer;
      const out = await roundTrip(mods, body, "Turnover in the quarter rose ten percent in total.");
      const tables = (xml) => xml.slice(xml.indexOf("<w:tbl>"), xml.lastIndexOf("</w:tbl>"));
      assert.equal(tables(out.xml), tables(out.inputXml), "table XML must be byte-identical");
      assertOnce(out.text, ["Turnover in the quarter rose ten percent in total."]);
    },
  },
  ...[
    ["the first section", (long) => [long, SHORT_SECTION("closing")]],
    ["a middle section", (long) => [SHORT_SECTION("opening"), long, SHORT_SECTION("closing")]],
  ].map(([where, layout]) => ({
    name: `a section longer than the Free budget is split across canvases when it is ${where}`,
    regression: true,
    async run(mods) {
      const { splitIntoCanvases } = mods.extractor;
      const { FREE_WORD_LIMIT } = mods.constants;
      const full = layout(LONG_SECTION()).join("\n\n\n\n");
      const canvases = splitIntoCanvases(full, FREE_WORD_LIMIT);
      const over = canvases.map(words).filter((n) => n > FREE_WORD_LIMIT);
      assert.deepEqual(over, [], `canvases over ${FREE_WORD_LIMIT} words`);
      assert.equal(words(canvases.join(" ")), words(full), "no words lost");
      // Split between paragraphs, never inside one.
      const paras = new Set(full.split(/\n+/));
      for (const c of canvases) for (const p of c.split(/\n+/)) assert.ok(paras.has(p), `a paragraph was cut: ${p.slice(0, 40)}`);
    },
  })),
  {
    name: "a section split across two Free canvases comes back whole in the download",
    async run(mods) {
      const { splitIntoCanvases } = mods.extractor;
      const { FREE_WORD_LIMIT } = mods.constants;
      const body = [SHORT_SECTION("opening"), LONG_SECTION(), SHORT_SECTION("closing")]
        .map((s, i) => heading(`Section ${i + 1}`) + s.split("\n").map((t) => text(t)).join(""))
        .join("");
      const doc = await open(mods, await buildDocx(body));
      // Revise each canvas on its own, as a user pasting them one at a time would.
      const revised = splitIntoCanvases(doc.out, FREE_WORD_LIMIT)
        .map((c) => c.replace(/^(?=\S)/gm, "Revised "))
        .join("\n\n\n\n");
      const out = await roundTrip(mods, null, revised, doc);
      const lines = doc.out.split("\n").filter((l) => l.trim());
      const done = out.text.split(/\n+/).filter((p) => p.startsWith("Revised ")).length;
      assert.equal(done, lines.length, `${done} of ${lines.length} paragraphs revised`);
    },
  },
  {
    name: "dates and other hyphenated number chains keep their hyphens in the download",
    regression: true,
    async run(mods) {
      const body = heading("Data") + text("The dataset was last updated in the middle of August.") + text("The handbook is the standard reference.");
      const out = await roundTrip(mods, body, "The dataset was last refreshed on 2025-08-16.\nThe handbook (ISBN 978-0-19-852663-6) is the usual reference.");
      assertOnce(out.text, ["The dataset was last refreshed on 2025-08-16.", "The handbook (ISBN 978-0-19-852663-6) is the usual reference."]);
    },
  },
  {
    name: "a numeric range gets an en dash and a spaced hyphen an em dash, as before",
    async run(mods) {
      const body = heading("Timing") + text("Responses took several seconds in most of the trials.") + text("The slow path was rare in practice overall.");
      const out = await roundTrip(mods, body, "Responses took 3 - 5 seconds in 10-20 trials.\nThe slow path - when it ran - was rare.");
      assertOnce(out.text, ["Responses took 3–5 seconds in 10–20 trials.", "The slow path — when it ran — was rare."]);
    },
  },
  {
    name: "the extraction badges put a space before their last word",
    regression: true,
    async run(mods) {
      const body =
        heading("One") + text("A first paragraph with a source (Smith 2020).") +
        heading("Two") + text("A second paragraph.") +
        table([[text("Cell")]]);
      const { pills } = await open(mods, await buildDocx(body));
      const labels = pills.map((p) => p.label);
      for (const want of ["2 headings stripped", "1 table decomposed", "1 citation held"])
        assert.ok(labels.includes(want), `badges read ${JSON.stringify(labels)}`);
    },
  },
  ...WRAPPED.map(([what, build]) => ({
    name: `${what} still gives a document Word can open, with the revision in it`,
    regression: true,
    async run(mods) {
      const body = heading("Results") + para(build((t) => run(t))) + text("A second paragraph closes the section for good measure.");
      const revised = "This sentence replaces the whole first paragraph of the results.\nAnother paragraph now ends the section instead.";
      const out = await roundTrip(mods, body, revised);
      assert.match(out.text, /This sentence replaces the whole first paragraph of the results\./);
    },
  })),
  {
    name: "a bookmark inside a revised paragraph keeps its start as well as its end",
    regression: true,
    async run(mods) {
      const body =
        heading("Method") +
        para(`${run("Forty firms were surveyed ")}<w:bookmarkStart w:id="7" w:name="Survey"/>${run("across three states in total.")}<w:bookmarkEnd w:id="7"/>`) +
        text("Most of them reported at least one incident.");
      const out = await roundTrip(mods, body, "The study covered forty companies in three states.\nMost described at least one breach.");
      assert.match(out.xml, /<w:bookmarkStart w:id="7" w:name="Survey"\/>/);
      assert.match(out.xml, /<w:bookmarkEnd w:id="7"\/>/);
      assert.match(out.text, /The study covered forty companies in three states\./);
    },
  },
  {
    name: "a paragraph holding a text box is left well-formed",
    async run(mods) {
      const box = `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>${text("Boxed note text here.")}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`;
      const body = heading("Intro") + para(run("The main paragraph sits beside a box. ") + box) + text("A second paragraph closes the section.");
      await roundTrip(mods, body, "The principal paragraph is next to a box.\nAnother paragraph ends the section.");
    },
  },
  {
    name: "Word's self-closing empty paragraph does not swallow the one after it",
    async run(mods) {
      const body = heading("Intro") + '<w:p w:rsidR="00A1"/>' + text("The survey covered forty firms in three states.") + text("Most reported at least one incident.");
      const out = await roundTrip(mods, body, "The study examined forty companies across three states.\nMost described at least one breach.");
      assert.match(out.text, /The study examined forty companies across three states\.\s+Most described at least one breach\./);
    },
  },
  {
    name: "every script the page loads comes from the project, not a CDN",
    regression: true,
    async run(mods) {
      const html = read(mods, "index.html");
      const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
      const lazy = [...read(mods, "js/app.js").matchAll(/loadScript\(\s*"([^"]+)"/g)].map((m) => m[1]);
      assert.ok(tags.length >= 2 && lazy.length >= 1, "found the page's script references");
      for (const src of [...tags, ...lazy]) {
        assert.doesNotMatch(src, /^(https?:)?\/\//, `${src} is fetched from another origin`);
        assert.ok(fs.existsSync(path.join(mods.root, src)), `${src} is missing from the project`);
      }
    },
  },
];
