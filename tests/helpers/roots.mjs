// The two copies of the app a test can run against: this working tree, and
// the code as it stood before the 2026-09-30 cleanup, fetched from git.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// The last commit before the cleanup. Every test marked `regression` is
// required to fail against it, which is what shows the test can see the bug.
export const ORIGINAL = "6f06d5a659aa058f6d1802e944b6fd3ea1e8f311";

/** Directory holding the original index.html, css/ and js/, or null when git
 *  or the commit is unavailable (a tarball download, a shallow clone). */
export function originalRoot() {
  const dir = path.join(os.tmpdir(), `magic-rewrite-original-${ORIGINAL.slice(0, 12)}`);
  if (fs.existsSync(path.join(dir, ".complete"))) return dir;
  let files;
  try {
    files = git("ls-tree", "-r", "--name-only", ORIGINAL, "--", "index.html", "css", "js")
      .toString()
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
  // Built beside the target and renamed into place, so two test files
  // starting at once cannot see a half-written copy.
  const tmp = fs.mkdtempSync(dir + "-");
  for (const f of files) {
    const out = path.join(tmp, f);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, git("show", `${ORIGINAL}:${f}`));
  }
  fs.writeFileSync(path.join(tmp, ".complete"), "");
  try {
    fs.renameSync(tmp, dir);
  } catch {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return dir;
}

function git(...args) {
  return execFileSync("git", ["-C", ROOT, ...args], { stdio: ["ignore", "pipe", "ignore"] });
}

/** Import the app's modules from a root. Preview code needs DOMParser and
 *  Node as globals; see dom.mjs. */
export async function loadModules(root) {
  const load = (f) => import(pathToFileURL(path.join(root, "js", "modules", f)).href);
  return {
    root,
    extractor: await load("extractor.js"),
    writer: await load("docx-writer.js"),
    preview: await load("preview.js"),
    helpers: await load("mammoth-helpers.js"),
    alignment: await load("alignment.js"),
    footnotes: await load("footnotes.js"),
    constants: await load("constants.js"),
  };
}
