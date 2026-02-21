// popup.js (Phase 1: universal JD → requirements extraction → display)

import { extractRequirementsFromBlocks, formatRequirements } from "./engine/requirementsExtractor.js";

const resumeEl = document.getElementById("resume");
const outEl = document.getElementById("out");
const bar = document.getElementById("progressBar");

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message });
        return;
      }
      resolve({ ok: true, payload: res || null });
    });
  });
}

function isRestrictedUrl(url = "") {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.includes("chrome.google.com/webstore")
  );
}

async function getJobPayload(tab) {
  if (!tab?.id) return { ok: false, error: "No active tab found." };

  if (isRestrictedUrl(tab.url || "")) {
    return { ok: false, error: "This page is restricted by Chrome. Open a normal https job page." };
  }

  // Inject first (prevents "Receiving end does not exist" noise)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch (e) {
    // If we can't inject, the page is likely protected or CSP-blocked
    return { ok: false, error: e?.message || "Cannot access this page." };
  }

  // Then message
  const result = await sendMessageToTab(tab.id, { type: "GET_JOB_PAYLOAD" });

  if (!result.ok) return result;
  if (!result.payload?.text) {
    return { ok: false, error: "Job description not detected on this page." };
  }
  return result;
}

document.getElementById("save").addEventListener("click", async () => {
  const resume = resumeEl.value.trim();
  await chrome.storage.local.set({ resume });
  outEl.textContent = resume ? "Saved ✅" : "Saved (empty) ✅";
});

document.getElementById("match").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const result = await getJobPayload(tab);
  const payload = result.ok ? result.payload : null;

  if (!payload?.text) {
    const detail = result.error ? `\nDetails: ${result.error}` : "";
    outEl.textContent = "Couldn't detect a job description on this page.\nTry a job listing page and refresh." + detail;
    if (bar) bar.style.width = "0%";
    return;
  }

  const jdScore = payload?.meta?.jdScore ?? 0;
  bar.style.width = `${Math.max(0, Math.min(100, jdScore))}%`;

  const requirements = extractRequirementsFromBlocks(payload.blocks);

  outEl.textContent =
    `JD detected ✅ (JD score: ${jdScore}/100)\n` +
    `Container: ${payload?.meta?.containerTag || "unknown"}\n\n` +
    `EXTRACTED REQUIREMENTS (Phase 1)\n` +
    `--------------------------------\n` +
    formatRequirements(requirements);
});

document.getElementById("clearSel").addEventListener("click", async () => {
  // No selection-based logic anymore — this just clears the UI
  outEl.textContent = "Cleared ✅";
  if (bar) bar.style.width = "0%";
});

document.getElementById("how").addEventListener("click", () => {
  outEl.textContent =
    "How it works now:\n" +
    "1) Open a job listing page.\n" +
    "2) Click Match.\n\n" +
    "No highlighting needed — it auto-detects the job description.";
});
