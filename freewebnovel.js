// Shared DOM reader used by the isolated content script and popup injections.
(function () {
  if (globalThis.FreeWebNovel) return;
  const catalogCache = new Map();

  function siteUrl(href, base) {
    if (!href || !href.trim() || href.trim().startsWith("#")) return null;
    try {
      const url = new URL(href, base);
      if (url.protocol !== "https:" || !/^(www\.)?freewebnovel\.net$/.test(url.hostname)) return null;
      // Keep www/non-www links on this origin so saved progress remains available.
      const local = new URL(url.pathname + url.search, base);
      return local.href;
    } catch { return null; }
  }

  function getPageInfo(doc, href) {
    const url = new URL(href);
    const chapterPath = url.pathname.match(/^\/([^/]+)\/[^/]+\.html$/);
    const bookPath = url.pathname.match(/^\/([^/]+)\.html$/);
    const content = doc.querySelector("#chapter-content, .m-read .txt");
    const list = doc.querySelector("#list-chapter");
    const title = doc.querySelector(".m-read h1.chapter, .m-read .chapter-title");
    const isBookPage = !chapterPath && !!bookPath && !!list;
    if (!isBookPage && (!chapterPath || !title)) return null;

    const bookId = (chapterPath || bookPath)[1];
    const bookUrl = new URL("/" + bookId + ".html", href).href;
    const bookTitle = doc.querySelector(isBookPage ? ".m-desc h1, h1.tit" : ".m-read .truyen-title");
    const chapterName = title?.textContent.trim() || null;
    const number = chapterName?.match(/^chapter\s+(\d+)\b/i) || url.pathname.match(/\/chapter-(\d+)\b/i);
    const firstLink = doc.querySelector("a[data-reading-first], #idData a[href]");
    const firstHref = doc.querySelector("[data-first-url]")?.getAttribute("data-first-url") || firstLink?.getAttribute("href");
    const firstChapterUrl = siteUrl(firstHref, href);
    const total = Number(list?.getAttribute("data-total-chapters"));
    return {
      site: "freewebnovel", isBookPage, bookId, bookUrl,
      bookName: bookTitle?.textContent.trim() || bookId,
      chapterName, chapterId: isBookPage ? null : url.pathname,
      chapterIndex: isBookPage ? null : (number ? Number(number[1]) : null),
      totalChapterNum: total > 0 ? total : null,
      firstChapterUrl: firstChapterUrl && new URL(firstChapterUrl).pathname.startsWith("/" + bookId + "/") ? firstChapterUrl : null,
      hasContent: !!content,
    };
  }

  async function getPageInfoWithMeta(doc, href) {
    const info = getPageInfo(doc, href);
    if (!info || info.isBookPage) return info;
    if (!catalogCache.has(info.bookUrl)) {
      const request = (async () => {
        try {
          const response = await fetch(info.bookUrl);
          if (!response.ok) return null;
          const html = await response.text();
          return getPageInfo(new DOMParser().parseFromString(html, "text/html"), info.bookUrl);
        } catch { return null; }
      })();
      catalogCache.set(info.bookUrl, request);
    }
    const meta = await catalogCache.get(info.bookUrl);
    if (meta) {
      info.firstChapterUrl = meta.firstChapterUrl;
      info.totalChapterNum = meta.totalChapterNum;
      info.bookName = meta.bookName;
    } else {
      catalogCache.delete(info.bookUrl); // Allow a later popup to retry.
    }
    return info;
  }

  function getChapterText(doc) {
    const root = doc.querySelector("#chapter-content, .m-read .txt");
    if (!root) return null;
    const copy = root.cloneNode(true);
    copy.querySelectorAll("script, style, iframe, ins, subtxt, [hidden], [aria-hidden='true'], .ads, .ad, .adsbygoogle, [data-ad-slot]")
      .forEach(el => el.remove());
    // Preserve inline emphasis and paragraph/BR boundaries without page controls.
    copy.querySelectorAll("br").forEach(el => el.replaceWith("\n"));
    copy.querySelectorAll("p, div, blockquote, li, h2, h3").forEach(el => el.append("\n\n"));
    return copy.textContent.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || null;
  }

  function getNextChapterUrl(doc, href) {
    const info = getPageInfo(doc, href);
    if (!info || info.isBookPage) return null;
    const links = doc.querySelectorAll('a[data-nav="next"], .ul-list7 .next a[href], a[rel="next"]');
    for (const link of links) {
      if (link.closest('.is-disabled, .disabled, [aria-disabled="true"]')) continue;
      const next = siteUrl(link.getAttribute("href"), href);
      if (!next) continue;
      const path = new URL(next).pathname;
      if (path !== info.chapterId && path.startsWith("/" + info.bookId + "/") && /\.html$/.test(path)) return next;
    }
    return null;
  }

  globalThis.FreeWebNovel = Object.freeze({ getPageInfo, getPageInfoWithMeta, getChapterText, getNextChapterUrl });
})();
