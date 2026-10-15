// Runs the real page - index.html, its scripts, app.js and every module -
// in jsdom, and drives it the way a person would. One app per process:
// ui.js binds to `document` when it is imported, so a second copy cannot
// share the globals. app.test.mjs and app-original.test.mjs each start one.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole, requestInterceptor } from "jsdom";

const require = createRequire(import.meta.url);
const ORIGIN = "http://localhost/";

// The original page loaded mammoth and JSZip from cdnjs. Those requests are
// answered with the pinned npm builds, so no test touches the network.
const CDN = [
  [/\/mammoth\.browser\.min\.js$/, () => require.resolve("mammoth/mammoth.browser.min.js")],
  [/\/jszip\.min\.js$/, () => require.resolve("jszip/dist/jszip.min.js")],
];

function serve(root) {
  return requestInterceptor((request) => {
    const url = request.url;
    let file = null;
    if (url.startsWith(ORIGIN)) file = path.join(root, decodeURIComponent(url.slice(ORIGIN.length)));
    else for (const [re, where] of CDN) if (re.test(url)) file = where();
    // The Nunito webfont: the stylesheet falls back to system fonts without it.
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url))
      return new Response("", { headers: { "Content-Type": "text/css" } });
    if (!file || !fs.existsSync(file)) return new Response("", { status: 404 });
    const type = file.endsWith(".css") ? "text/css" : "application/javascript";
    return new Response(fs.readFileSync(file), { headers: { "Content-Type": type } });
  });
}

export async function startApp(root) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e));
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), {
    url: ORIGIN,
    runScripts: "dangerously",
    resources: { interceptors: [serve(root)] },
    pretendToBeVisual: true,
    virtualConsole,
  });
  const w = dom.window;
  await new Promise((resolve) => w.addEventListener("load", resolve));

  // jsdom has no layout: innerText falls back to textContent, and images
  // never finish loading, which would stall processFile's size freeze.
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
    configurable: true,
  });
  Object.defineProperty(w.HTMLImageElement.prototype, "complete", { get: () => true, configurable: true });
  // JSZip's bundled setImmediate polyfill posts a message to the window and
  // waits for one whose `source` is the window; jsdom's postMessage leaves
  // `source` null, so every JSZip operation would wait for ever. A real
  // setImmediate stops it installing the polyfill.
  w.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);

  for (const k of ["window", "document", "Node", "DOMParser", "requestAnimationFrame", "navigator"])
    Object.defineProperty(globalThis, k, { value: k === "window" ? w : w[k], configurable: true, writable: true });
  // Scripts the page loads define these on its window; app.js reads them as
  // bare globals.
  for (const k of ["mammoth", "JSZip"])
    Object.defineProperty(globalThis, k, { get: () => w[k], configurable: true });

  const downloads = [];
  URL.createObjectURL = (blob) => {
    downloads.push({ blob });
    return "blob:download";
  };
  URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.at(-1).name = this.download;
  };
  // Keep the app's console.error (a failed open) out of the test output.
  const logged = [];
  console.error = (...args) => logged.push(args);

  const js = (f) => import(pathToFileURL(path.join(root, "js", f)).href);
  await js("app.js");
  const { state } = await js("modules/state.js");

  const $ = (id) => w.document.getElementById(id);
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  async function until(what, fn, ms = 10000) {
    const t = Date.now();
    while (!fn()) {
      if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`);
      await tick();
    }
  }

  const app = {
    root,
    window: w,
    state,
    $,
    logged,
    errors,
    until,
    /** Choose a file with the Open button's file input. */
    async open(buf, name) {
      const file = new w.File([buf], name);
      Object.defineProperty($("fileInp"), "files", { value: [file], configurable: true });
      $("fileInp").dispatchEvent(new w.Event("change"));
      await tick();
      await until("the document to load", () => $("loadOv").style.display === "none");
    },
    click(id) {
      $(id).click();
    },
    /** The Revise tab's paste canvases. */
    canvases: () => [...$("humanizedWS").querySelectorAll(".humanized-content")],
    /** Paste text into Revise canvas `idx`. */
    paste(idx, text) {
      const el = app.canvases()[idx];
      el.textContent = text;
      el.dispatchEvent(new w.Event("input"));
    },
    /** Press Download and return the file it produced. */
    async download() {
      const before = downloads.length;
      $("downloadHumanizedBtn").click();
      await until("the download", () => downloads.length > before && downloads.at(-1).name);
      const { blob, name } = downloads.at(-1);
      return { name, buf: Buffer.from(await blob.arrayBuffer()) };
    },
    /** Close whatever is open, from whichever tab is showing. */
    close() {
      const btn = state.insertMode ? $("closeBtnInsert") : $("closeBtn");
      if (!btn.disabled) btn.click();
    },
  };
  return app;
}
