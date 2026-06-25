const STORAGE_KEY = "WN_SCRAPE";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function detectSite(url) {
  if (!url) return null;
  if (url.includes("webnovel.com/book/")) return "webnovel";
  if (url.includes("royalroad.com/fiction/")) return "royalroad";
  return null;
}

async function runInTab(func) {
  const tab = await getActiveTab();
  if (!tab) return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: func,
    });
    return results?.[0]?.result;
  } catch {
    return null;
  }
}

async function runInTabMain(func) {
  const tab = await getActiveTab();
  if (!tab) return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: func,
      world: "MAIN",
    });
    return results?.[0]?.result;
  } catch {
    return null;
  }
}

async function getState() {
  return await runInTab(() => {
    try {
      return JSON.parse(localStorage.getItem("WN_SCRAPE") || "{}");
    } catch {
      return {};
    }
  }) || {};
}

async function getPageInfo() {
  const tab = await getActiveTab();
  const site = detectSite(tab?.url);

  if (site === "webnovel") {
    return await runInTabMain(() => {
      if (typeof chapInfo === "undefined" || !chapInfo) return null;
      return {
        site: "webnovel",
        bookName: chapInfo.bookInfo?.bookName || null,
        bookId: chapInfo.bookInfo?.bookId || null,
        totalChapterNum: chapInfo.bookInfo?.totalChapterNum || null,
        chapterIndex: chapInfo.chapterInfo?.chapterIndex || null,
        chapterName: chapInfo.chapterInfo?.chapterName || null,
        firstChapterId: chapInfo.chapterInfo?.firstChapterId || null,
        chapterId: chapInfo.chapterInfo?.chapterId || null,
      };
    });
  }

  if (site === "royalroad") {
    return await runInTab(() => {
      var contentDiv = document.querySelector(".chapter-inner.chapter-content");
      if (!contentDiv) return null;
      var h1 = document.querySelector("h1");
      var title = document.title.replace(/ \| Royal Road$/, "");
      var dashIdx = title.indexOf(" - ");
      var bookName = dashIdx !== -1 ? title.substring(dashIdx + 3) : title;
      var chapterName = h1 ? h1.textContent.trim() : null;
      var parts = window.location.pathname.split("/chapter/");
      var chapterId = parts.length >= 2 ? parts[1].split("/")[0] : null;
      var nextBtn = document.querySelector('.btn-primary[href*="/chapter/"]');
      return {
        site: "royalroad",
        bookName: bookName,
        chapterName: chapterName,
        chapterId: chapterId,
        hasNext: !!nextBtn,
        nextUrl: nextBtn ? nextBtn.href : null,
        totalChapterNum: null,
        chapterIndex: null,
        firstChapterId: null,
        bookId: null,
      };
    });
  }

  return null;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "_");
}

function generateFilename(bookName) {
  const date = new Date().toISOString().slice(0, 10);
  const name = bookName ? sanitizeFilename(bookName) : "chapters";
  return name + "_" + date + ".txt";
}

const statusEl = document.getElementById("statusText");
const countEl = document.getElementById("chapterCount");
const currentEl = document.getElementById("currentChapter");
const bookNameEl = document.getElementById("bookName");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnSaveAs = document.getElementById("btnSaveAs");
const btnSave = document.getElementById("btnSave");
const btnReset = document.getElementById("btnReset");
const filenameInput = document.getElementById("filenameInput");
const speedSlider = document.getElementById("speedSlider");
const speedLabel = document.getElementById("speedLabel");
const startPrompt = document.getElementById("startPrompt");
const promptText = document.getElementById("promptText");
const btnYes = document.getElementById("btnYes");
const btnNo = document.getElementById("btnNo");
const gotoRow = document.getElementById("gotoRow");
const btnGotoCh1 = document.getElementById("btnGotoCh1");
const siteLabel = document.getElementById("siteLabel");
const modeBulk = document.getElementById("modeBulk");
const modePerChapter = document.getElementById("modePerChapter");

async function refreshUI() {
  const tab = await getActiveTab();
  const site = detectSite(tab?.url);
  const state = await getState();
  const info = await getPageInfo();

  if (siteLabel) {
    if (site === "webnovel") siteLabel.textContent = "webnovel.com";
    else if (site === "royalroad") siteLabel.textContent = "royalroad.com";
    else siteLabel.textContent = "no supported site";
  }

  const count = state.chapters?.length || 0;
  const total = state.totalChapters || info?.totalChapterNum || null;
  countEl.textContent = count + (total ? " / " + total : "");

  const displayBookName = state.bookName || info?.bookName || null;
  bookNameEl.textContent = displayBookName || "—";

  if (state.currentName) {
    currentEl.textContent = state.currentName;
  } else {
    currentEl.textContent = "—";
  }

  if (state.active) {
    statusEl.textContent = "Running";
    statusEl.className = "status-value active";
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else if (state.stoppedReason === "complete") {
    statusEl.textContent = "Complete";
    statusEl.className = "status-value complete";
    btnStart.disabled = false;
    btnStop.disabled = true;
  } else if (state.stoppedReason === "locked") {
    statusEl.textContent = "Stopped — " + (state.lockedAt || "locked");
    statusEl.className = "status-value stopped";
    btnStart.disabled = false;
    btnStop.disabled = true;
  } else if (count > 0) {
    statusEl.textContent = state.stoppedReason === "manual" ? "Stopped" : "Paused";
    statusEl.className = "status-value stopped";
    btnStart.disabled = false;
    btnStop.disabled = true;
  } else {
    statusEl.textContent = "Idle";
    statusEl.className = "status-value idle";
    btnStart.disabled = false;
    btnStop.disabled = true;
  }

  const hasScraped = state.active || count > 0;
  if (hasScraped) {
    btnSaveAs.style.display = "none";
    btnSave.style.display = "";
    btnSave.disabled = count === 0;
  } else {
    btnSaveAs.style.display = "";
    btnSave.style.display = "none";
    btnSaveAs.disabled = count === 0;
  }

  if (!filenameInput.dataset.userEdited) {
    filenameInput.value = generateFilename(displayBookName);
  }

  const delay = state.delayMs ? state.delayMs / 1000 : 2.5;
  speedSlider.value = delay;
  speedLabel.textContent = delay + "s";

  setModeUI(state.downloadMode === "perchapter" ? "perchapter" : "bulk");

  // "Go to Ch 1" only for WebNovel (RR doesn't expose firstChapterId)
  if (site === "webnovel" && info && info.chapterIndex > 1 &&
      info.firstChapterId && info.chapterId !== info.firstChapterId && !state.active) {
    gotoRow.style.display = "block";
  } else {
    gotoRow.style.display = "none";
  }

  if (state.readyToDownload && count > 0) {
    await runInTab(() => {
      const s = JSON.parse(localStorage.getItem("WN_SCRAPE") || "{}");
      s.readyToDownload = false;
      localStorage.setItem("WN_SCRAPE", JSON.stringify(s));
    });
  }
}

function setModeUI(mode) {
  if (mode === "perchapter") {
    modeBulk.classList.remove("active");
    modePerChapter.classList.add("active");
  } else {
    modeBulk.classList.add("active");
    modePerChapter.classList.remove("active");
  }
}

async function saveMode(mode) {
  const tab = await getActiveTab();
  if (!tab) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (m) => {
      const s = JSON.parse(localStorage.getItem("WN_SCRAPE") || "{}");
      s.downloadMode = m;
      localStorage.setItem("WN_SCRAPE", JSON.stringify(s));
    },
    args: [mode],
  });
}

modeBulk.addEventListener("click", () => {
  setModeUI("bulk");
  saveMode("bulk");
});

modePerChapter.addEventListener("click", () => {
  setModeUI("perchapter");
  saveMode("perchapter");
});

filenameInput.addEventListener("input", () => {
  filenameInput.dataset.userEdited = "true";
});

speedSlider.addEventListener("input", () => {
  speedLabel.textContent = speedSlider.value + "s";
});

speedSlider.addEventListener("change", async () => {
  const delayMs = parseFloat(speedSlider.value) * 1000;
  const tab = await getActiveTab();
  if (!tab) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (d) => {
      const s = JSON.parse(localStorage.getItem("WN_SCRAPE") || "{}");
      s.delayMs = d;
      localStorage.setItem("WN_SCRAPE", JSON.stringify(s));
    },
    args: [delayMs],
  });
});

async function startScraping(navigateToFirst) {
  const tab = await getActiveTab();
  const site = detectSite(tab?.url);
  const info = await getPageInfo();
  if (!info) {
    alert("Navigate to a chapter page on WebNovel or Royal Road first!");
    return;
  }

  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const delayMs = parseFloat(speedSlider.value) * 1000;

  if (site === "webnovel" && navigateToFirst && info.firstChapterId && info.chapterId !== info.firstChapterId) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (key, sid, delay, bid, fid) => {
        const existing = JSON.parse(localStorage.getItem(key) || "{}");
        localStorage.setItem(key, JSON.stringify({
          chapters: existing.chapters || [],
          chapterIndices: existing.chapterIndices || [],
          active: true, sessionId: sid, sessionStartedAt: Date.now(), delayMs: delay,
        }));
        window.location.href = "/book/" + bid + "/" + fid;
      },
      args: [STORAGE_KEY, sessionId, delayMs, info.bookId, info.firstChapterId],
    });
  } else {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (key, sid, delay) => {
        const existing = JSON.parse(localStorage.getItem(key) || "{}");
        localStorage.setItem(key, JSON.stringify({
          chapters: existing.chapters || [],
          chapterIndices: existing.chapterIndices || [],
          active: true, sessionId: sid, sessionStartedAt: Date.now(), delayMs: delay,
        }));
        location.reload();
      },
      args: [STORAGE_KEY, sessionId, delayMs],
    });
  }

  window.close();
}

btnGotoCh1.addEventListener("click", async () => {
  const info = await getPageInfo();
  if (!info || !info.firstChapterId || !info.bookId) {
    alert("Navigate to a WebNovel chapter page first!");
    return;
  }
  const tab = await getActiveTab();
  if (!tab) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (bid, fid) => {
      window.location.href = "/book/" + bid + "/" + fid;
    },
    args: [info.bookId, info.firstChapterId],
  });
  window.close();
});

btnStart.addEventListener("click", async () => {
  const tab = await getActiveTab();
  const site = detectSite(tab?.url);
  const info = await getPageInfo();
  if (!info) {
    alert("Navigate to a chapter page on WebNovel or Royal Road first!");
    return;
  }

  // Only WebNovel has firstChapterId for the "start from Ch 1?" prompt
  if (site === "webnovel" && info.chapterIndex > 1 && info.firstChapterId && info.chapterId !== info.firstChapterId) {
    promptText.textContent = "You're on Chapter " + info.chapterIndex +
      ". Start from Chapter 1 instead?";
    startPrompt.style.display = "block";
    btnStart.disabled = true;
  } else {
    startScraping(false);
  }
});

btnYes.addEventListener("click", () => {
  startPrompt.style.display = "none";
  startScraping(true);
});

btnNo.addEventListener("click", () => {
  startPrompt.style.display = "none";
  startScraping(false);
});

btnStop.addEventListener("click", async () => {
  await runInTab(() => {
    const state = JSON.parse(localStorage.getItem("WN_SCRAPE") || "{}");
    state.active = false;
    state.stoppedReason = "manual";
    localStorage.setItem("WN_SCRAPE", JSON.stringify(state));
  });
  refreshUI();
});

function getDownloadText() {
  return getState().then(state => {
    if (!state.chapters?.length) return null;
    const separator = "\n\n" + "=".repeat(50) + "\n\n";
    const text = state.chapters.join(separator);
    let filename = filenameInput.value.trim();
    if (!filename) filename = "chapters.txt";
    if (!filename.endsWith(".txt")) filename += ".txt";
    filename = sanitizeFilename(filename.replace(/\.txt$/, "")) + ".txt";
    return { text, filename };
  });
}

btnSaveAs.addEventListener("click", async () => {
  const data = await getDownloadText();
  if (!data) return;
  chrome.runtime.sendMessage({
    action: "download",
    text: data.text,
    filename: data.filename,
    saveAs: true,
  });
});

btnSave.addEventListener("click", async () => {
  const data = await getDownloadText();
  if (!data) return;
  const blob = new Blob([data.text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = data.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

btnReset.addEventListener("click", async () => {
  if (!confirm("This will delete all collected chapters. Are you sure?")) return;
  await runInTab(() => {
    localStorage.removeItem("WN_SCRAPE");
  });
  filenameInput.dataset.userEdited = "";
  refreshUI();
});

refreshUI();
