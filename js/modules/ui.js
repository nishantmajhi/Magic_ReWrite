"use strict";

/* ═══════════════════════════════════════════════
     DOM REFS
  ═══════════════════════════════════════════════ */
export const fileInp         = document.getElementById("fileInp");
export const openBtn         = document.getElementById("openBtn");
export const ovOpenBtn       = document.getElementById("ovOpenBtn");
export const reextBtn        = document.getElementById("reextBtn");
export const closeBtn        = document.getElementById("closeBtn");
export const recombineBtn    = document.getElementById("recombineBtn");
export const closeBtnInsert  = document.getElementById("closeBtnInsert");
export const freeAcctBtn     = document.getElementById("freeAcctBtn");
export const paidAcctBtn     = document.getElementById("paidAcctBtn");
export const docHTML         = document.getElementById("docHTML");
export const docNotesPage    = document.getElementById("docNotesPage");
export const docNotesHtml    = document.getElementById("docNotesHtml");
export const initOv          = document.getElementById("initOv");
export const loadOv          = document.getElementById("loadOv");
export const loadMsg         = document.getElementById("loadMsg");
export const rpTitle         = document.getElementById("rpTitle");
export const rpBadges        = document.getElementById("rpBadges");
export const rpWS            = document.getElementById("rpWS");
export const tbTitle         = document.getElementById("tbTitle");
export const lpTitle         = document.getElementById("lpTitle");
export const lpWords         = document.getElementById("lpWords");
export const docWS           = document.getElementById("docWS");
export const leftPane        = document.getElementById("leftPane");
export const fileTab         = document.getElementById("fileTab");
export const insertTab       = document.getElementById("insertTab");
export const ribbonFile      = document.getElementById("ribbonFile");
export const ribbonInsert    = document.getElementById("ribbonInsert");
export const fileHeader      = document.getElementById("fileHeader");
export const insertLeftHeader = document.getElementById("insertLeftHeader");
export const fileDocView     = document.getElementById("fileDocView");
export const insertPasteView = document.getElementById("insertPasteView");
export const fileRightPane   = document.getElementById("fileRightPane");
export const insertRightPane = document.getElementById("insertRightPane");
export const revisedWS     = document.getElementById("humanizedWS");
export const revisedDocHtml = document.getElementById("humanizedDocHtml");
export const revisedDocNotesPage = document.getElementById("humanizedDocNotesPage");
export const revisedDocNotesHtml = document.getElementById("humanizedDocNotesHtml");
export const humanizedDocWS = document.getElementById("humanizedDocWS");
export const downloadBtn     = document.getElementById("downloadHumanizedBtn");
export const revisedWords  = document.getElementById("humanizedWords");
export const insertRpSub     = document.getElementById("insertRpSub");
export const titlebarEl      = document.querySelector(".titlebar");
export const tabrowEl        = document.querySelector(".tabrow");
export const ribbonEl2       = document.getElementById("ribbonEl");
export const ribbonArea      = document.getElementById("ribbonArea");

/* ═══════════════════════════════════════════════
     SVG ICONS
  ═══════════════════════════════════════════════ */
export const COPY_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="5" width="9" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
  <path d="M3 11H2.5A1.5 1.5 0 011 9.5V2.5A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5V3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

/* ═══════════════════════════════════════════════
     UI HELPERS
  ═══════════════════════════════════════════════ */
export function showLoad(msg) {
  loadMsg.textContent = msg;
  loadOv.style.display = "flex";
}

export function hideLoad() {
  loadOv.style.display = "none";
}

export function setTitle(name) {
  tbTitle.textContent = "Document - " + name;
  lpTitle.textContent = name.replace(/\.[^/.]+$/, "");
}

export function revisedFileName(name) {
  return name.replace(/(\.[^.]+)$/, "_revised$1");
}

export function showBadges(pills, nW) {
  rpBadges.innerHTML = pills
    .map((p) => `<span class="badge ${p.cls}">${p.label}</span>`)
    .join("");
  rpTitle.textContent = `Extracted Text - ${nW.toLocaleString()} words`;
}

export function setLpWords(count) {
  lpWords.textContent = count.toLocaleString() + " words";
}

export function setDownloadBtnLabel(icon, label) {
  downloadBtn.innerHTML = `<span class="si">${icon}</span><span class="st">${label}</span>`;
}

/**
 * Copy text to clipboard with a brief visual tick on the button.
 */
export async function doCopy(text, btn, restoreHTML) {
  if (!text) return;
  const orig = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    document.body.removeChild(t);
  }
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  btn.classList.add("ok");
  setTimeout(() => {
    btn.innerHTML = restoreHTML || orig;
    btn.classList.remove("ok");
  }, 2000);
}
