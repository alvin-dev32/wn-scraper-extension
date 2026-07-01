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
