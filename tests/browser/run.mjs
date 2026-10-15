// The whole round trip in a real Chrome: open a document, paste a revision,
// press Download, and check the file Chrome produced.
//
//   npm run test:browser          (CHROME=/path/to/chrome to choose one)
//
// jsdom (tests/app.test.mjs) runs the same page, but it is not a browser:
// it has no layout, no real innerText, and needed two workarounds to run
// JSZip at all. This runs the page as a user gets it, served from a
// loopback port with every request to another origin failed - so it also
// shows the page needs nothing from the network.
//
// Chrome is driven over the DevTools protocol with Node's own WebSocket;
// there is no dependency beyond those the other tests use.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import "../helpers/dom.mjs";
import { download, open } from "../helpers/docx.mjs";
import { ROOT, loadModules } from "../helpers/roots.mjs";

const CHROMES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function launch(exe) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "magic-rewrite-chrome-"));
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(50);
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const close = () => {
    ws.close();
    proc.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
  };
  return { send, on: (l) => listeners.push(l), close };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`ok   ${name}`);
  } catch (e) {
    results.push(false);
    console.log(`FAIL ${name}\n     ${e.message.split("\n").join("\n     ")}`);
  }
}

// Like the archive's other browser suites: no browser is a skip, not a failure.
const exe = CHROMES.find((p) => fs.existsSync(p));
if (!exe) {
  console.log("SKIP: no Chrome found; set CHROME to its path");
  process.exit(0);
}

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = await launch(exe);
const { send } = chrome;

// Fail every request that leaves the loopback server, and note it.
const foreign = [];
chrome.on((msg) => {
  if (msg.method !== "Fetch.requestPaused") return;
  const { requestId, request } = msg.params;
  if (request.url.startsWith(origin)) send("Fetch.continueRequest", { requestId });
  else {
    foreign.push(request.url);
    send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
  }
});
const errors = [];
chrome.on((msg) => {
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
});
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
await send("Runtime.enable");

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(what, expression, ms = 20000) {
  const t = Date.now();
  while (!(await evaluate(expression))) {
    if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

async function load() {
  await send("Page.navigate", { url: `${origin}/index.html` });
  await until("the page", `document.readyState === "complete" && typeof mammoth === "object" && !!document.getElementById("fileInp").onchange`);
  // Capture what Download hands to the browser instead of saving it.
  await evaluate(`window.__saved = []; URL.createObjectURL = (b) => { window.__saved.push(b); return "blob:x"; }; HTMLAnchorElement.prototype.click = function () { window.__savedName = this.download; }; true`);
}

async function roundTrip(fixture, name, revise) {
  const buf = fs.readFileSync(path.join(ROOT, "tests/scenarios", fixture));
  await evaluate(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(buf.toString("base64"))}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], ${JSON.stringify(name)}));
    const inp = document.getElementById("fileInp");
    inp.files = dt.files;
    inp.dispatchEvent(new Event("change"));
    return true;
  })()`);
  await until("extraction", `document.getElementById("insertTab").classList.contains("ready") && document.getElementById("loadOv").style.display === "none"`);
  const canvases = await evaluate(`[...document.querySelectorAll("#rpWS .rp-content")].map((e) => e.innerText)`);
  const revised = canvases.map(revise);
  await evaluate(`(() => {
    document.getElementById("insertTab").click();
    const texts = ${JSON.stringify(revised)};
    document.querySelectorAll("#humanizedWS .humanized-content").forEach((el, i) => {
      el.innerText = texts[i];
      el.dispatchEvent(new Event("input"));
    });
    return true;
  })()`);
  await until("Download to be enabled", `!document.getElementById("downloadHumanizedBtn").disabled`);
  await evaluate(`window.__saved = []; document.getElementById("downloadHumanizedBtn").click(); true`);
  await until("the download", `window.__saved.length > 0`);
  const b64 = await evaluate(`window.__saved[0].arrayBuffer().then((a) => { let s = ""; const u = new Uint8Array(a); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); })`);
  const out = Buffer.from(b64, "base64");
  const savedName = await evaluate(`window.__savedName`);
  await evaluate(`document.getElementById("closeBtnInsert").click(); true`);
  return { buf, out, savedName, canvases, revised: revised.join("\n\n\n\n") };
}

const mods = await loadModules(ROOT);
const xmlOf = async (buf) => (await JSZip.loadAsync(buf)).file("word/document.xml").async("string");

try {
  await load();

  await check("the page loads its libraries with every other origin cut off", async () => {
    assert.equal(await evaluate(`typeof mammoth.convertToHtml`), "function");
    assert.deepEqual(foreign.filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  });

  const baseline = await roundTrip("01-baseline-full-revision/input.docx", "baseline.docx", () =>
    fs.readFileSync(path.join(ROOT, "tests/scenarios/01-baseline-full-revision/revised.txt"), "utf8"),
  );
  await check("Download saves under the revised file name", () => assert.equal(baseline.savedName, "baseline_revised.docx"));
  await check("Chrome's file has exactly the document.xml the pipeline produces", async () => {
    const expected = await download(mods, await open(mods, baseline.buf), baseline.revised);
    assert.ok((await xmlOf(baseline.out)) === expected.xml, "Chrome and the pipeline disagree");
  });

  const reference = await roundTrip("12-citations-and-references/input.docx", "reference.docx", (c) => c.replace(/^(?=\S)/gm, "Revised "));
  await check("on the reference document every cited paragraph comes back revised", async () => {
    const paras = (await mammoth.extractRawText({ buffer: reference.out })).value.split(/\n+/);
    const cited = paras.filter((p) => /\([A-Z][^()]*\d{4}[a-z]?\)/.test(p));
    assert.ok(cited.length >= 12, `${cited.length} cited paragraphs`);
    assert.deepEqual(cited.filter((p) => !p.startsWith("Revised ")), []);
  });
  await check("Chrome's extracted text is the pipeline's", async () => {
    const doc = await open(mods, reference.buf);
    assert.equal(reference.canvases.join("\n\n\n\n"), doc.out);
  });

  // The panes used to drag each other along. The author asked for them to
  // scroll on their own, so scrolling one must leave the other where it is.
  await check("each pane scrolls on its own, on both tabs", async () => {
    const buf = fs.readFileSync(path.join(ROOT, "tests/scenarios/12-citations-and-references/input.docx"));
    await evaluate(`(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(buf.toString("base64"))}), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "panes.docx"));
      const inp = document.getElementById("fileInp");
      inp.files = dt.files;
      inp.dispatchEvent(new Event("change"));
      return true;
    })()`);
    await until("extraction", `document.getElementById("insertTab").classList.contains("ready") && document.getElementById("loadOv").style.display === "none"`);
    const scrollOne = (from, to) => evaluate(`(async () => {
      const a = document.getElementById("${from}"), b = document.getElementById("${to}");
      b.scrollTop = 0;
      a.scrollTop = 400;
      a.dispatchEvent(new Event("scroll"));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { moved: a.scrollTop, other: b.scrollTop, otherCanScroll: b.scrollHeight > b.clientHeight };
    })()`);
    const file = await scrollOne("docWS", "rpWS");
    assert.ok(file.moved > 0 && file.otherCanScroll, "the File tab's panes are not scrollable here");
    assert.equal(file.other, 0, "scrolling the document moved the extracted text");

    await evaluate(`(() => {
      document.getElementById("insertTab").click();
      const texts = [...document.querySelectorAll("#rpWS .rp-content")].map((e) => e.innerText);
      document.querySelectorAll("#humanizedWS .humanized-content").forEach((el, i) => {
        el.innerText = texts[i];
        el.dispatchEvent(new Event("input"));
      });
      return true;
    })()`);
    await until("the revised preview", `!document.getElementById("downloadHumanizedBtn").disabled`);
    const insert = await scrollOne("humanizedWS", "humanizedDocWS");
    assert.ok(insert.moved > 0 && insert.otherCanScroll, "the Insert tab's panes are not scrollable here");
    assert.equal(insert.other, 0, "scrolling the revised text moved the preview");
    await evaluate(`document.getElementById("closeBtnInsert").click(); true`);
  });

  await check("the page threw no script errors", () => assert.deepEqual(errors, []));
} finally {
  chrome.close();
  server.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
