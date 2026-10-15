// Cases that drive the real page, run by app.test.mjs against this tree and
// by app-original.test.mjs against the original. Same rule as cases.mjs:
// `regression` cases must fail against the original, the rest must pass.
// They share one app, in order, and each starts by closing the document.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import { download, open } from "./helpers/docx.mjs";
import { ROOT, loadModules } from "./helpers/roots.mjs";

const fixture = (f) => fs.readFileSync(path.join(ROOT, "tests/scenarios", f));
// 4,096 extracted words: one canvas on Paid, five on Free.
const REFERENCE = fixture("12-citations-and-references/input.docx");
const LISTS = fixture("05-lists/input.docx");

const EMPTY_PREVIEW = /The document preview will appear here/;
const textOf = async (buf) => (await mammoth.extractRawText({ buffer: buf })).value;

export const appCases = [
  {
    name: "Download writes exactly the document.xml the pipeline produces for the same paste",
    async run(app) {
      const mods = await loadModules(app.root);
      const buf = fixture("01-baseline-full-revision/input.docx");
      const revised = fixture("01-baseline-full-revision/revised.txt").toString("utf8");
      await app.open(buf, "baseline.docx");
      app.click("insertTab");
      assert.equal(app.canvases().length, 1);
      app.paste(0, revised);
      assert.equal(app.$("downloadHumanizedBtn").disabled, false);
      const file = await app.download();
      assert.equal(file.name, "baseline_revised.docx");
      const written = await (await JSZip.loadAsync(file.buf)).file("word/document.xml").async("string");
      const expected = await download(mods, await open(mods, buf), revised);
      assert.ok(written === expected.xml, "the page and the pipeline disagree about document.xml");
      assert.notEqual(written, expected.inputXml, "and it is a revision, not the original");
    },
  },
  {
    name: "on the reference document every paragraph, cited or not, is revised in the downloaded file",
    regression: true,
    async run(app) {
      await app.open(REFERENCE, "reference.docx");
      app.click("insertTab");
      app.state.canvasTexts.forEach((c, i) => app.paste(i, c.replace(/^(?=\S)/gm, "Revised ")));
      const out = (await textOf((await app.download()).buf)).split(/\n+/);
      const cited = out.filter((p) => /\([A-Z][^()]*\d{4}[a-z]?\)/.test(p));
      assert.ok(cited.length >= 12, `${cited.length} cited paragraphs found`);
      const unrevised = cited.filter((p) => !p.startsWith("Revised "));
      assert.deepEqual(unrevised, [], "cited paragraphs left with their original wording");
    },
  },
  {
    name: "switching to Free on the File tab after pasting leaves the Revise tab matching the new canvases",
    regression: true,
    async run(app) {
      await app.open(REFERENCE, "reference.docx");
      app.click("insertTab");
      app.paste(0, app.state.canvasTexts[0].replace(/^(?=\S)/gm, "Revised "));
      app.click("fileTab");
      app.click("freeAcctBtn");
      app.click("insertTab");
      try {
        const shown = app.canvases();
        assert.equal(app.state.canvasTexts.length, 5);
        assert.equal(shown.length, app.state.canvasTexts.length, "one paste canvas per extracted canvas");
        assert.deepEqual(shown.map((c) => c.textContent), app.state.revisedTexts, "what is shown is what is stored");
        assert.equal(app.$("downloadHumanizedBtn").disabled, true, "Download must not offer a file it cannot write");
      } finally {
        app.click("paidAcctBtn");
      }
    },
  },
  {
    name: "switching to Free on the Revise tab gives one empty paste canvas per new canvas",
    async run(app) {
      await app.open(REFERENCE, "reference.docx");
      app.click("insertTab");
      app.paste(0, "Some revised text.");
      app.click("freeAcctBtn");
      try {
        assert.equal(app.canvases().length, 5);
        assert.ok(app.canvases().every((c) => !c.textContent));
        assert.equal(app.$("downloadHumanizedBtn").disabled, true);
      } finally {
        app.click("paidAcctBtn");
      }
    },
  },
  {
    name: "Re-extract on the File tab after pasting leaves the Revise tab matching what is stored",
    regression: true,
    async run(app) {
      await app.open(LISTS, "lists.docx");
      app.click("insertTab");
      app.paste(0, "A revision that Re-extract is about to discard.");
      app.click("fileTab");
      app.click("reextBtn");
      await new Promise((r) => setTimeout(r, 50));
      await app.until("re-extraction", () => app.$("loadOv").style.display === "none");
      app.click("insertTab");
      assert.deepEqual(app.canvases().map((c) => c.textContent), app.state.revisedTexts);
      assert.equal(app.$("downloadHumanizedBtn").disabled, true);
    },
  },
  {
    name: "opening a second document clears the first one's revision and preview",
    regression: true,
    async run(app) {
      await app.open(REFERENCE, "first.docx");
      app.click("insertTab");
      app.paste(0, "A revision meant for the first document only.");
      app.click("fileTab");
      await app.open(LISTS, "second.docx");
      app.click("insertTab");
      assert.deepEqual(app.canvases().map((c) => c.textContent), app.state.revisedTexts);
      assert.ok(app.canvases().every((c) => !c.textContent), "no text left over from the first document");
      assert.match(app.$("humanizedDocHtml").textContent, EMPTY_PREVIEW);
      assert.equal(app.$("downloadHumanizedBtn").disabled, true);
    },
  },
  {
    name: "a file that cannot be read leaves the document that was open as it was",
    regression: true,
    async run(app) {
      await app.open(LISTS, "good.docx");
      const extracted = app.state.curExtracted;
      await app.open(Buffer.from("this is not a zip archive"), "broken.docx");
      assert.equal(app.state.curFile.name, "good.docx", "the file Download would read");
      assert.equal(app.state.curExtracted, extracted);
      assert.equal(app.$("tbTitle").textContent, "Document - good.docx");
    },
  },
  {
    name: "a file that cannot be read, with nothing open, leaves nothing open",
    regression: true,
    async run(app) {
      await app.open(Buffer.from("this is not a zip archive"), "broken.docx");
      assert.equal(app.state.curFile, null);
      assert.equal(app.$("tbTitle").textContent, "Magic ReWrite");
      app.click("insertTab");
      assert.equal(app.state.insertMode, false, "the Revise tab stays shut with no document");
    },
  },
];
