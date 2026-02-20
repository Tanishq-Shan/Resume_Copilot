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

// =====================
// CONFIG / LISTS
// =====================

// Core stop words used by tokenizer + phrase extractor
const STOP_WORDS = new Set([
  "and","or","the","a","an","to","of","in","for","on","with","as","at","by",
  "is","are","was","were","be","been","being","this","that","it","from",
  "you","your","we","our","they","their","i","me","my",
  "will","can","may","should","would","could",
  "role","team","company","experience","skills","ability",
  "responsibilities","responsibility","required","requirements",
  "strong","good","great","excellent","high","level","ensure","ensuring",
  "including","include","etc","such","other","various","multiple","different",
  "working","work","worked","perform","performing","conduct","conducting",
  "manage","managing","managed","provide","providing","provided",
  "support","supporting","supported","maintain","maintaining","maintained",
  "develop","developing","developed","implement","implementing","implemented",
  "identify","identifying","identified","investigate","investigating",
  "monitor","monitoring","resolve","resolving","analysis","analysing","analyze","analyzing",
  "improve","improving","improved","deliver","delivering","delivered",
  "assist","assisting","assisted","lead","leading","led",
  "across","within","into","over","under","between","through",
  "location","locations","environment","environments",
  "professional","clear","confident","customer","focused","focus",
  "tertiary","qualification","qualifications","degree","years","year",
  "activities","activity","translate","decisive","pressure","under",
  "our","new","learning","technologies","supporting","backlog","streamline","design","decisions","decision","logs", "pipeline","cd"
]);

// Words that usually create ugly sentence fragments in phrases
const VERBISH = new Set([
  "reproduce","participate","bring","provide","providing","perform","performing",
  "conduct","conducting","maintain","maintaining","implement","implementing",
  "develop","developing","promote","promoting","ensure","ensuring",
  "identify","identifying","investigate","investigating","monitor","monitoring",
  "resolve","resolving","troubleshoot","troubleshooting",
  "analyse","analyze","analysing","debug","debugging","prevent","preventing",
  "translate","translating","act","acting",
  "oversee","overseeing","manage","managing","lead","leading"
]);

// Soft-skill words to block from phrase generation (not from matching)
const SOFT_KILL = new Set([
  "leadership","executive","stakeholder","stakeholders","communication",
  "professional","confident","decisive","pressure","customer","focused"
]);

// Tech hint words used to decide if a phrase “looks technical”
const TECH_HINTS = [
  "api","apis","integration","integrations","endpoint","endpoints",
  "log","logs","error","errors","alert","alerts","incident","incidents",
  "ticket","tickets","ticketing","sla","slas",
  "network","dns","dhcp","tcp","ip","vpn","proxy","firewall",
  "server","servers","database","databases","storage","backup","recovery",
  "cloud","aws","azure","gcp","kubernetes","docker","linux","windows",
  "iam","sso","mfa","siem","soc","splunk","sentinel","qradar","edr","xdr",
  "vulnerability","vulnerabilities","patch","patching","remediation",
  "compliance","risk","policy","policies","framework","frameworks","ism","nist","cis",
  "authentication","authorization","auth","oauth","saml","jwt",
  "cloudformation","terraform","ansible","jenkins","gitlab","ci/cd",
  "dynamodb","snowflake","mssql","iis","active_directory","microsoft_365","apm"
];

// Cert regex (centralized)
const CERT_REGEX = /\b(CISSP|CCSP|CISM|CISA|CEH|OSCP|GCIH|GCFA|GREM|GCSA|SEC\+|SECURITY\+|CYSA\+|PENTEST\+)\b/gi;


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
        return sel.length > 30 ? sel : "";
      }
    });

    const jobText = (results?.[0]?.result || "").trim();

    if (!jobText) {
      outEl.textContent = "Couldn't read text from this page.";
      return;
    }

    const r = analyzeHybrid(resume, jobText);
    document.getElementById("progressBar").style.width = r.score + "%";
    const foundBuckets = bucketize(r.found);
    const missingBuckets = bucketize(r.missing);

    outEl.textContent =
      `Match: ${r.score}%\n\n` +
      `FOUND (by category)\n` +
      `${formatBuckets(foundBuckets, 4)}\n\n` +
      `MISSING (by category)\n` +
      `${formatBuckets(missingBuckets, 4)}`;

  } catch (e) {
    outEl.textContent =
      "Can't read this page.\n" +
      "Try a normal https job page and refresh it.";
  }
});


document.getElementById("clearSel").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection?.();
        if (sel) sel.removeAllRanges();
        return true;
      }
    });

    // also clear UI so you don't see the old match
    outEl.textContent = "Selection cleared ✅";
    const bar = document.getElementById("progressBar");
    if (bar) bar.style.width = "0%";

  } catch (e) {
    outEl.textContent = "Couldn't clear selection. Refresh the page and try again.";
  }
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
  const certs = (raw.match(CERT_REGEX) || [])
  .map(c => c.toLowerCase().replace("security+", "sec+"));
  const must = extractMustHaveTech(raw);


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

  function hasTechHint(phrase) {
    const p = phrase.toLowerCase();
    return TECH_HINTS.some(h => p.includes(h));
  }

  // 3) Singles (1-word terms): keep tech-looking ones
  const singles = [];
  for (const w of words) {
    if (w.length < 3) continue;
    if (STOP_WORDS.has(w)) continue;
    // keep if it's likely technical (hint match) OR acronym-like in lowercase
    if (TECH_HINTS.includes(w) || hasTechHint(w)) singles.push(w);
  }

  // 4) Bigrams + Trigrams
  const phrases = [];
  for (let i = 0; i < words.length; i++) {
    const w1 = words[i];
    const w2 = words[i + 1];
    const w3 = words[i + 2];

    if (!w1 || STOP_WORDS.has(w1) || VERBISH.has(w1)) continue;

    // bigram
    if (w2 && !STOP_WORDS.has(w2) && !VERBISH.has(w2)) {
      if (SOFT_KILL.has(w1) || SOFT_KILL.has(w2)) continue;
      const bi = `${w1} ${w2}`;
      if (hasTechHint(bi)) phrases.push(bi);
    }
//    // trigram: only if it looks techy AND no verbish word inside
//    if (w2 && w3 && !STOP_WORDS.has(w2) && !STOP_WORDS.has(w3) && !VERBISH.has(w2) && !VERBISH.has(w3)) {
//     if (SOFT_KILL.has(w1) || SOFT_KILL.has(w2) || SOFT_KILL.has(w3)) continue;
//      const tri = `${w1} ${w2} ${w3}`;
//      if (hasTechHint(tri)) phrases.push(tri);
//    }
  }

  // 5) Frequency ranking (repeated phrases matter more)
  const freq = new Map();
  for (const t of [...must, ...acronyms, ...certs, ...singles, ...phrases]) {
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
      if (isSingle) return c >= 2 || TECH_HINTS.includes(t);
      return false;
    })
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length))
    .map(([t]) => t);

  // 6) De-dupe + remove overlaps (drop shorter terms contained in longer phrases)
  const capped = [...new Set(sorted)].slice(0, 80);

  const unique = [];
  for (const skill of capped) {
    const containedInOther = capped.some(
      other => other !== skill && other.includes(skill)
    );
    if (!containedInOther) unique.push(skill);
  }

  const cleanedUnique = unique.filter(s => {
    const parts = s.split(" ");

    // remove single-letter junk (like "g")
    if (parts.some(p => p.length === 1)) return false;

    // remove phrases starting with filler verbs
    const first = parts[0];
    if (VERBISH.has(first)) return false;

    return true;
  });

  return cleanedUnique.slice(0, 40);
}



function analyzeHybrid(resume, jobText) {
  const resumeLower = (resume || "").toLowerCase();
  let jobSkills = extractCandidateSkills(jobText);

  // remove phrases that include must-have tools (keep tools only)
  const must = extractMustHaveTech(jobText);
  jobSkills = collapseToMustHave(jobSkills, must);

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

const BUCKETS = [
  { name: "Cloud", keys: ["aws","azure","gcp","ec2","vpc","s3","lambda","cloudwatch","cloud","iaas","paas","saas"] },
  { name: "DevOps / IaC", keys: ["terraform","ansible","cloudformation","ci/cd","gitlab","jenkins","github actions",
    "pipeline","automation","infrastructure as code","iac","docker","kubernetes","helm","argocd"] },
  { name: "OS / Identity", keys: ["windows server","linux","unix","iis","active directory","active_directory","entra",
    "azure ad","okta","powershell","shell","bash","python","sso","mfa","iam","group policy","gpo"] },
  { name: "Databases", keys: ["mssql","sql server","mysql","postgresql","mongodb","dynamodb","snowflake","oracle","mariadb","database"] },
  { name: "Networking", keys: ["tcp/ip","tcp","ip","dns","dhcp","vpn","proxy","firewall","routing","switching","wan","lan",
    "nat","bgp","ospf","subnetting","load balancer"] },
  { name: "Monitoring", keys: ["monitoring","logging","logs","apm","prometheus","grafana","datadog","new relic","elastic","elk"] },
  { name: "Security", keys: ["siem","soc","edr","xdr","incident response","vulnerability","vulnerabilities","vuln","patch","patching",
    "remediation","risk","compliance","nist","cis","iso 27001","framework","ism","threat", "incident management", "incident"] },
  { name: "Certs", keys: ["cissp","ccsp","cism","cisa","ceh","oscp","gcih","gcfa","grem","gcsa","sec+","security+","cysa+","pentest+","ccna","ccnp"] }
];

function bucketOf(skill) {
  const s = (skill || "").toLowerCase();
  for (const b of BUCKETS) {
    for (const k of b.keys) {
      if (s === k) return b.name;
      if (s.includes(k)) return b.name;
    }
  }
  return "Other";
}

function bucketize(list) {
  const out = {};
  for (const b of BUCKETS) out[b.name] = [];
  out["Other"] = [];

  for (const item of list) {
    const b = bucketOf(item);
    out[b].push(item);
  }

  // de-dupe inside each bucket
  for (const k of Object.keys(out)) {
    out[k] = [...new Set(out[k])];
  }
  return out;
}

function collapseToMustHave(skillList, mustList) {
  const mustSet = new Set(mustList.map(x => x.toLowerCase()));
  const out = [];

  for (const s of skillList) {
    const sl = s.toLowerCase();

    // if phrase contains any must-have tool, skip the phrase
    // (the tool itself is already in the list)
    if (sl.includes(" ") && [...mustSet].some(m => sl.includes(m))) {
      continue;
    }
    out.push(s);
  }

  return out;
}

function formatBuckets(bucketMap, maxPerBucket = 4) {
  const lines = [];
  for (const b of BUCKETS.map(x => x.name).concat(["Other"])) {
    const items = bucketMap[b] || [];
    if (!items.length) continue;
    lines.push(`${b}: ${items.slice(0, maxPerBucket).map(prettySkill).join(", ")}`);
  }
  return lines.join("\n");
}

function prettySkill(s) {
  if (!s) return "";
  const map = {
    "aws": "AWS",
    "gcp": "GCP",
    "vpc": "VPC",
    "ec2": "EC2",
    "ci/cd": "CI/CD",
    "mssql": "SQL Server",
    "iis": "IIS",
    "tcp/ip": "TCP/IP",
    "apm": "APM",
    "active_directory": "Active Directory",
    "microsoft_365": "Microsoft 365",
    "cloudformation": "CloudFormation",
    "vpn": "VPN",
    "iam": "IAM",
    "cloudwatch": "CloudWatch",
    "datadog": "Datadog",
    "metrics": "Metrics"
  };

  const lower = s.toLowerCase();
  if (map[lower]) return map[lower];

  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function extractMustHaveTech(text) {
  const t = (text || "").toLowerCase();

  const patterns = [
    // IaC / automation
    { key: "terraform", re: /\bterraform\b/ },
    { key: "ansible", re: /\bansible\b/ },
    { key: "cloudformation", re: /\bcloudformation\b|\bcloud\s*formation\b/ },

    // CI/CD
    { key: "ci/cd", re: /\bci\/cd\b|\bcicd\b|\bcontinuous\s+integration\b|\bcontinuous\s+delivery\b|\bcd\b/ },
    { key: "gitlab", re: /\bgitlab\b/ },
    { key: "jenkins", re: /\bjenkins\b/ },

    // Scripting
    { key: "python", re: /\bpython\b/ },
    { key: "shell", re: /\bshell\b/ },
    { key: "powershell", re: /\bpowershell\b/ },

    // OS / platforms
    { key: "linux", re: /\blinux\b|\bunix\b/ },
    { key: "windows server", re: /\bwindows\s+server\b/ },
    { key: "iis", re: /\biis\b|\binternet\s+information\s+services\b/ },
    { key: "active directory", re: /\bactive\s+directory\b|\bad\b/ },

    // AWS core services
    { key: "aws", re: /\baws\b|\bamazon\s+web\s+services\b/ },
    { key: "ec2", re: /\bec2\b/ },
    { key: "vpc", re: /\bvpc\b/ },
    { key: "s3", re: /\bs3\b/ },
    { key: "cloudwatch", re: /\bcloudwatch\b/ },
    { key: "datadog", re: /\bdatadog\b/ },

    // GCP
    { key: "gcp", re: /\bgcp\b|\bgoogle\s+cloud\b/ },

    // Databases
    { key: "mssql", re: /\bmicrosoft\s+sql\s+server\b|\bsql\s+server\b|\bmssql\b/ },
    { key: "dynamodb", re: /\bdynamodb\b/ },
    { key: "snowflake", re: /\bsnowflake\b/ },

    // Networking
    { key: "tcp/ip", re: /\btcp\/ip\b|\btcp\b/ },
    { key: "firewall", re: /\bfirewall\b/ },
    { key: "dns", re: /\bdns\b/ },
    { key: "vpn", re: /\bvpns?\b/ },
    { key: "encryption", re: /\bencryption\b|\bencrypt(ed|ing)?\b/ },
    { key: "iam", re: /\biam\b|\bidentity\s+and\s+access\s+management\b/ },

    // Monitoring / APM
    { key: "apm", re: /\bapm\b|\bapplication\s+performance\s+monitoring\b/ },
    { key: "monitoring", re: /\bmonitoring\b/ },
    { key: "logging", re: /\blogging\b|\blogs\b/ },
    { key: "metrics", re: /\bmetrics\b/ },
  ];

  const out = [];
  for (const p of patterns) {
    if (p.re.test(t)) out.push(p.key);
  }
  return out;
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
    .replace(/operating procedures/gi, "operating_procedures")
    .replace(/\bcicd\b/gi, "ci/cd")
    .replace(/cloud formation/gi, "cloudformation")
    .replace(/microsoft sql server/gi, "mssql")
    .replace(/\bsql server\b/gi, "mssql")
    .replace(/\bpowershell\b/gi, "power_shell");

  const stop = STOP_WORDS;

  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")   // keep underscores now
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stop.has(w));
}


