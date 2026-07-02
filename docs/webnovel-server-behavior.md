# WebNovel Server Behavior — Findings Report

Compiled from live testing of the Chapter Collector extension against
`www.webnovel.com`, primarily on the book *Radiant Blade of the Wilderness*
(bookId `35970900108664305`, 66 chapters). Last updated: 2026-07-02.

---

## 1. Page delivery model

WebNovel reader pages are **server-rendered**. Each chapter page arrives from
the server with the full chapter data already embedded — the text is not
fetched by client-side JavaScript after load. This is the single most
important fact for the scraper: everything we need is present at
`document_idle` (after a short wait for the global to be defined).

- **URL structure:** `https://www.webnovel.com/book/{bookId}/{chapterId}`
- **Navigation between chapters is a full page load**, not an SPA route
  change. Each navigation produces a fresh server-rendered document with a
  fresh `chapInfo` global. This is why the scraper works as a
  "process → navigate → re-run on load" loop driven by `localStorage` state.
- Chapter IDs are **opaque ~17–18 digit snowflake-style IDs**
  (e.g. `97409943501589407`). They are **not sequential and not derivable**
  from the chapter index — you cannot compute chapter 65's URL from chapter
  64's. The only ways to get a chapter's ID are: the `nextChapterId` /
  `preChapterId` pointers, the catalog, or an API call.

## 2. The `chapInfo` global (MAIN world)

The server injects a page-script global `chapInfo` that holds all book and
chapter state. It only exists in the **MAIN world** — content scripts in the
default ISOLATED world cannot see it.

Top-level keys observed:

| Key | Contents |
|---|---|
| `bookInfo` | Book-level metadata (see below) |
| `chapterInfo` | Current chapter data including full text (see below) |
| `membershipStatus` | User's membership/subscription state |
| `waitpayStatus` | State for the "wait to unlock for free" system |
| `settings` | Reader display settings |
| `user` | Logged-in user info |
| `machineTrans` | Machine-translation flags |
| `_isPureId` | Internal flag |

### `bookInfo` (observed values on our test book)

- `bookId: "35970900108664305"`
- `totalChapterNum: 66` — **the server does know all 66 chapters exist**,
  including the ones past where navigation stops (see §4)
- `totalPreChapterNum: 0`
- `groupItems: []` — the volume/chapter grouping list is **empty on reader
  pages**. The full catalog is not embedded in the reader page; it is loaded
  lazily (see §5).

### `chapterInfo`

Keys include: `chapterId`, `chapterName`, `chapterIndex`, `preChapterId`,
`nextChapterId`, `firstChapterId`, `contents`, `vipStatus`, `price`,
`isAuth`, `batchUnlockStatus`, `nextChapterName`.

- **Chapter text lives in `chapterInfo.contents[]`** — an array of paragraph
  objects. The scraper joins these to produce the chapter body. Because this
  comes straight from the server payload, we get clean text with no ads or
  UI chrome mixed in.
- `preChapterId` / `nextChapterId` are the **only navigation pointers** the
  page gives us. The scraper follows `nextChapterId` to build the next URL.
- `firstChapterId` is present on every chapter page — this is what powers
  the "Go to Ch 1" button reliably from any chapter.

## 3. Monetization / access model

Fields that describe chapter access:

- `vipStatus` — whether the chapter is a paid ("VIP") chapter.
- `price` — coin price for locked chapters.
- `isAuth` — whether the **current user** is authorized to read this
  chapter (i.e. free chapter, or purchased/unlocked).
- `batchUnlockStatus` — state for bulk-unlock offers.
- `waitpayStatus` (top level) — the timed free-unlock system.

Practical consequence for the scraper: when the user hits a chapter they
haven't unlocked, `contents` comes back empty/absent and the scraper stops
with "locked" as the reason. **Purchasing chapters makes their `contents`
render server-side like any free chapter** — so scraping purchased chapters
works identically to free ones.

## 4. The `nextChapterId: "-1"` problem (open issue)

The main unresolved finding. Observed on chapter 64 of our test book:

```
chapterIndex:      64
totalChapterNum:   66
nextChapterId:     "-1"
nextChapterName:   ""
preChapterId:      "97405001739069103"   (valid — backwards nav works)
```

The user has **purchased and unlocked chapters 65 and 66**, and
`totalChapterNum` confirms the server knows they exist — yet the server
renders chapter 64's page with `nextChapterId: "-1"`, which normally means
"this is the last chapter". The scraper therefore stops at 64 and marks the
run complete.

Hypotheses (unconfirmed):

1. **Advance/privilege chapter tier.** Chapters 65–66 may be "advance"
   chapters in a separate publication tier. The forward pointer chain may
   only link *publicly released* chapters, with advance chapters reachable
   only via the catalog — even for users who own them.
2. **Stale server-side/CDN cache.** The chapter-64 page (or its data blob)
   may have been rendered/cached before the purchase, when 64 genuinely was
   the frontier chapter, and the pointer wasn't invalidated after unlock.
3. **Pointer computed from "released" rather than "owned".** The server may
   compute `nextChapterId` from a global release schedule rather than the
   requesting user's entitlements.

Either way, the takeaway is: **`nextChapterId === "-1"` does not reliably
mean "no more readable chapters".** `totalChapterNum > chapterIndex` is the
tell that more chapters exist and a fallback lookup is needed.

## 5. Getting the full chapter list (fallback options investigated)

Since chapter IDs aren't derivable, escaping the broken pointer requires a
chapter catalog. What we found:

- **No prev/next links in the DOM.** The reader page's anchor tags are
  almost all `###` placeholder hrefs handled by JS. There is no crawlable
  next-chapter `<a>` element (unlike Royal Road). Navigation is entirely
  driven by page JavaScript reading `chapInfo`.
- **Catalog modal.** The reader page has a hidden catalog UI:
  `a.j_modal.j_catalog` (trigger) and `.j_catalog_modal_body` (container).
  The container is **empty until clicked** — the chapter list is lazy-loaded
  via XHR when the modal opens. Programmatically clicking `.j_catalog` and
  waiting for the list to populate is a viable way to harvest all chapter
  IDs (not yet verified — testing was interrupted).
- **`/go/pcm/...` API endpoints.** WebNovel's internal AJAX API lives under
  `/go/pcm/`. Requests require the `_csrfToken` cookie value passed as a
  query parameter. We attempted
  `/go/pcm/chapter/get-chapter-list?bookId=...&_csrfToken=...` and two
  variants; results were inconclusive (the test harness returned empty
  before the promise resolved, and a follow-up attempt hung the renderer).
  The exact working catalog endpoint is **still unidentified** — sniffing
  the network request the catalog modal makes when opened is the most
  direct way to find it.

## 6. Content Security Policy behavior

- WebNovel serves a **strict CSP with script nonces**.
- **Chrome blanks the `nonce` attribute** on script elements when read from
  the DOM, so the old technique — copy a nonce from an existing page script
  and inject an inline `<script>` — fails on Chrome with
  *"Executing inline script violates the Content Security Policy"*.
- **Firefox does not blank nonces**, so the inline-injection trick works
  there. This is why the extension originally worked on Firefox only.
- **Fix:** register the MAIN-world script in `manifest.json` with
  `"world": "MAIN"` (`content-wn-main.js`). Browser-level injection is not
  subject to the page's CSP, so this works on both browsers.

## 7. Architecture implications (how the extension adapts)

- `content-wn-main.js` (MAIN world): reads `chapInfo`, extracts text,
  manages the scrape loop, navigates via `nextChapterId`.
- `content.js` (ISOLATED world): relay only. MAIN world can't call
  `chrome.runtime`, so per-chapter downloads flow
  MAIN world → `window.postMessage` → ISOLATED world →
  `chrome.runtime.sendMessage` → `background.js` → `chrome.downloads`.
- State lives in `localStorage` (key `WN_SCRAPE`) because it must survive
  full page loads between chapters, and both worlds share the page's
  localStorage.
- Session ID + timestamp in state prevent stale state from auto-starting a
  scrape on a casual page visit (sessions expire after 5 hours).

## 8. Open items

1. **Chapter 64 stall:** implement a fallback when `nextChapterId === "-1"`
   but `chapterIndex < totalChapterNum` — either open the catalog modal and
   read the list, or find the catalog XHR endpoint and fetch it directly.
2. Identify the exact catalog API endpoint by observing the network request
   fired when the catalog modal opens.
3. Confirm whether purchased advance chapters render `contents` server-side
   when navigated to directly by URL (if yes, the catalog fallback fully
   solves the stall).
