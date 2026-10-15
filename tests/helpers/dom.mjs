// preview.js and footnotes.js run against the browser's DOMParser and Node.
import { JSDOM } from "jsdom";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;
globalThis.Node = window.Node;
