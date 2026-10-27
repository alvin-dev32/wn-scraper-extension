(function () {
  const KEY = "WN_SCRAPE";
  const reader = globalThis.FreeWebNovel;

  function getState() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
    catch { return {}; }
  }

  function badge(text) {
    let el = document.getElementById("wn-scraper-badge");
    if (!el) {
      el = document.createElement("div");
      el.id = "wn-scraper-badge";
      el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:999999;background:#1a1a2e;color:#a8b4ff;padding:8px 16px;text-align:center;font:600 13px system-ui;border-bottom:2px solid #34d399";
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch {
      badge("Storage full — collection paused. Save your chapters, then Reset.");
      return false;
    }
  }

  function stop(state, reason, message) {
    state.active = false;
    state.stoppedReason = reason;
    state.readyToDownload = !!state.chapters?.length;
    save(state);
    badge(message);
  }

  function run(attempts) {
    const state = getState();
    if (!state.active) return;
    if (!state.sessionId || !state.sessionStartedAt || Date.now() - state.sessionStartedAt > 5 * 60 * 60 * 1000) {
      stop(state, "expired", "Session expired — click Start to resume.");
      return;
    }
    const info = reader.getPageInfo(document, location.href);
    if (!info || info.isBookPage || !info.hasContent || !reader.getChapterText(document)) {
      if (attempts < 20) setTimeout(() => run(attempts + 1), 500);
      else stop(state, "missing-content", "No chapter content found — collection paused.");
      return;
    }
    if (state.site !== "freewebnovel" || state.bookId !== info.bookId) {
      stop(state, "different-book", "Different book — click Start to collect this book.");
      return;
    }

    state.bookName = info.bookName;
    state.chapters ||= [];
    state.chapterIndices ||= [];
    const entry = info.chapterName + "\n\n" + reader.getChapterText(document);
    const isNew = !state.chapterIndices.includes(info.chapterId);
    if (isNew) {
      state.chapters.push(entry);
      state.chapterIndices.push(info.chapterId);
    }
    state.lastProcessed = info.chapterId;
    state.currentChapter = info.chapterIndex || state.chapterIndices.indexOf(info.chapterId) + 1;
    state.currentName = info.chapterName;
    if (!save(state)) return;

    if (isNew && state.downloadMode === "perchapter") {
      const safe = text => text.replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "_");
      chrome.runtime.sendMessage({
        action: "download", text: entry,
        filename: safe(state.bookName) + "_" + String(state.currentChapter).padStart(3, "0") + "_" + safe(info.chapterName) + ".txt",
      });
    }

    const next = reader.getNextChapterUrl(document, location.href);
    if (!next) {
      stop(state, "complete", "Complete! " + state.chapters.length + " chapters collected.");
      return;
    }
    if (state.chapterIndices.includes(new URL(next).pathname)) {
      // Previously collected chapters can be traversed when restarting from Ch 1.
      // The per-run visited list distinguishes those from a navigation loop.
      if (state.visitedChapterIds?.includes(new URL(next).pathname)) {
        stop(state, "navigation-loop", "Chapter navigation loop detected — collection paused.");
        return;
      }
    }
    state.visitedChapterIds ||= [];
    if (!state.visitedChapterIds.includes(info.chapterId)) state.visitedChapterIds.push(info.chapterId);
    if (!save(state)) return;
    badge("Collecting " + info.chapterName + " (" + state.chapters.length + " saved)");
    setTimeout(() => {
      // Stop/Reset or a new session must cancel an already scheduled navigation.
      const latest = getState();
      if (latest.active && latest.sessionId === state.sessionId) location.href = next;
    }, state.delayMs || 2500);
  }

  if (reader && getState().active) run(0);
})();
