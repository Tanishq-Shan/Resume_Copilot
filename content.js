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
    // Prefer user selection, fallback to full page
    const text = selectedJobText || document.body.innerText || "";
    sendResponse({ text });
  }

  if (msg.type === "CLEAR_SELECTION") {
    selectedJobText = "";
    sendResponse({ ok: true });
  }
});
