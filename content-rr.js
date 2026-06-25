(function () {
  var STORAGE_KEY = "WN_SCRAPE";

  function getState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function createBadge() {
    var existing = document.getElementById("wn-scraper-badge");
    if (existing) return existing;
    var badge = document.createElement("div");
    badge.id = "wn-scraper-badge";
    badge.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:999999;" +
      "background:linear-gradient(90deg,#1a1a2e,#16213e);color:#a8b4ff;" +
      "font-family:-apple-system,system-ui,sans-serif;font-size:13px;font-weight:600;" +
      "padding:8px 16px;text-align:center;border-bottom:2px solid #34d399;" +
      "box-shadow:0 2px 8px rgba(0,0,0,0.3);";
    document.body.appendChild(badge);
    return badge;
  }

  function updateBadge(text) {
    createBadge().textContent = text;
  }

  function removeBadge() {
    var badge = document.getElementById("wn-scraper-badge");
    if (badge) badge.remove();
  }

  function getChapterContent() {
    var contentDiv = document.querySelector(".chapter-inner.chapter-content");
    if (!contentDiv) return null;
    var paragraphs = contentDiv.querySelectorAll("p");
    var texts = [];
    for (var i = 0; i < paragraphs.length; i++) {
      var t = paragraphs[i].textContent.trim();
      if (t) texts.push(t);
    }
    return texts.length > 0 ? texts.join("\n\n") : null;
  }

  function getChapterTitle() {
    var h1 = document.querySelector("h1");
    return h1 ? h1.textContent.trim() : null;
  }

  function getBookTitle() {
    var title = document.title.replace(/ \| Royal Road$/, "");
    var dashIdx = title.indexOf(" - ");
    return dashIdx !== -1 ? title.substring(dashIdx + 3) : title;
  }

  function getNextChapterUrl() {
    var btns = document.querySelectorAll('.btn-primary[href*="/chapter/"]');
    for (var i = 0; i < btns.length; i++) {
      if (/next/i.test(btns[i].textContent)) return btns[i].href;
    }
    return null;
  }

  function getChapterIdFromUrl() {
    var parts = window.location.pathname.split("/chapter/");
    if (parts.length < 2) return null;
    return parts[1].split("/")[0];
  }

  var contentDiv = document.querySelector(".chapter-inner.chapter-content");
  if (!contentDiv) return;

  var state = getState();

  if (!state.active) {
    removeBadge();
    return;
  }

  if (!state.sessionId || !state.sessionStartedAt) {
    console.log("[RR-Scraper] No session — not auto-starting.");
    state.active = false;
    saveState(state);
    removeBadge();
    return;
  }

  var elapsed = Date.now() - state.sessionStartedAt;
  if (elapsed > 5 * 60 * 60 * 1000) {
    console.log("[RR-Scraper] Session expired — stopping.");
    state.active = false;
    state.stoppedReason = "expired";
    saveState(state);
    removeBadge();
    return;
  }

  var chapterId = getChapterIdFromUrl();
  var delay = state.delayMs || 2500;

  if (state.lastProcessed === chapterId) {
    console.log("[RR-Scraper] Already processed this chapter.");
    return;
  }

  var chapterTitle = getChapterTitle() || "Chapter";
  var bookTitle = getBookTitle();

  state.bookName = bookTitle || state.bookName;
  state.site = "royalroad";

  var text = getChapterContent();

  if (!text) {
    console.log("[RR-Scraper] No chapter content found. Stopping.");
    state.active = false;
    state.stoppedReason = "locked";
    state.lockedAt = chapterTitle;
    state.readyToDownload = true;
    saveState(state);
    updateBadge("Stopped at " + chapterTitle + " (no content) — " +
      (state.chapters ? state.chapters.length : 0) + " chapters collected");
    return;
  }

  if (!state.chapters) state.chapters = [];
  if (!state.chapterIndices) state.chapterIndices = [];

  var chapterIndex = state.chapterIndices.length + 1;
  var isNew = state.chapterIndices.indexOf(chapterId) === -1;
  if (!isNew) {
    console.log("[RR-Scraper] " + chapterTitle + " already collected — skipping.");
    chapterIndex = state.chapterIndices.indexOf(chapterId) + 1;
  } else {
    var entry = chapterTitle + "\n\n" + text;
    state.chapters.push(entry);
    state.chapterIndices.push(chapterId);
    chapterIndex = state.chapterIndices.length;

    if (state.downloadMode === "perchapter") {
      var safeName = (state.bookName || "chapter").replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "_");
      var safeTitle = chapterTitle.replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "_");
      var padded = String(chapterIndex).padStart(3, "0");
      var fname = safeName + "_" + padded + "_" + safeTitle + ".txt";
      chrome.runtime.sendMessage({
        action: "download",
        text: chapterTitle + "\n\n" + text,
        filename: fname,
      });
    }
  }

  state.lastProcessed = chapterId;
  state.currentChapter = chapterIndex;
  state.currentName = chapterTitle;
  saveState(state);

  updateBadge("Collecting " + chapterTitle +
    " (" + state.chapters.length + " saved)");

  console.log("[RR-Scraper] " + chapterTitle +
    " (" + state.chapters.length + " total, " + text.length + " chars)");

  var nextUrl = getNextChapterUrl();
  if (nextUrl) {
    console.log("[RR-Scraper] Next in " + (delay / 1000) + "s...");
    setTimeout(function () {
      window.location.href = nextUrl;
    }, delay);
  } else {
    console.log("[RR-Scraper] Complete! " + state.chapters.length + " chapters.");
    state.active = false;
    state.stoppedReason = "complete";
    state.readyToDownload = true;
    saveState(state);
    updateBadge("Complete! " + state.chapters.length + " chapters collected.");
  }
})();
