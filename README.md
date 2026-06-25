# WebNovel Chapter Collector

A browser extension (Manifest V3) that collects chapter text from [webnovel.com](https://www.webnovel.com) for personal offline reading analysis. It works by reading a global JavaScript variable (`chapInfo`) that WebNovel sets on every chapter page, extracting the paragraph text, and automatically navigating through chapters one by one.

Built for **Firefox** (primary) and **Chrome**. Tested on Firefox MV3 via `about:debugging`.

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Installation](#installation)
  - [Firefox (Temporary — for Development)](#firefox-temporary--for-development)
  - [Firefox (Permanent — Signed)](#firefox-permanent--signed)
  - [Chrome / Edge / Brave](#chrome--edge--brave)
- [Usage](#usage)
  - [Basic Workflow](#basic-workflow)
  - [Starting from a Later Chapter](#starting-from-a-later-chapter)
  - [Adjusting Speed](#adjusting-speed)
  - [Downloading Collected Chapters](#downloading-collected-chapters)
  - [Resetting](#resetting)
- [Popup UI Overview](#popup-ui-overview)
- [File Structure](#file-structure)
- [Architecture](#architecture)
  - [Content Script Injection (content.js)](#content-script-injection-contentjs)
  - [Popup Logic (popup.js)](#popup-logic-popupjs)
  - [Background Script (background.js)](#background-script-backgroundjs)
  - [State Management](#state-management)
  - [Two Execution Worlds](#two-execution-worlds)
- [How chapInfo Works](#how-chapinfo-works)
- [Security and CSP Handling](#security-and-csp-handling)
- [Key Design Decisions](#key-design-decisions)
  - [Anti-Auto-Start (Session-Based Activation)](#anti-auto-start-session-based-activation)
  - [Chapter Deduplication](#chapter-deduplication)
  - [Dual Download System (Save vs Save As)](#dual-download-system-save-vs-save-as)
  - [Locked Chapter Detection](#locked-chapter-detection)
- [Permissions](#permissions)
- [Browser Compatibility Notes](#browser-compatibility-notes)
- [Output Format](#output-format)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **One-click chapter collection** — navigate to any chapter, click Start, and the extension walks through every chapter automatically, extracting the full text
- **Session-based activation** — the scraper only runs when explicitly triggered from the popup; it will never auto-start on page reload or extension reload
- **Chapter deduplication** — clicking Start multiple times or reloading mid-scrape will not produce duplicate chapters in the output
- **Smart Chapter 1 navigation** — if you're on Chapter 5 and click Start, the extension asks if you want to begin from Chapter 1 instead; a dedicated "Go to Chapter 1" button is always available
- **Visual progress badge** — a floating bar at the top of the page shows real-time progress (e.g., "Collecting Ch 12/56: Chapter Name (34 saved)") so you can monitor without opening DevTools
- **Adjustable speed** — a slider in the popup lets you set the delay between chapters from 1 to 10 seconds (default: 2.5s)
- **Locked chapter detection** — when the scraper hits a paywalled/locked chapter with no content, it stops gracefully and flags the chapter
- **Dual download system** — "Save" for instant reliable downloads during/after scraping; "Save As..." for choosing a save location before scraping begins
- **Custom filenames** — auto-generates `BookName_YYYY-MM-DD.txt` but lets you edit the filename before downloading
- **Dark theme popup** — matches WebNovel's dark aesthetic with a status card, chapter counter, and full control panel
- **Cross-browser** — works on both Firefox (MV3) and Chrome/Chromium browsers

---

## How It Works

Every chapter page on webnovel.com defines a global JavaScript variable called `chapInfo`. This variable contains:

- **Book metadata** — book ID, book name, total chapter count
- **Chapter metadata** — chapter ID, chapter name, chapter index, next chapter ID, first chapter ID
- **Chapter content** — an array of paragraph objects, each containing HTML content strings

The extension injects a `<script>` tag into the page's MAIN world (to access this global variable), extracts the text from each paragraph, stores it in `localStorage`, and then navigates to the next chapter using `nextChapterId`. This repeats until it reaches the last chapter (`nextChapterId === "-1"`) or hits a locked chapter.

---

## Installation

### Firefox (Temporary — for Development)

1. Clone or download this repository
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Select the `manifest.json` file from the project folder
5. The extension icon will appear in your toolbar

> **Note:** Temporary extensions are removed when Firefox closes. You'll need to reload it each time.

### Firefox (Permanent — Signed)

To install permanently on Firefox, the extension must be signed through [addons.mozilla.org](https://addons.mozilla.org). You can submit it as an unlisted add-on for personal use — Mozilla will sign it without publishing it publicly.

### Chrome / Edge / Brave

1. Clone or download this repository
2. Open your browser and go to `chrome://extensions/` (or `edge://extensions/`, `brave://extensions/`)
3. Enable **"Developer mode"** (toggle in the top-right corner)
4. Click **"Load unpacked"**
5. Select the project folder (the one containing `manifest.json`)
6. The extension icon will appear in your toolbar

---

## Usage

### Basic Workflow

1. Navigate to a chapter page on `webnovel.com` (any URL matching `https://www.webnovel.com/book/*`)
2. Click the extension icon in your toolbar to open the popup
3. The status card will show the book name, chapter info, and current status
4. Click **Start** to begin collecting
5. Watch the progress badge at the top of the page as it moves through chapters
6. When it finishes (or you click **Stop**), click **Save** to download the collected text

### Starting from a Later Chapter

If you navigate to, say, Chapter 5 and click Start:

- The extension will ask: *"You're on Chapter 5. Start from Chapter 1 instead?"*
- Click **"Yes, Ch 1"** to navigate back to Chapter 1 and start from the beginning
- Click **"No, start here"** to begin collecting from Chapter 5 onward

There is also a **"Go to Chapter 1"** button (yellow) that appears whenever you're on any chapter past Chapter 1. This just navigates — it doesn't start scraping — so you can position yourself first, then click Start when ready.

If you already have chapters collected (say, 5-20 from a previous run) and then start from Chapter 1, the deduplication system will collect Chapters 1-4 and skip 5-20 since they're already stored.

### Adjusting Speed

The **Speed** slider in the popup controls the delay between chapter navigations:

- **1 second** — fastest, higher chance of rate limiting
- **2.5 seconds** — default, good balance
- **10 seconds** — slowest, safest for avoiding detection

The delay is saved in state and persists across popup opens. You can change it even while the scraper is running — it will use the new delay for the next chapter navigation.

### Downloading Collected Chapters

The extension has two download buttons that swap based on state:

| Button | When it appears | What it does |
|--------|----------------|--------------|
| **Save As...** | Before scraping (idle, no chapters) | Sends the file through the background script to trigger the OS "Save As" file picker dialog — you choose both filename and save location |
| **Save** | After scraping starts or chapters exist | Instant download to your browser's default downloads folder using the filename in the input field — no dialog, no popup-closing issues |

The **filename input** (monospace text field) auto-fills with `BookName_YYYY-MM-DD.txt` (e.g., `Radiant_Blade_of_the_Wilderness_2026-06-25.txt`). You can edit it freely before downloading. Special characters are stripped and spaces become underscores.

### Resetting

Click **Reset** to delete all collected chapters from localStorage. A confirmation dialog will appear first. After resetting, the status returns to "Idle" and the chapter count resets to 0.

---

## Popup UI Overview

```
┌──────────────────────────────────────┐
│  WebNovel Collector                  │
│  Chapter scraper for personal analysis│
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Book     Radiant Blade of...  │  │
│  │ Status   Running              │  │
│  │ Chapters 12 / 56              │  │
│  │ Current  Ch12: The Valley     │  │
│  └────────────────────────────────┘  │
│                                      │
│  [ ← Go to Chapter 1            ]   │
│                                      │
│  [ ▶ Start ] [ ■ Stop ]             │
│                                      │
│  SPEED                               │
│  ──────────●───── 2.5s               │
│                                      │
│  DOWNLOAD                            │
│  [Radiant_Blade_2026-06-25.txt]      │
│  [ ↓ Save ] [ Reset ]               │
│                                      │
│  Navigate to a chapter page, click   │
│  Start, and watch it go.             │
└──────────────────────────────────────┘
```

### Status States

| Status | Color | Meaning |
|--------|-------|---------|
| Idle | Gray | No scraping has happened yet |
| Running | Green | Actively collecting chapters |
| Complete | Green | Reached the last chapter successfully |
| Locked at Ch X | Red | Stopped because chapter X is paywalled/locked |
| Stopped | Red | Manually stopped by the user |
| Paused | Red | Stopped for another reason (e.g., session expired) |

---

## File Structure

```
wn-scraper-extension/
├── manifest.json      # MV3 extension manifest — permissions, content scripts, background
├── content.js         # Content script — injects scraper into page MAIN world
├── popup.html         # Popup UI — dark themed control panel with status card
├── popup.js           # Popup logic — button handlers, state management, downloads
├── background.js      # Background script — handles Save As downloads via message passing
├── icon.png           # Extension icon (48x48)
├── LICENSE            # MIT License
└── README.md          # This file
```

---

## Architecture

### Content Script Injection (content.js)

The content script runs in the **ISOLATED** world (the default for MV3 content scripts). It cannot directly access the page's JavaScript globals like `chapInfo`. To work around this, it:

1. Creates a `<script>` element containing the scraper logic as an IIFE
2. Copies the `nonce` attribute from an existing page script to pass CSP validation
3. Appends the script to the document head, which executes it in the **MAIN** world
4. Immediately removes the script element (the code is already executing)

The injected scraper code:
- Waits for `chapInfo` to be defined (retries up to 30 times, 500ms apart)
- Checks if the session is valid (sessionId exists, not expired)
- Extracts paragraph text from `chapInfo.chapterInfo.contents[]`
- Deduplicates by chapter index before storing
- Updates the visual progress badge
- Navigates to the next chapter after the configured delay

### Popup Logic (popup.js)

The popup communicates with the active tab through `chrome.scripting.executeScript`:

- **`runInTab(func)`** — executes in the ISOLATED world (default). Used for reading/writing localStorage. Reliable, doesn't need MAIN world access.
- **`runInTabMain(func)`** — executes in the MAIN world. Used only for reading the page's `chapInfo` global. Wrapped in try/catch since MAIN world injection can fail in some browser configurations.

The popup never directly manipulates page DOM or runs long-lived code in the tab. Every interaction is a short script injection that reads or writes localStorage and returns.

### Background Script (background.js)

The background script exists solely to handle "Save As" downloads. When the popup calls `chrome.downloads.download({ saveAs: true })`, the OS file picker dialog opens — but this causes the popup to lose focus and close. Since the popup created the blob URL, closing the popup revokes the URL and kills the download.

The background script solves this by:
1. Receiving the chapter text via `chrome.runtime.sendMessage`
2. Converting it to a self-contained `data:` URL (which doesn't get revoked)
3. Calling `chrome.downloads.download` from the background context (which stays alive)

For the regular "Save" button, the popup handles the download directly using an `<a>` tag click — no dialog, no popup-closing issue.

### State Management

All scraper state lives in **localStorage** under the key `WN_SCRAPE` as a JSON object. The state structure:

```json
{
  "active": true,
  "sessionId": "m1abc123xyz",
  "sessionStartedAt": 1750867200000,
  "delayMs": 2500,
  "bookName": "Radiant Blade of the Wilderness",
  "bookId": "35970900108664305",
  "totalChapters": 57,
  "chapters": [
    "Chapter 1: Waking from a Dream\n\nParagraph text...",
    "Chapter 2: The Old Sword\n\nParagraph text..."
  ],
  "chapterIndices": [1, 2],
  "currentChapter": 2,
  "currentName": "The Old Sword",
  "lastProcessed": "96656429204691110",
  "stoppedReason": null,
  "lockedAt": null,
  "readyToDownload": false
}
```

**Why localStorage instead of `chrome.storage`?** The content script runs in the page's MAIN world (via script injection) to access `chapInfo`. MAIN world code cannot use `chrome.storage` — it's only available to extension contexts. `localStorage` is the shared medium accessible from both the injected page script and the popup's script injections.

### Two Execution Worlds

Understanding the two execution contexts is key to this extension's architecture:

| World | What can access it | Used for |
|-------|-------------------|----------|
| **MAIN** | Page JS globals (`chapInfo`, `window`), page DOM, `localStorage` | Reading `chapInfo` data, navigating between chapters |
| **ISOLATED** | `chrome.*` APIs, `localStorage` (shared with page), extension messaging | Reading/writing scraper state, triggering downloads |

The content script (content.js) bridges these by injecting code into MAIN. The popup (popup.js) uses `runInTab` (ISOLATED) for state and `runInTabMain` (MAIN) for `chapInfo`.

---

## How chapInfo Works

Every chapter page on webnovel.com includes an inline `<script>` block that defines a global variable:

```javascript
var chapInfo = {
  bookInfo: {
    bookId: "35970900108664305",
    bookName: "Radiant Blade of the Wilderness",
    totalChapterNum: 57,
    // ... other fields
  },
  chapterInfo: {
    chapterId: "96656292034172955",
    chapterName: "Waking from a Dream",
    chapterIndex: 1,
    nextChapterId: "96656429204691110",  // "-1" if last chapter
    firstChapterId: "96656292034172955",
    contents: [
      {
        content: "<p>Paragraph text with <em>HTML</em> formatting</p>",
        paragraphId: "..."
      },
      // ... more paragraphs
    ],
    // contents is null or empty for locked/paywalled chapters
  }
};
```

Key fields used by the extension:

| Field | Purpose |
|-------|---------|
| `bookInfo.bookName` | Displayed in popup, used for filename generation |
| `bookInfo.totalChapterNum` | Shown as "X / total" in the chapter counter |
| `chapterInfo.chapterIndex` | Used for deduplication and display |
| `chapterInfo.chapterName` | Shown in popup and progress badge |
| `chapterInfo.nextChapterId` | Navigation — the extension builds `/book/{bookId}/{nextChapterId}` |
| `chapterInfo.firstChapterId` | "Go to Chapter 1" navigation |
| `chapterInfo.contents` | The actual chapter text — array of paragraph objects |
| `chapterInfo.contents[].content` | HTML string containing paragraph text, stripped to plain text |

---

## Security and CSP Handling

WebNovel uses **Content Security Policy** with nonces on inline scripts. A naive `<script>` injection would be blocked by CSP. The extension handles this by copying the nonce from an existing page script:

```javascript
var existingScript = document.querySelector("script[nonce]");
if (existingScript) {
  script.nonce = existingScript.nonce || existingScript.getAttribute("nonce");
}
```

This works because content scripts have access to the page DOM and can read nonce attributes from existing scripts. The browser then allows the injected script to execute because it carries a valid nonce.

---

## Key Design Decisions

### Anti-Auto-Start (Session-Based Activation)

**Problem:** In v1, the content script checked `state.active` on every page load. If `active` was `true` in localStorage — from a previous session, an extension reload, or a browser restart — the scraper would immediately start collecting, even if the user was just browsing.

**Solution:** The popup generates a unique `sessionId` and records `sessionStartedAt` when the user clicks Start. The content script checks for both fields and verifies the session hasn't expired (5-hour window). Without a valid session, `active: true` alone is ignored — the content script sets `active` to `false` and does nothing.

### Chapter Deduplication

**Problem:** In v1, clicking Start multiple times or reloading the extension mid-scrape would append chapters again, producing files with 133 entries for 56 unique chapters.

**Solution:** The state maintains a `chapterIndices` array alongside `chapters`. Before appending a new chapter, the scraper checks `chapterIndices.indexOf(chapterIndex)`. If the chapter index already exists, it's skipped silently. The popup's Start handler also preserves existing `chapters` and `chapterIndices` when activating a new session.

### Dual Download System (Save vs Save As)

**Problem:** `chrome.downloads.download({ saveAs: true })` opens the OS file picker, which steals focus from the extension popup. The popup closes, revoking any blob URL it created, and the download fails silently.

**Solution:** Two download modes:

1. **Save As** (shown before scraping) — routes through the background script via `chrome.runtime.sendMessage`. The background script converts the text to a `data:` URL (self-contained, doesn't get revoked) and calls `chrome.downloads.download`. The background script stays alive through the file picker dialog.

2. **Save** (shown during/after scraping) — uses the classic `<a>` tag click method directly in the popup. Creates a blob URL, clicks an invisible `<a download="filename.txt">` link, and revokes the URL after a short delay. No dialog means no focus loss, so the popup stays open and the download completes reliably.

### Locked Chapter Detection

**Problem:** When the scraper reached a paywalled chapter, it would just stop with a console log. No user-visible feedback, no download trigger.

**Solution:** When `chapInfo.chapterInfo.contents` is null or empty, the scraper:
1. Sets `stoppedReason` to `"locked"` and records `lockedAt` (the chapter index)
2. Sets `readyToDownload` to `true`
3. Updates the on-page badge: "Stopped at Ch X (locked) — Y chapters collected"
4. The popup shows "Locked at Ch X" in red in the status card

---

## Permissions

| Permission | Why it's needed |
|-----------|----------------|
| `storage` | Reserved for potential future use with `chrome.storage` |
| `scripting` | Required for `chrome.scripting.executeScript` — the popup uses this to inject short scripts into the active tab for reading/writing localStorage and reading `chapInfo` |
| `activeTab` | Grants temporary access to the currently focused tab when the user clicks the extension icon |
| `downloads` | Required for `chrome.downloads.download` with `saveAs: true` to trigger the native OS file picker dialog in the Save As flow |

**Host permission:** `https://www.webnovel.com/*` — required for the content script to inject into webnovel.com pages and for `chrome.scripting.executeScript` to target those tabs.

---

## Browser Compatibility Notes

| Feature | Firefox MV3 | Chrome MV3 |
|---------|------------|------------|
| Background scripts | `"scripts": ["background.js"]` (event page) | Also accepts `"scripts"` — `"service_worker"` is Chrome-specific and errors on Firefox |
| `chrome.*` APIs | Supported as polyfills for `browser.*` | Native |
| `chrome.scripting.executeScript` | Supported | Supported |
| `chrome.downloads.download` | Supported | Supported |
| `saveAs: true` | Opens native file picker | Opens native file picker |
| Content script `world: "MAIN"` | Supported | Supported |
| Nonce-based CSP bypass | Works | Works |
| `localStorage` sharing | MAIN and ISOLATED share the same `localStorage` for a given origin | Same |

The manifest uses `"background": { "scripts": ["background.js"] }` instead of `"service_worker"` because Firefox MV3 does not support service workers for extensions and will error with: *"background.service_worker is currently disabled. Add background.scripts."*

---

## Output Format

Downloaded files contain chapters separated by a line of 50 equal signs:

```
Chapter 1: Waking from a Dream

The morning sun filtered through the bamboo blinds, casting
thin stripes of gold across the wooden floor. Lin Feng opened
his eyes slowly, the remnants of a strange dream still
clinging to his thoughts.

...paragraph text continues...

==================================================

Chapter 2: The Old Sword

The courtyard was empty save for a single plum tree, its
branches heavy with early spring blossoms. Beneath it, half
buried in fallen petals, lay a sword.

...paragraph text continues...

==================================================

Chapter 3: ...
```

Each chapter entry starts with `Chapter {index}: {name}` followed by a blank line and the full paragraph text. Chapters are separated by `\n\n==================================================\n\n`.

---

## Troubleshooting

### The scraper doesn't start when I click Start

- Make sure you're on a `webnovel.com/book/...` chapter page (not the book listing page or table of contents)
- Open the browser console (F12) and check for `[WN-Scraper]` messages
- If you see "No session — not auto-starting", the session data wasn't written — try clicking Start again

### The popup shows "Idle" even though I was just scraping

- The popup reads state fresh every time it opens. If the tab navigated away from webnovel.com, it can't read localStorage from that origin anymore.
- Navigate back to any webnovel.com page and reopen the popup.

### Save As doesn't work / nothing happens when I click it

- Save As routes through the background script. Make sure the extension loaded without errors in `about:debugging` (Firefox) or `chrome://extensions` (Chrome).
- Check the browser console for errors from the background script.
- Use the **Save** button instead — it's more reliable and downloads directly.

### Chapters are missing from the download

- Open the browser console on a webnovel.com page and run: `JSON.parse(localStorage.getItem("WN_SCRAPE"))` to inspect the raw state.
- Check `chapterIndices` to see which chapters were collected.
- The deduplication system skips chapters already in `chapterIndices` — if you need to re-collect a chapter, click Reset first.

### The extension auto-started scraping when I reloaded it

- This was a bug in v1 and should not happen in v2. The session-based activation requires a `sessionId` set by the popup within the last 5 hours.
- If it somehow happens, click Stop in the popup or clear localStorage: `localStorage.removeItem("WN_SCRAPE")` in the browser console.

### Firefox shows "background.service_worker is currently disabled"

- The manifest must use `"background": { "scripts": ["background.js"] }`, not `"service_worker"`. This is already fixed in v2.

---

## License

[MIT License](LICENSE) — Copyright (c) 2026 Alvin Ogbeifun
