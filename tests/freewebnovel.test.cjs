const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.join(__dirname, "..");
const reader = fs.readFileSync(path.join(root, "freewebnovel.js"), "utf8");
const runner = fs.readFileSync(path.join(root, "content-fwn.js"), "utf8");
const origin = "https://freewebnovel.net";
const first = "/sky-pride/chapter-1-first.html";
const second = "/sky-pride/chapter-2-second.html";
const book = `<div class="m-desc"><h1>Sky Pride</h1></div>
  <div data-first-url="${first}"></div><a data-reading-first href="${first}">Read first</a>
  <div id="list-chapter" data-total-chapters="87" data-total-page="3"><ul id="idData"><li><a href="${first}">Chapter 1</a></li></ul></div>`;
function chapter(number = 1, next = second, text = "<p>First <em>paragraph</em>.</p><p>Second<br>line.</p>") {
  return `<div class="m-read"><div class="top"><a class="truyen-title" href="/sky-pride.html">Sky Pride</a>
    <h1 class="chapter">Chapter ${number}- Test</h1></div>
    <div class="ul-list7"><li class="next"><a data-nav="next" href="${next || "#"}">Next Chapter</a></li></div>
    <div class="txt"><div id="chapter-content">${text}</div></div></div>`;
}
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function withPage(html, pathname, callback) {
  const context = await browser.newContext();
  await context.route(origin + "/**", route => route.fulfill({ contentType: "text/html", body: route.request().url().includes("/sky-pride.html") ? book : html }));
  const page = await context.newPage();
  await page.goto(origin + pathname);
  await page.evaluate(reader);
  try { await callback(page); } finally { await context.close(); }
}
async function seed(page, overrides = {}) {
  await page.evaluate(overrides => {
    localStorage.setItem("WN_SCRAPE", JSON.stringify({ active: true, sessionId: "test-session", sessionStartedAt: Date.now(),
      site: "freewebnovel", bookId: "sky-pride", delayMs: 1000, chapters: [], chapterIndices: [], ...overrides }));
    window.downloads = [];
    window.chrome = { runtime: { sendMessage: msg => window.downloads.push(msg) } };
    window.pending = [];
    window.setTimeout = (fn, ms) => { window.pending.push({ fn, ms }); return window.pending.length; };
  }, overrides);
}
async function state(page) { return page.evaluate(() => JSON.parse(localStorage.getItem("WN_SCRAPE"))); }

test("book page uses first link and full total despite a paginated list", async () => {
  await withPage(book, "/sky-pride.html?page=2", async page => {
    const info = await page.evaluate(() => FreeWebNovel.getPageInfo(document, location.href));
    assert.equal(info.bookName, "Sky Pride");
    assert.equal(info.isBookPage, true);
    assert.equal(info.totalChapterNum, 87);
    assert.equal(info.firstChapterUrl, origin + first);
  });
});

test("chapter metadata fetches catalog; content preserves paragraphs and omits ads/hidden text", async () => {
  await withPage(chapter(1, second, '<p>First <em>paragraph</em>.</p><script>bad()</script><subtxt>hidden</subtxt><p hidden>hidden</p><ins>ad</ins><div data-ad-slot="x">ad</div><p>Second<br>line.</p>'), first, async page => {
    const info = await page.evaluate(() => FreeWebNovel.getPageInfoWithMeta(document, location.href));
    assert.equal(info.chapterIndex, 1);
    assert.equal(info.chapterId, first);
    assert.equal(info.firstChapterUrl, origin + first);
    assert.equal(info.totalChapterNum, 87);
    assert.equal(await page.evaluate(() => FreeWebNovel.getChapterText(document)), "First paragraph.\n\nSecond\nline.");
  });
});

test("navigation accepts unnumbered announcements but rejects cross-book, external, self, and disabled links", async () => {
  await withPage(chapter(), first, async page => {
    for (const [href, expected] of [["/sky-pride/authors-note.html", origin + "/sky-pride/authors-note.html"],
      ["https://www.freewebnovel.net" + second, origin + second], ["/other/chapter-2.html", null],
      ["https://example.com" + second, null], ["javascript:alert(1)", null], [first + "#next", null], ["#", null]]) {
      const actual = await page.evaluate(href => {
        document.querySelector('[data-nav="next"]').setAttribute("href", href);
        return FreeWebNovel.getNextChapterUrl(document, location.href);
      }, href);
      assert.equal(actual, expected, href);
    }
    await page.evaluate(() => { const el = document.querySelector('[data-nav="next"]'); el.href = "/sky-pride/chapter-2.html"; el.parentElement.classList.add("is-disabled"); });
    assert.equal(await page.evaluate(() => FreeWebNovel.getNextChapterUrl(document, location.href)), null);
  });
});

test("collects once, sends per-chapter download, and resuming still schedules the next chapter", async () => {
  await withPage(chapter(), first, async page => {
    await seed(page, { downloadMode: "perchapter" });
    await page.evaluate(runner);
    let saved = await state(page);
    assert.equal(saved.chapters.length, 1);
    assert.deepEqual(saved.chapterIndices, [first]);
    assert.equal(saved.currentChapter, 1);
    let downloads = await page.evaluate(() => window.downloads);
    assert.equal(downloads.length, 1);
    assert.match(downloads[0].filename, /^Sky_Pride_001_/);
    assert.equal(downloads[0].text, saved.chapters[0]);
    await page.evaluate(runner);
    saved = await state(page);
    assert.equal(saved.chapters.length, 1);
    assert.equal(await page.evaluate(() => window.downloads.length), 1);
    assert.equal(await page.evaluate(() => window.pending.length), 2);
  });
});

test("Stop, Reset, and a replacement session cancel scheduled navigation", async () => {
  await withPage(chapter(), first, async page => {
    for (const action of ["stop", "reset", "new-session"]) {
      await seed(page);
      await page.evaluate(runner);
      await page.evaluate(action => {
        const state = JSON.parse(localStorage.getItem("WN_SCRAPE"));
        if (action === "reset") localStorage.removeItem("WN_SCRAPE");
        else { if (action === "stop") state.active = false; else state.sessionId = "new-session"; localStorage.setItem("WN_SCRAPE", JSON.stringify(state)); }
        window.pending[0].fn();
      }, action);
      assert.equal(page.url(), origin + first);
    }
  });
});

test("last chapter completes; loops and expired sessions pause", async () => {
  await withPage(chapter(2, null), second, async page => {
    await seed(page);
    await page.evaluate(runner);
    assert.equal((await state(page)).stoppedReason, "complete");
    assert.equal((await state(page)).readyToDownload, true);
  });
  await withPage(chapter(2, first), second, async page => {
    await seed(page, { chapters: ["first"], chapterIndices: [first], visitedChapterIds: [first] });
    await page.evaluate(runner);
    assert.equal((await state(page)).stoppedReason, "navigation-loop");
    await seed(page, { sessionStartedAt: Date.now() - 6 * 60 * 60 * 1000 });
    await page.evaluate(runner);
    assert.equal((await state(page)).stoppedReason, "expired");
    assert.equal((await state(page)).chapters.length, 0);
  });
});

test("missing content pauses with saved chapters intact instead of completing", async () => {
  await withPage(chapter(2, null, ""), second, async page => {
    await seed(page, { chapters: ["first"], chapterIndices: [first] });
    await page.evaluate(runner);
    await page.evaluate(() => { for (let i = 0; i < window.pending.length; i++) window.pending[i].fn(); });
    const saved = await state(page);
    assert.equal(saved.stoppedReason, "missing-content");
    assert.deepEqual(saved.chapters, ["first"]);
    assert.equal(saved.active, false);
  });
});

test("ordinary browsing does not start a collection; switching books stops an active session", async () => {
  await withPage(chapter(), first, async page => {
    await page.evaluate(runner);
    assert.equal(await state(page), null);
    await seed(page, { bookId: "another-book" });
    await page.evaluate(runner);
    assert.equal((await state(page)).stoppedReason, "different-book");
    assert.equal((await state(page)).chapters.length, 0);
  });
});

test("manifest registers both FreeWebNovel hosts in the isolated world", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const entry = manifest.content_scripts.find(item => item.js.includes("content-fwn.js"));
  assert.deepEqual(entry.js, ["freewebnovel.js", "content-fwn.js"]);
  assert.ok(!entry.world || entry.world === "ISOLATED");
  for (const host of [origin + "/*", "https://www.freewebnovel.net/*"]) {
    assert.ok(entry.matches.includes(host));
    assert.ok(manifest.host_permissions.includes(host));
  }
});

test("unpacked extension starts from book page, follows chapters, and exposes the later-chapter prompt", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    ignoreDefaultArgs: ["--disable-extensions"],
  });
  try {
    await context.route(origin + "/**", route => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: "text/html", body: pathname === "/sky-pride.html" ? book : chapter(pathname === second ? 2 : 1, pathname === second ? null : second) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).hostname;
    const novel = await context.newPage();
    await novel.goto(origin + "/sky-pride.html");
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(async origin => {
      window.close = () => {};
      const [tab] = await chrome.tabs.query({ url: origin + "/sky-pride.html" });
      await chrome.tabs.update(tab.id, { active: true });
      await refreshUI();
      speedSlider.value = "1";
    }, origin);
    assert.equal(await popup.locator("#bookName").textContent(), "Sky Pride");
    assert.equal(await popup.locator("#chapterCount").textContent(), "0 / 87");
    await popup.locator("#btnStart").click();
    await novel.waitForURL(origin + second);
    await novel.waitForFunction(() => JSON.parse(localStorage.getItem("WN_SCRAPE") || "{}").stoppedReason === "complete");
    const saved = await state(novel);
    assert.equal(saved.chapters.length, 2);
    assert.deepEqual(saved.chapterIndices, [first, second]);
    await popup.evaluate(() => refreshUI());
    assert.equal(await popup.locator("#statusText").textContent(), "Complete");
    await popup.locator("#btnStart").click();
    assert.equal(await popup.locator("#startPrompt").isVisible(), true);
    assert.match(await popup.locator("#promptText").textContent(), /Chapter 2/);
    await popup.locator("#btnYes").click();
    await novel.waitForURL(origin + first);
    await novel.waitForURL(origin + second);
    await novel.waitForFunction(() => JSON.parse(localStorage.getItem("WN_SCRAPE")).stoppedReason === "complete");
    assert.equal((await state(novel)).chapters.length, 2);
  } finally { await context.close(); }
});
