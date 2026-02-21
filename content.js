// content.js (Phase 1: universal JD detection + block extraction)

const HEADING_HINTS = [
  "responsibilities", "requirements", "qualifications", "about the role",
  "what you will do", "what you'll do", "what you’ll do",
  "about you", "skills", "key duties", "key responsibilities",
  "selection criteria", "who you are", "what we’re looking for",
  "what we're looking for", "essential", "desirable", "preferred"
];

function normalize(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreElement(el) {
  const text = (el.innerText || "").trim();
  if (text.length < 600) return -999;

  // Length score (caps)
  const lengthScore = Math.min(text.length / 1200, 6);

  // Bullet score
  const bulletCount = el.querySelectorAll("li").length + (text.match(/^\s*[-•*]\s+/gm) || []).length;
  const bulletScore = Math.min(bulletCount / 6, 6);

  // Heading/keyword score
  const t = normalize(text);
  let hintHits = 0;
  for (const h of HEADING_HINTS) if (t.includes(h)) hintHits++;
  const hintScore = Math.min(hintHits, 8);

  // Link density penalty (nav/footer)
  const links = el.querySelectorAll("a").length;
  const linkDensity = links / (text.length + 1);
  const linkPenalty = linkDensity > 0.02 ? 6 : 0;

  // Form/UI penalty (filters/inputs)
  const inputs = el.querySelectorAll("input, select, textarea, button").length;
  const uiPenalty = inputs > 8 ? 3 : 0;

  return lengthScore + bulletScore + hintScore - linkPenalty - uiPenalty;
}

function detectJobContainer() {
  const candidates = Array.from(document.querySelectorAll("main, article, section, div"));

  let bestEl = null;
  let bestScore = -999;

  for (const el of candidates) {
    // Skip tiny/hidden
    const rect = el.getBoundingClientRect?.();
    if (rect && (rect.width < 200 || rect.height < 200)) continue;

    const score = scoreElement(el);
    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
    }
  }

  return { el: bestEl, score: bestScore };
}

function extractBlocksFromText(text) {
  const lines = (text || "")
    .split("\n")
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const blocks = [];
  for (const line of lines) {
    const isHeading =
      line.length <= 70 &&
      (line.endsWith(":") ||
        /^[A-Z\s]{6,}$/.test(line) ||
        HEADING_HINTS.some(h => normalize(line).includes(h)));

    const isBullet = /^[---•*]\s+/.test(line) || /^\d+[\.\)]\s+/.test(line);

    if (isHeading) blocks.push({ type: "heading", text: line.replace(/:$/, "").trim() });
    else if (isBullet) blocks.push({ type: "bullet", text: line.replace(/^[-•*]\s+/, "").replace(/^\d+[\.\)]\s+/, "").trim() });
    else blocks.push({ type: "text", text: line });
  }
  return blocks;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_JOB_PAYLOAD") {
    const { el, score } = detectJobContainer();
    const text = (el?.innerText || document.body.innerText || "").trim();

    // JD score: 0..100 (heuristic, not a probability)
    const jdScore = Math.max(0, Math.min(100, Math.round((score / 18) * 100)));

    const blocks = extractBlocksFromText(text);

    sendResponse({
      text,
      blocks,
      meta: {
        jdScore,
        containerTag: el?.tagName || "BODY"
      }
    });
  }
});