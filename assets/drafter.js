/* ABFM Training — automatic first drafts for new videos.
   Used by the daily GitHub job (scripts/draft.mjs) and by the admin "Auto-draft" button.
   Two ways of drafting:
   1. Gemini (if a free Gemini API key is set): it watches the YouTube video and writes the summary, safety note and steps.
   2. Built-in rules: summary from the YouTube description, steps from the video's chapters,
      safety note and PPE from the trade and keywords in the title.
   Drafts are never published on their own — they only pre-fill the form you approve. */
(function (root) {
  "use strict";

  /* Safety note + PPE by keyword (first match wins, checked before the trade defaults). */
  const RULES = [
    { re: /\b(lock ?out|tag ?out|loto|isolat)/i, safety: "Isolate the energy source, lock and tag it, and prove it is dead before you touch anything.", ppe: ["Safety Glasses", "Insulated Gloves", "Safety Shoes"] },
    { re: /\b(harness|fall arrest|working at height|scaffold|roof)/i, safety: "Wear a full-body harness clipped to a rated anchor point, and inspect it before every use.", ppe: ["Full-Body Harness", "Hard Hat", "Safety Shoes"] },
    { re: /\b(ladder|step ?ladder)/i, safety: "Inspect the ladder first, keep three points of contact and never stand on the top rungs.", ppe: ["Hard Hat", "Safety Shoes", "Work Gloves"] },
    { re: /\b(confined space|manhole|sump|tank entry|inside the tank)/i, safety: "Never enter without a permit, gas test, standby person and rescue plan.", ppe: ["Gas Detector", "Full-Body Harness", "Respirator", "Hard Hat"] },
    { re: /\b(braz|solder|weld|torch|hot work|cutting disc|grind)/i, safety: "Hot work: get the permit, clear flammables, keep an extinguisher close and purge with nitrogen when brazing.", ppe: ["Welding Gloves", "Shaded Goggles", "Fire-Resistant Clothing"] },
    { re: /\b(refrigerant|recover|r-?410|r-?32|r-?22|charging|charge the)/i, safety: "Refrigerant can freeze skin and eyes in seconds. Wear gloves and goggles and never vent it to air.", ppe: ["Safety Goggles", "Cold-Resistant Gloves"] },
    { re: /\b(acid|chemical|coil clean|descal|chlorin|disinfect|bleach)/i, safety: "Read the chemical's safety data sheet, ventilate the area and never mix chemicals.", ppe: ["Chemical Gloves", "Safety Goggles", "Respirator"] },
    { re: /\b(paint|spray|epoxy|waterproof|primer|sealant)/i, safety: "Ventilate the area, keep ignition sources away and protect your eyes and lungs from fumes and spray.", ppe: ["Respirator", "Safety Goggles", "Chemical Gloves"] },
    { re: /\b(sprinkler|fire alarm|extinguisher|fire pump|fire panel|fm-?200|suppression)/i, safety: "Inform the building and the alarm monitoring company before testing, and never leave a system disabled.", ppe: ["Safety Glasses", "Work Gloves", "Safety Shoes"] },
    { re: /\b(duct|grease|kitchen exhaust|hood)/i, safety: "Isolate the fans before opening ducts, and watch for sharp edges and grease fire risk.", ppe: ["Cut-Resistant Gloves", "Dust Mask", "Safety Goggles"] },
    { re: /\b(mower|trimmer|chainsaw|hedge|blower|strimmer)/i, safety: "Check guards before starting, keep people clear and stop the engine before clearing blockages.", ppe: ["Ear Defenders", "Safety Goggles", "Safety Shoes"] },
    { re: /\b(drill|saw|cutter|power tool|grinder|core drill)/i, safety: "Check the tool and lead before use, keep guards on and unplug before changing bits or blades.", ppe: ["Safety Glasses", "Ear Defenders", "Work Gloves"] },
    { re: /\b(heat stress|heat stroke|summer|dehydrat)/i, safety: "Drink water often, take breaks in the shade and report dizziness or headache at once.", ppe: ["Cooling Vest", "Hard Hat", "Sun Protection"] },
    { re: /\b(lift|manual handling|carry|hoist|rigging|sling)/i, safety: "Plan the lift, get help for heavy loads and keep the load close to your body.", ppe: ["Work Gloves", "Safety Shoes", "Hard Hat"] }
  ];
  const TRADE = {
    "Health & Safety": { safety: "Follow the site's permit and safety rules, and stop work if anything feels unsafe.", ppe: ["Hard Hat", "Safety Shoes", "Hi-Vis Vest"] },
    "HVAC": { safety: "Isolate power at the unit before opening panels, and watch for hot, cold and moving parts.", ppe: ["Safety Glasses", "Work Gloves", "Safety Shoes"] },
    "Electrical": { safety: "Isolate and prove dead before any work. Only qualified staff may work near live parts.", ppe: ["Insulated Gloves", "Safety Glasses", "Safety Shoes"] },
    "Plumbing": { safety: "Shut off and drain the water supply first, and watch for hot water and wet floors.", ppe: ["Work Gloves", "Safety Glasses", "Safety Shoes"] },
    "Water Tank Cleaning": { safety: "Tank entry is confined-space work: permit, gas test, ventilation and a standby person are required.", ppe: ["Gas Detector", "Respirator", "Chemical Gloves", "Rubber Boots"] },
    "Duct Cleaning": { safety: "Isolate the fans before opening ducts, and watch for sharp edges and dust.", ppe: ["Dust Mask", "Cut-Resistant Gloves", "Safety Goggles"] },
    "Civil Jobs": { safety: "Keep the area barricaded, use tools with guards and lift heavy materials with help.", ppe: ["Hard Hat", "Safety Shoes", "Work Gloves", "Safety Glasses"] },
    "Painting & Waterproofing": { safety: "Ventilate the area, keep ignition sources away and protect your eyes and lungs.", ppe: ["Respirator", "Safety Goggles", "Chemical Gloves"] },
    "Landscaping": { safety: "Check guards before starting machines, keep people clear and drink water often in the heat.", ppe: ["Ear Defenders", "Safety Goggles", "Safety Shoes", "Work Gloves"] },
    "Fire Systems": { safety: "Inform the building and monitoring company before testing, and never leave a system disabled.", ppe: ["Safety Glasses", "Work Gloves", "Safety Shoes"] }
  };
  const DEFAULT_TRADE = { safety: "Check the area is safe, use the right tools and stop work if anything feels unsafe.", ppe: ["Safety Glasses", "Work Gloves", "Safety Shoes"] };

  const JUNK = /(subscribe|patreon|sponsor|affiliate|amazon|discount|promo|merch|instagram|facebook|tiktok|twitter|follow (me|us)|join (this|the) channel|membership|business inquir|email me|disclaimer|music by|#\w+|https?:\/\/|www\.|\bcode\b.*\boff\b|link(s)? below)/i;
  const SKIP_CHAPTER = /^(intro(duction)?|outro|end( ?screen)?|start|welcome|thanks?( for watching)?|conclusion|final thoughts|summary|subscribe|sponsor|ad|q ?& ?a|bloopers?|wrap ?up|recap)\b/i;

  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  function chapters(desc) {
    const out = [];
    for (const raw of String(desc || "").split(/\n/)) {
      const m = raw.match(/^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|.]?\s*(.{3,})$/) ||
                raw.match(/^\s*(.{3,}?)\s*[-–—:|]\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*$/);
      if (!m) continue;
      let text = /\d:\d\d/.test(m[1]) ? m[2] : m[1];
      text = clean(text.replace(/^[-–—:|.\s]+/, "").replace(/[🕐-🕧⏱️▶️👉✅]/gu, ""));
      if (!text || SKIP_CHAPTER.test(text) || JUNK.test(text)) continue;
      out.push(cap(text.length > 90 ? text.slice(0, 87) + "…" : text));
    }
    return out.length >= 3 ? out.slice(0, 8) : [];
  }

  function summary(desc, title) {
    const lines = String(desc || "").split(/\n/).map(clean).filter(l => l && !JUNK.test(l) && !/\d:\d\d/.test(l) && !/^[=*_\-#]+/.test(l) && l.length > 25);
    const text = lines.join(" ");
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || (text ? [text] : [])).map(clean).filter(s => s.length > 20);
    let s = "";
    for (const x of sentences) { if ((s + " " + x).length > 260) break; s = clean(s + " " + x); if (s.length > 120) break; }
    if (!s && sentences[0]) s = sentences[0].slice(0, 257) + "…";
    s = s.replace(/^(in (this|today'?s) video,?\s+)?(we|i)('ll| will| are going to| am going to)?\s+(take a look at|look at|show( you)?( how to)?|go over|explain|cover|demonstrate|walk you through)\s+/i, (m, a, b, c, d, verb) => /how to/i.test(verb) ? "Shows how to " : "Shows ");
    s = s.replace(/^in (this|today'?s) video,?\s+/i, "");
    return s ? cap(s) : "";
  }

  function level(text) {
    if (/\b(basic|basics|beginner|introduction|intro to|explained|what is|how .* works|for new|101|getting started|how to use)\b/i.test(text)) return "Beginner";
    if (/\b(troubleshoot|diagnos|fault[- ]?find|advanced|commission|calibrat|in[- ]depth|deep dive|design|programming)\b/i.test(text)) return "Advanced";
    return "Intermediate";
  }

  function subject(title, category, videos) {
    const words = new Set(String(title).toLowerCase().match(/[a-z]{4,}/g) || []);
    let best = null, score = 0;
    for (const v of videos || []) {
      if (v.category !== category || !v.subject) continue;
      const w = (String(v.title).toLowerCase().match(/[a-z]{4,}/g) || []).filter(x => words.has(x)).length;
      if (w > score) { score = w; best = v.subject; }
    }
    return best || "";
  }

  function safetyFor(text, category) {
    const r = RULES.find(x => x.re.test(text));
    const t = TRADE[category] || DEFAULT_TRADE;
    return r ? { safety: r.safety, ppe: r.ppe } : { safety: t.safety, ppe: t.ppe };
  }

  /* Built-in draft (no internet needed). */
  function ruleDraft({ title, description, category, videos }) {
    const desc = /^Suggested starter video/i.test(description || "") ? "" : description;
    const text = title + " " + (desc || "").slice(0, 400);
    const s = safetyFor(text, category);
    return {
      source: "rules",
      summary: summary(desc, title),
      safety: s.safety,
      ppe: s.ppe.slice(),
      steps: chapters(desc),
      level: level(title + " " + (desc || "").slice(0, 200)),
      subject: subject(title, category, videos)
    };
  }

  /* Gemini draft: the model watches the public YouTube video. */
  function aiPrompt({ title, category, subjects }) {
    return `You are writing a short training card for facility-maintenance technicians in Dubai (many speak basic English).
Watch this YouTube video ("${title}", trade: ${category}) and reply with JSON only, in this exact shape:
{"summary": string, "safety": string, "ppe": string[], "steps": string[], "level": "Beginner"|"Intermediate"|"Advanced", "subject": string}
Rules:
- summary: 1–2 plain sentences saying what the video shows. No hype, no channel name.
- safety: one sentence with the most important safety precaution for this task.
- ppe: 2–4 items of protective equipment, Title Case (e.g. "Safety Glasses").
- steps: 3–6 key steps actually shown in the video, each a short instruction under 14 words, starting with a verb. If the video is not a procedure, give the 3–6 key points instead.
- level: who the video suits.
- subject: a short topic label${subjects && subjects.length ? `; prefer one of: ${subjects.slice(0, 25).join("; ")}` : ""}.
Use simple words. Do not invent steps that are not in the video.`;
  }
  function parseAI(text) {
    const m = String(text || "").match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON in reply");
    const j = JSON.parse(m[0]);
    const arr = a => (Array.isArray(a) ? a : []).map(clean).filter(Boolean);
    const d = {
      source: "ai",
      summary: clean(j.summary).slice(0, 400),
      safety: clean(j.safety).slice(0, 300),
      ppe: arr(j.ppe).slice(0, 5),
      steps: arr(j.steps).map(s => s.replace(/^\d+[.)]\s*/, "")).slice(0, 8),
      level: ["Beginner", "Intermediate", "Advanced"].includes(j.level) ? j.level : "Intermediate",
      subject: clean(j.subject).slice(0, 60)
    };
    if (!d.summary || d.steps.length < 2) throw new Error("Reply was incomplete");
    return d;
  }
  async function aiDraft({ yt, title, category, subjects, key, model, timeoutMs }) {
    const m = model || "gemini-2.5-flash";
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs || 120000) : null;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctl ? ctl.signal : undefined,
        body: JSON.stringify({
          contents: [{ parts: [
            { file_data: { file_uri: "https://www.youtube.com/watch?v=" + yt } },
            { text: aiPrompt({ title, category, subjects }) }
          ] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
      const text = (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || "").join("") || "";
      return parseAI(text);
    } finally { if (timer) clearTimeout(timer); }
  }

  /* Duplicate check: compares the meaningful words of two titles (0 = nothing in common, 1 = same). */
  const STOP = new Set("a an the and or of for to in on with your you how what why is are it its this that from by at as be do does using use used easy simple quick guide tutorial video explained explanation step steps full complete beginner beginners basic basics part new best way ways diy pro like professional training tips tip learn lesson course 2023 2024 2025 2026 vs".split(" "));
  const stem = w => w.replace(/(ings|ing|ers|er|es|ed|s)$/, "").replace(/(.)\1$/, "$1");
  const tokens = t => new Set(String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 1 && !STOP.has(w)).map(stem).filter(w => w.length > 1));
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let n = 0; A.forEach(x => { if (B.has(x)) n++; });
    return 2 * n / (A.size + B.size);
  }
  const DUP = 0.66;
  /* items: [{yt, title, ...}] → those that look like the same video or the same topic, best match first. */
  function findDuplicates(target, items) {
    const out = [];
    for (const it of items || []) {
      if (!it || it === target) continue;
      if (target.yt && it.yt === target.yt) { out.push({ item: it, score: 1, same: true }); continue; }
      const sc = similarity(target.title, it.title);
      if (sc >= DUP) out.push({ item: it, score: sc, same: false });
    }
    return out.sort((x, y) => y.score - x.score);
  }

  root.ABDraft = { ruleDraft, aiDraft, chapters, summary, level, safetyFor, similarity, findDuplicates };
})(typeof globalThis !== "undefined" ? globalThis : this);
