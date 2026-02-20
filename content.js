let selectedJobText = "";

document.addEventListener("mouseup", () => {
  const sel = window.getSelection()?.toString() || "";
  // store only meaningful selections
  if (sel.trim().length > 30) {
    selectedJobText = sel.trim();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_JOB_TEXT") {
    // Prefer live selection, then saved selection, then full page.
    const liveSelection = window.getSelection?.().toString().trim() || "";
    const text = liveSelection || selectedJobText || document.body.innerText || "";
    sendResponse({ text });
  }

  if (msg.type === "CLEAR_SELECTION") {
    selectedJobText = "";
    const selection = window.getSelection?.();
    if (selection) selection.removeAllRanges();
    sendResponse({ ok: true });
  }
});
