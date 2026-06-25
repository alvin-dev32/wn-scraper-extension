(function () {
  // ISOLATED world: relay per-chapter downloads from MAIN world to background
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === "WN_SCRAPER_DOWNLOAD") {
      chrome.runtime.sendMessage({
        action: "download",
        text: event.data.text,
        filename: event.data.filename,
      });
    }
  });

  // MAIN world scraper — injected via <script> tag
  const scraperCode = function () {
    var STORAGE_KEY = "WN_SCRAPE";

    function getState() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
      catch (e) { return {}; }
    }

    function saveState(state) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function htmlToText(html) {
      var div = document.createElement("div");
      div.innerHTML = html;
      return div.textContent.trim();
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

    function waitForChapInfo(callback, attempts) {
      if (typeof chapInfo !== "undefined" && chapInfo && chapInfo.chapterInfo) {
        callback();
      } else if (attempts < 30) {
        setTimeout(function() { waitForChapInfo(callback, attempts + 1); }, 500);
      } else {
        console.log("[WN-Scraper] chapInfo not found");
      }
    }

    waitForChapInfo(function () {
      var state = getState();

      if (!state.active) {
        removeBadge();
        return;
      }

      if (!state.sessionId || !state.sessionStartedAt) {
        console.log("[WN-Scraper] No session — not auto-starting.");
        state.active = false;
        saveState(state);
        removeBadge();
        return;
      }

      var elapsed = Date.now() - state.sessionStartedAt;
      if (elapsed > 5 * 60 * 60 * 1000) {
        console.log("[WN-Scraper] Session expired — stopping.");
        state.active = false;
        state.stoppedReason = "expired";
        saveState(state);
        removeBadge();
        return;
      }

      var ci = chapInfo.chapterInfo;
      var bi = chapInfo.bookInfo;
      var delay = state.delayMs || 2500;

      if (state.lastProcessed === ci.chapterId) {
        console.log("[WN-Scraper] Already processed this chapter.");
        return;
      }

      state.bookName = bi.bookName || state.bookName;
      state.bookId = bi.bookId || state.bookId;
      state.totalChapters = bi.totalChapterNum || state.totalChapters;

      if (!ci.contents || !ci.contents.length) {
        console.log("[WN-Scraper] Ch" + ci.chapterIndex + " locked. Stopping.");
        state.active = false;
        state.stoppedReason = "locked";
        state.lockedAt = ci.chapterIndex;
        state.readyToDownload = true;
        saveState(state);
        updateBadge("Stopped at Ch " + ci.chapterIndex + " (locked) — " +
          (state.chapters ? state.chapters.length : 0) + " chapters collected");
        return;
      }

      var text = ci.contents
        .map(function(c) { return htmlToText(c.content); })
        .filter(function(t) { return t; })
        .join("\n\n");

      if (!state.chapters) state.chapters = [];
      if (!state.chapterIndices) state.chapterIndices = [];

      var isNew = state.chapterIndices.indexOf(ci.chapterIndex) === -1;
      if (!isNew) {
        console.log("[WN-Scraper] Ch" + ci.chapterIndex + " already collected — skipping.");
      } else {
        var entry = "Chapter " + ci.chapterIndex + ": " + ci.chapterName + "\n\n" + text;
        state.chapters.push(entry);
        state.chapterIndices.push(ci.chapterIndex);

        if (state.downloadMode === "perchapter") {
          var safeName = (bi.bookName || "chapter").replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "_");
          var safeTitle = ci.chapterName.replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "_");
          var padded = String(ci.chapterIndex).padStart(3, "0");
          var fname = safeName + "_" + padded + "_" + safeTitle + ".txt";
          window.postMessage({
            type: "WN_SCRAPER_DOWNLOAD",
            text: entry,
            filename: fname,
          }, "*");
        }
      }

      state.lastProcessed = ci.chapterId;
      state.currentChapter = ci.chapterIndex;
      state.currentName = ci.chapterName;
      saveState(state);

      var total = state.totalChapters || "?";
      updateBadge("Collecting Ch " + ci.chapterIndex + "/" + total +
        ": " + ci.chapterName + " (" + state.chapters.length + " saved)");

      console.log("[WN-Scraper] Ch" + ci.chapterIndex + ": " + ci.chapterName +
        " (" + state.chapters.length + " total, " + text.length + " chars)");

      if (ci.nextChapterId && ci.nextChapterId !== "-1") {
        console.log("[WN-Scraper] Next in " + (delay / 1000) + "s...");
        setTimeout(function() {
          window.location.href = "/book/" + bi.bookId + "/" + ci.nextChapterId;
        }, delay);
      } else {
        console.log("[WN-Scraper] Complete! " + state.chapters.length + " chapters.");
        state.active = false;
        state.stoppedReason = "complete";
        state.readyToDownload = true;
        saveState(state);
        updateBadge("Complete! " + state.chapters.length + " chapters collected.");
      }
    }, 0);
  };

  var script = document.createElement("script");
  script.textContent = "(" + scraperCode.toString() + ")();";
  var existingScript = document.querySelector("script[nonce]");
  if (existingScript) {
    script.nonce = existingScript.nonce || existingScript.getAttribute("nonce");
  }
  (document.head || document.documentElement).appendChild(script);
  script.remove();
})();
