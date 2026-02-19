const resumeEl = document.getElementById("resume");
const outEl = document.getElementById("out");

const SKILLS = [
  { key: "siem", weight: 4, patterns: ["siem", "splunk", "sentinel", "qradar", "elastic", "elk"] },
  { key: "soc", weight: 3, patterns: ["soc", "security operations", "incident response", "triage"] },
  { key: "vuln_mgmt", weight: 4, patterns: ["vulnerability", "vuln", "remediation", "patch", "patching"] },
  { key: "iam", weight: 4, patterns: ["iam", "sso", "mfa", "azure ad", "entra", "active directory", "okta"] },
  { key: "cloud", weight: 3, patterns: ["aws", "azure", "gcp", "cloud"] },
  { key: "networking", weight: 3, patterns: ["tcp/ip", "dns", "dhcp", "firewall", "routing", "switching"] },
  { key: "frameworks", weight: 3, patterns: ["iso 27001", "nist", "ism", "cis", "framework", "compliance"] }
];


document.getElementById("save").addEventListener("click", async () => {
  const resume = resumeEl.value.trim();
  await chrome.storage.local.set({ resume });
  outEl.textContent = resume ? "Saved ✅" : "Saved (empty) ✅";
});

document.getElementById("match").addEventListener("click", async () => {
  const { resume = "" } = await chrome.storage.local.get("resume");

  if (!resume.trim()) {
    outEl.textContent = "Paste resume → Save first.";
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection()?.toString()?.trim() || "";
        // Prefer selection; fallback to whole page
        return sel.length > 30 ? sel : (document.body.innerText || "");
      }
    });

    const jobText = (results?.[0]?.result || "").trim();

    if (!jobText) {
      outEl.textContent = "Couldn't read text from this page.";
      return;
    }

    const r = analyzeHybrid(resume, jobText);
    outEl.textContent =
      `Match: ${r.score}%\n\n` +
      `Found: ${r.found.map(prettySkill).join(", ")}\n\n\n` +
      `Missing: ${r.missing.map(prettySkill).join(", ")}`;

  } catch (e) {
    outEl.textContent =
      "Can't read this page.\n" +
      "Try a normal https job page and refresh it.";
  }
});


document.getElementById("clearSel").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: "CLEAR_SELECTION" }, () => {
    outEl.textContent = "Selection cleared ✅";
  });
});

document.getElementById("how").addEventListener("click", () => {
  outEl.textContent =
    "How to use:\n" +
    "1) On the job page, highlight the job description text.\n" +
    "2) Open extension → Match.\n" +
    "Tip: Select at least a few paragraphs.";
});



function basicMatchScore(resume, pageText) {
  const r = tokenize(resume);
  const p = new Set(tokenize(pageText));
  if (r.length === 0) return 0;

  let hits = 0;
  for (const w of r) if (p.has(w)) hits++;

  return Math.min(100, Math.round((hits / r.length) * 100));
}

function analyzeMatch(resume, jobText) {
  const resumeSkills = extractSkills(resume);
  const jobSkills = extractSkills(jobText);

  // fallback if job has no recognized skills
  if (jobSkills.size === 0) {
    return analyzeKeywordFallback(resume, jobText);
  }

  let totalWeight = 0;
  let hitWeight = 0;

  const found = [];
  const missing = [];

  for (const s of SKILLS) {
    if (!jobSkills.has(s.key)) continue;
    totalWeight += s.weight;

    if (resumeSkills.has(s.key)) {
      hitWeight += s.weight;
      found.push(s.key);
    } else {
      missing.push(s.key);
    }
  }

  const score = totalWeight === 0 ? 0 : Math.round((hitWeight / totalWeight) * 100);
  return { score, found, missing };
}

function analyzeKeywordFallback(resume, jobText) {
  const resumeSet = new Set(tokenize(resume));
  const jobSet = new Set(tokenize(jobText));

  const found = [];
  const missing = [];

  for (const w of jobSet) {
    if (resumeSet.has(w)) found.push(w);
    else missing.push(w);
  }

  const score = Math.round((found.length / jobSet.size) * 100);
  return { score, found: found.slice(0, 12), missing: missing.slice(0, 12) };
}

function extractCandidateSkills(text) {
  const raw = text || "";
  // Certifications & common cyber quals (keep even if mentioned once)
  const certs = (raw.match(/\b(CISSP|CCSP|CISM|CISA|CEH|OSCP|GCIH|GCFA|GREM|GCSA|SEC\+|SECURITY\+|CYSA\+|PENTEST\+)\b/gi) || [])
    .map(c => c.toLowerCase().replace("security+", "sec+"));


  // 1) Acronyms like SIEM, SOC, IAM, API, VPN, SSO (2-10 chars)
  const acronyms = (raw.match(/\b[A-Z]{2,10}\b/g) || []).map(a => a.toLowerCase());

  // 2) Cleaned words for phrase building
  const cleaned = raw
    .toLowerCase()
    .replace(/[/+.#()\-]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean);

  // Generic junk words
  const bad = new Set([
    "and","or","the","a","an","to","of","in","for","on","with","as","at","by",
    "is","are","was","were","be","been","being","this","that","it","from",
    "will","can","may","should","would","could",
    "role","team","company","work","experience","skills","ability",
    "responsibilities","responsibility","required","requirements",
    "strong","good","great","excellent","high","level","ensure","ensuring",
    "including","include","etc","such","other","across","different","multiple","various",
    "location","locations","environment","environments",
    "professional","clear","confident","customer","focused","focus",
    "tertiary","qualification","qualifications","degree","years","year",
    "activities","activity","translate","decisive","pressure","under"

  ]);

  // Verb-ish words that create ugly phrases
  const verbish = new Set([
    "reproduce","participate","bring","working","work","provide","providing",
    "perform","performing","conduct","conducting","maintain","maintaining",
    "implement","implementing","develop","developing","promote","promoting",
    "ensure","ensuring","identify","identifying","investigate","investigating",
    "monitor","monitoring","resolve","resolving","troubleshoot","troubleshooting",
    "analyse","analyze","analysing","debug","debugging","prevent","preventing",
    "translate","translating","act","acting"

  ]);

  // Words/terms that indicate "this is probably technical"
  const techHints = [
    "api","apis","integration","integrations","endpoint","endpoints",
    "log","logs","error","errors","alert","alerts","incident","incidents",
    "ticket","tickets","ticketing","sla","slas",
    "network","dns","dhcp","tcp","ip","vpn","proxy","firewall",
    "server","servers","database","databases","storage","backup","recovery",
    "cloud","aws","azure","gcp","kubernetes","docker","linux","windows",
    "iam","sso","mfa","siem","soc","splunk","sentinel","qradar","edr","xdr",
    "vulnerability","vulnerabilities","patch","patching","remediation",
    "compliance","risk","policy","policies","framework","frameworks","ism","nist","cis",
    "authentication","authorization","auth","oauth","saml","jwt"
  ];

  const softKill = new Set([
  "leadership","executive","stakeholder","stakeholders","communication",
  "professional","confident","decisive","pressure","customer","focused"
  ]);


  function hasTechHint(phrase) {
    const p = phrase.toLowerCase();
    return techHints.some(h => p.includes(h));
  }

  // 3) Singles (1-word terms): keep tech-looking ones
  const singles = [];
  for (const w of words) {
    if (w.length < 3) continue;
    if (bad.has(w)) continue;
    // keep if it's likely technical (hint match) OR acronym-like in lowercase
    if (techHints.includes(w) || hasTechHint(w)) singles.push(w);
  }

  // 4) Bigrams + Trigrams
  const phrases = [];
  for (let i = 0; i < words.length; i++) {
    const w1 = words[i];
    const w2 = words[i + 1];
    const w3 = words[i + 2];

    if (!w1 || bad.has(w1) || verbish.has(w1)) continue;

    // bigram
    if (w2 && !bad.has(w2) && !verbish.has(w2)) {
      if (softKill.has(w1) || softKill.has(w2)) continue;
      const bi = `${w1} ${w2}`;
      if (hasTechHint(bi)) phrases.push(bi);
    }

    // trigram: only if it looks techy AND no verbish word inside
    if (w2 && w3 && !bad.has(w2) && !bad.has(w3) && !verbish.has(w2) && !verbish.has(w3)) {
      if (softKill.has(w1) || softKill.has(w2) || softKill.has(w3)) continue;
      const tri = `${w1} ${w2} ${w3}`;
      if (hasTechHint(tri)) phrases.push(tri);
    }
  }

  // 5) Frequency ranking (repeated phrases matter more)
  const freq = new Map();
  for (const t of [...acronyms, ...certs, ...singles, ...phrases]) {
    if (!t) continue;

    if (t.includes(" ")) {
      const parts = t.split(" ");
      if (parts.length > 3) continue;
      if (parts.includes("across") || parts.includes("different") || parts.includes("multiple")) continue;
    }

    freq.set(t, (freq.get(t) || 0) + 1);
  }

  // Keep:
  // - all acronyms
  // - phrases that appear at least 2x
  // - singles that appear at least 2x (or are tech hints)
  const sorted = [...freq.entries()]
    .filter(([t, c]) => {
      const isAcr = !t.includes(" ") && t.length <= 10 && t.toUpperCase() === t.toUpperCase(); // harmless check
      const isPhrase = t.includes(" ");
      const isSingle = !t.includes(" ");
      if (acronyms.includes(t)) return true;
      if (isPhrase) return c >= 2 || hasTechHint(t);
      if (isSingle) return c >= 2 || techHints.includes(t);
      return false;
    })
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length))
    .map(([t]) => t);

  // 6) De-dupe + remove overlaps (drop shorter terms contained in longer phrases)
  const capped = [...new Set(sorted)].slice(0, 80);

  const unique = [];
  for (const skill of capped) {
    const containedInOther = capped.some(other => other !== skill && other.includes(skill));
    if (!containedInOther) unique.push(skill);
  }

  return unique.slice(0, 40);
}



function analyzeHybrid(resume, jobText) {
  const resumeLower = (resume || "").toLowerCase();
  const jobSkills = extractCandidateSkills(jobText);

  if (jobSkills.length === 0) {
    return { score: 0, found: [], missing: [] };
  }

  const found = [];
  const missing = [];

  for (const s of jobSkills) {
    if (matchesSkill(resumeLower, s)) found.push(s);
    else missing.push(s);
  }

  const score = Math.round((found.length / jobSkills.length) * 100);

  return {
    score,
    found: found.slice(0, 12),
    missing: missing.slice(0, 12)
  };
}

function matchesSkill(resumeLower, skill) {

  // If single word or short acronym → direct match
  if (!skill.includes(" ") && skill.length <= 10) {
    return resumeLower.includes(skill);
  }

  const parts = skill.split(" ").filter(Boolean);

  const generic = new Set([
    "capability","familiarity","desirable","mandatory","other","operational",
    "highly","regulated","environments","environment","technologies","technology"
  ]);

  const keywords = parts.filter(w => w.length >= 4 && !generic.has(w));

  if (keywords.length === 0) return resumeLower.includes(skill);

  const requiredHits = keywords.length >= 4 ? 2 : 1;

  let hits = 0;
  for (const k of keywords) {
    if (resumeLower.includes(k)) hits++;
    if (hits >= requiredHits) return true;
  }

  return false;
}





function extractSkills(text) {
  const lower = text.toLowerCase();
  const found = new Set();

  for (const s of SKILLS) {
    for (const p of s.patterns) {
      // simple phrase match
      if (lower.includes(p)) {
        found.add(s.key);
        break;
      }
    }
  }
  return found;
}

function prettySkill(s) {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}



function tokenize(text) {

  // 🔹 Step 1: Normalize important IT phrases BEFORE cleaning
  text = text
    .replace(/active directory/gi, "active_directory")
    .replace(/operating systems/gi, "operating_systems")
    .replace(/service desk/gi, "service_desk")
    .replace(/windows 10/gi, "windows_10")
    .replace(/windows 11/gi, "windows_11")
    .replace(/microsoft 365/gi, "microsoft_365")
    .replace(/office 365/gi, "microsoft_365")
    .replace(/technical support/gi, "technical_support")
    .replace(/information technology/gi, "information_technology")
    .replace(/problem solving/gi, "problem_solving")
    .replace(/authorisation/gi, "authorization")
    .replace(/authorise/gi, "authorize")
    .replace(/authorised/gi, "authorized")
    .replace(/authorising/gi, "authorizing")
    .replace(/\bassessments?\b/gi, "assessment")
    .replace(/\bstakeholders?\b/gi, "stakeholder")
    .replace(/\bframeworks?\b/gi, "framework")
    .replace(/\benvironments?\b/gi, "environment")
    .replace(/\bnetworks?\b/gi, "network")
    .replace(/\bdatabases?\b/gi, "database")
    .replace(/\bprocedures?\b/gi, "procedure")
    .replace(/\bprocess(es)?\b/gi, "process")
    .replace(/\bsystems?\b/gi, "system")
    .replace(/\btools?\b/gi, "tool")
    .replace(/disaster recovery/gi, "disaster_recovery")
    .replace(/data recovery/gi, "data_recovery")
    .replace(/standard operating procedures/gi, "sop")
    .replace(/operating procedures/gi, "operating_procedures");

  const stop = new Set([
    "and","or","the","a","an","to","of","in","for","on","with","as","at","by",
    "is","are","was","were","be","been","being","this","that","it","from",
    "you","your","we","our","they","their","i","me","my",
    "will","can","may","should","would","could",
    "job","role","work","team","company","experience","skills","ability",
    "etc","line","first","second","third","provide","responsibilities",
    "key","devices","device","phones","phone","laptops","laptop",
    "desktops","desktop","peripheral","printers","printer","support",
    "perform","conduct","maintain","maintaining","aligned","activities","advise",
    "all","such","service","process","processes","documentation","operational"
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")   // keep underscores now
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stop.has(w));
}


