chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "download") {
    const bytes = new TextEncoder().encode(msg.text);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const dataUrl = "data:text/plain;charset=utf-8;base64," + btoa(binary);

    chrome.downloads.download({
      url: dataUrl,
      filename: msg.filename || "chapter.txt",
      saveAs: !!msg.saveAs,
    }, (downloadId) => {
      sendResponse({ ok: true, downloadId });
    });
    return true;
  }
});
