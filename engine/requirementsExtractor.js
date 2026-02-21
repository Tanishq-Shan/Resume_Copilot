// engine/requirementsExtractor.js
// Phase 1: universal, rule-based requirement extraction (no AI)

function norm(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function cleanName(s) {
  return (s || "")
    .replace(/[•\u2022]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}
function importanceRank(imp) {
  if (imp === "must") return 3;
  if (imp === "preferred") return 2;
  return 1; // unknown
}

function dedupeItems(items) {
  const best = new Map(); // name -> item

  for (const it of items) {
    const key = norm(it.name);
    const prev = best.get(key);
    if (!prev || importanceRank(it.importance) > importanceRank(prev.importance)) {
      best.set(key, it);
    }
  }

  return [...best.values()];
}

const SECTION_MAP = [
  { key: "required", re: /\b(required|requirements|qualifications|essential|must have|minimum)\b/i, importance: "must" },
  { key: "preferred", re: /\b(preferred|desirable|nice to have|bonus|advantage)\b/i, importance: "preferred" },
  { key: "about_you", re: /\b(about you|what you(?:’|'|’)ll bring|what you bring|who you are|selection criteria|key skills)\b/i, importance: "must" }
];

const SOFT_SKILLS = [
  "communication", "teamwork", "collaboration", "leadership", "problem solving",
  "time management", "attention to detail", "customer service", "adaptability",
  "initiative", "stakeholder management", "critical thinking", "work ethic"
];

const VERBISH_START = [
  "with the ability to",
  "ability to",
  "able to",
  "responsible for",
  "support",
  "supporting",
  "configure",
  "configuring",
  "design",
  "designing",
  "implement",
  "implementing",
  "manage",
  "managing",
  "maintain",
  "maintaining"
];

function looksLikeJunkSkill(name) {
  const n = norm(name)
  .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-") // normalize hyphen variants to "-"
    .replace(/\u00A0/g, " ") // non-breaking space to normal space
    .trim();

  if (n.length < 3) return true;

  // remove verb-fragments
  if (VERBISH_START.some(v => n.startsWith(v))) return true;

  // too generic single words
  const bannedSingles = new Set([
  "business","process","processes","system","systems","team","teams","stakeholders",
  "requirements","requirement","data","database","databases","platform","platforms",
  "tools","tool","technology","technologies","work","role"
  ]);

  if (!n.includes(" ") && bannedSingles.has(n)) return true;

  // Also reject phrases that are mostly generic
  const bannedPhrase = /\b(the business|its processes|the system|the systems)\b/;
  if (bannedPhrase.test(n)) return true;

  // marketing/vague fluff
  if (/\bengineer[- ]led\b/.test(n)) return true;
  if (/\bto\s+(deliver|drive|enable|support|ensure|provide)\b/.test(n)) return true;
  if (/\bsolutions?\b/.test(n) && n.split(" ").length <= 3) return true;

  // generic filler phrases
  if (/\b(enterprise environment|workloads|secure cloud)\b/.test(n) && n.split(" ").length <= 2) return true;
  if (n === "cloud platforms" || n === "cloud platform") return true;

  return false;
}

function detectImportance(contextText, currentImportance) {
  const t = norm(contextText);
  if (/\b(must|required|essential|mandatory|need to have)\b/.test(t)) return "must";
  if (/\b(preferred|desirable|nice to have|bonus|advantage)\b/.test(t)) return "preferred";
  if (/\b(\d{1,2})\s*\+?\s*(years?|yrs?)\b/.test(t) && currentImportance === "unknown") return "must";
  return currentImportance || "unknown";
}

function splitList(s) {
  const firstChunk = (s || "")
    .split(/[.\n•·|]/)[0]
    .split(/\(e\.?g\.?/i)[0]
    .split(/\(i\.?e\.?/i)[0]
    .split(/\(/)[0]
    .trim();

  return firstChunk
    .split(/,|;|\/|\band\b|\bor\b/gi)
    .map(x => cleanName(x))
    .filter(x => x && x.length >= 2);
}

function extractYears(line, importance, out) {
  const m = line.match(/\b(minimum\s+)?(\d{1,2})\s*\+?\s*(years?|yrs?)\b/i);
  if (!m) return;
  const yrs = parseInt(m[2], 10);
  if (!Number.isFinite(yrs)) return;

  // Try to capture domain after "in/with" (optional)
  const domainMatch = line.match(/\b(?:years?|yrs?)\s+(?:of\s+)?(?:experience\s+)?(?:in|with)\s+(.+)$/i);
  const domain = domainMatch ? cleanName(domainMatch[1]) : "";

  out.years_experience.push({
    name: domain ? `${yrs}+ years (${domain})` : `${yrs}+ years`,
    min_years: yrs,
    domain,
    evidence: line,
    importance
  });
}

function extractDegrees(line, importance, out) {
  const DEG = /(bachelor|masters|master|phd|doctorate|diploma|certificate|cert iv|cert iii|associate degree)/i;
  if (!DEG.test(line)) return;

  const levelMatch = line.match(DEG);
  const levelRaw = levelMatch ? levelMatch[0] : "degree";
  let level = levelRaw.toLowerCase();
  level = level === "masters" ? "master" : level;

  // Try to capture field: "in X" or "of X"
  const fieldMatch = line.match(/\b(?:in|of)\s+([a-z][a-z0-9 \-&]{2,60})/i);
  const field = fieldMatch ? cleanName(fieldMatch[1]) : "";

  out.degrees.push({
    name: field ? `${level} (${field})` : level,
    level,
    field,
    evidence: line,
    importance
  });
}

function extractCertsAndLicenses(line, importance, out) {
  // Universal license/cert cues
  if (!/\b(certif|certified|certification|license|licence|registration|accreditation|check|clearance)\b/i.test(line)) return;

  // capture things like "forklift licence", "working with children check", "CPA", etc.
  const candidates = [];

  // phrase after "license/licence/certification"
  const phrase = line.match(/\b(?:license|licence|certification|registration|accreditation|clearance|check)\b[:\-]?\s*(.+)$/i);
  if (phrase?.[1]) candidates.push(...splitList(phrase[1]));

  // acronyms (2-6 uppercase letters) e.g., CPA, RSA, WWCC
  const acr = line.match(/\b[A-Z]{2,6}\b/g) || [];
  for (const a of acr) candidates.push(a);

  // If nothing extracted, keep generic token
  if (candidates.length === 0) return;

  for (const c of candidates) {
    out.certifications.push({
      name: cleanName(c),
      evidence: line,
      importance
    });
  }
}

function extractSkillsAndTools(line, importance, out) {
  const t = line;

  // Patterns for tools/systems + hard skills
  const patterns = [
    /\b(experience with|proficient in|knowledge of|familiar with|hands[- ]on with|using)\s+(.+)$/i
  ];

  let captured = null;
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[2]) {
      captured = m[2];
      break;
    }
  }
  if (!captured) return;

  const items = splitList(captured)
    .map(x => x.replace(/\btools?\b/i, "").trim())
    .filter(Boolean);

  const TOOLY_WORDS = /\b(platform|tool|system|suite|software|application|service|cloud|crm|erp|siem|edr|xdr|endpoint|firewall|iam|idp|siem|soc|edr|xdr|endpoint|firewall|network|iam|idp)\b/i;

  function normalizeSkillName(name) {
    let n = cleanName(name);

    const suchAs = n.match(/\bsuch as\s+(.+)$/i);
    if (suchAs?.[1]) n = cleanName(suchAs[1]);

    return n.trim();
  }

  function isToolOrSystem(name) {
    const n = (name || "").trim();

    if (/^[A-Z0-9]{2,12}$/.test(n)) return true;
    if (TOOLY_WORDS.test(n)) return true;
    if (/\b(microsoft|google|amazon|aws|azure|gcp|salesforce|sap|oracle|servicenow)\b/i.test(n)) return true;
    if (/\b(databricks|snowflake|redshift|bigquery|postgres|mysql|sql server|oracle)\b/i.test(n)) return true;

    return false;
  }
    const VERB_START = /^\s*(understand|liaise|communicate|collaborate|work|support|manage|lead|deliver|drive|ensure|provide)\b/i;


  for (const it of items) {
    if (looksLikeJunkSkill(it)) continue;
    // heuristic: if looks like a system/tool (contains software-y word or is Capitalized acronym), treat as tool
    const name = normalizeSkillName(it);
    if (VERB_START.test(name)) continue;

    if (isToolOrSystem(name)) {
      out.tools_or_systems.push({ name, evidence: line, importance });
    } else {
      out.hard_skills.push({ name, evidence: line, importance });
    }
  }
}

function extractSoftSkills(line, importance, out) {
  const l = norm(line);
  for (const s of SOFT_SKILLS) {
    if (l.includes(s)) {
      out.soft_skills.push({ name: s, evidence: line, importance });
    }
  }
}

export function extractRequirementsFromBlocks(blocks) {
  const out = {
    hard_skills: [],
    tools_or_systems: [],
    certifications: [],
    degrees: [],
    years_experience: [],
    soft_skills: []
  };

  let currentImportance = "unknown";

  const bulletBlocks = (blocks || []).filter(b => b.type === "bullet");
  const textBlocks = (blocks || []).filter(b => b.type === "text");

  // If we have bullets, use bullets only (high precision).
  // If we have NO bullets, fall back to text lines (but only short ones).
  const scanBlocks = bulletBlocks.length > 0
    ? bulletBlocks
    : textBlocks.filter(b => (b.text || "").trim().length <= 160);

  for (const b of blocks || []) {
    const text = cleanName(b.text || "");
    if (!text) continue;

    if (b.type === "heading") {
      for (const m of SECTION_MAP) if (m.re.test(text)) currentImportance = m.importance;
      continue;
    }

    const importance = detectImportance(text, currentImportance);

    // Always try these (they're precise enough)
    extractYears(text, importance, out);
    extractDegrees(text, importance, out);
    extractCertsAndLicenses(text, importance, out);
    extractSoftSkills(text, importance, out);
  }

  // Skills/tools scan pass (bullets if available, else short text lines)
  for (const b of scanBlocks) {
    const text = cleanName(b.text || "");
    if (!text) continue;
    const importance = detectImportance(text, currentImportance);
    extractSkillsAndTools(text, importance, out);
  }

  out.hard_skills = dedupeItems(out.hard_skills);
  out.tools_or_systems = dedupeItems(out.tools_or_systems);
  out.certifications = dedupeItems(out.certifications);
  out.degrees = dedupeItems(out.degrees);
  out.years_experience = dedupeItems(out.years_experience.map(y => ({
    name: y.name, evidence: y.evidence, importance: y.importance
  })));
  out.soft_skills = dedupeItems(out.soft_skills);

  return out;
}

function formatSection(title, items, max = 12) {
  if (!items?.length) return `${title}: (none)\n`;
  const list = items.slice(0, max).map(x => `- ${x.name}${x.importance ? ` [${x.importance}]` : ""}`).join("\n");
  return `${title}:\n${list}\n`;
}

export function formatRequirements(req) {
  return (
    formatSection("Degrees", req.degrees) + "\n" +
    formatSection("Certifications / Licenses", req.certifications) + "\n" +
    formatSection("Years of Experience", req.years_experience) + "\n" +
    formatSection("Tools / Systems", req.tools_or_systems) + "\n" +
    formatSection("Hard Skills", req.hard_skills) + "\n" +
    formatSection("Soft Skills", req.soft_skills)
  );
}