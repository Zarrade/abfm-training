// Writes a first draft (summary, safety note, PPE, steps, level, subject) for every video waiting in the review queue.
// With a GEMINI_API_KEY secret, Gemini watches each video and drafts from what it actually shows.
// Without one, drafts come from the YouTube description and chapters plus built-in safety rules.
// Drafts only pre-fill the approve form in the admin — nothing goes live without you.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../assets/drafter.js");
const { ruleDraft, aiDraft } = globalThis.ABDraft;

const DATA = new URL("../data/", import.meta.url);
const KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "";
const MAX_MINUTES = Number(process.env.MAX_AI_MINUTES || 360);   // free tier allows 8 hours of YouTube video a day
const MAX_AI = Number(process.env.MAX_AI_DRAFTS || 25);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const pText = await readFile(new URL("pending.json", DATA), "utf8");
const pending = JSON.parse(pText);
const videos = JSON.parse(await readFile(new URL("videos.json", DATA), "utf8")).videos || [];
const settings = JSON.parse(await readFile(new URL("settings.json", DATA), "utf8"));
const categories = (settings.categories || []).map(c => c.name);
const minutes = d => { const p = String(d || "").split(":").map(Number); return p.length > 1 && p.every(n => !isNaN(n)) ? p.reduce((a, n) => a * 60 + n, 0) / 60 : 15; };
let usedMin = 0;
const subjectsFor = cat => [...new Set(videos.filter(v => v.category === cat && v.subject).map(v => v.subject))];

let rules = 0, ai = 0, aiFail = 0;
for (const item of pending.queue || []) {
  const category = item.suggestedCategory || "";
  if (!item.draft) {
    item.draft = ruleDraft({ title: item.title, description: item.description, category, videos });
    rules++;
  }
  if (KEY && item.draft.source !== "ai" && (item.aiTries || 0) < 3 && ai + aiFail < MAX_AI && usedMin + minutes(item.duration) <= MAX_MINUTES) {
    usedMin += minutes(item.duration);
    try {
      item.draft = aiDraft ? await aiDraft({ yt: item.yt, title: item.title, category, subjects: subjectsFor(category), categories, key: KEY, model: MODEL }) : item.draft;
      delete item.aiTries; delete item.aiError;
      ai++;
      if (item.draft.category && categories.includes(item.draft.category) && !item.channelCategory) item.suggestedCategory = item.draft.category;
      console.log(`  ✓ Gemini (${item.draft.model}): ${item.title} → ${item.draft.review.recommend} ${item.draft.review.relevance}/10`);
    } catch (e) {
      item.aiTries = (item.aiTries || 0) + 1;
      item.aiError = String(e.message || e).slice(0, 200);
      aiFail++;
      console.log(`  ! AI draft failed for ${item.yt}: ${e.message}`);
      if (/API key|permission|quota|RESOURCE_EXHAUSTED/i.test(e.message)) break;
    }
    await sleep(7000); // stay inside the free-tier rate limit
  }
}
// Then check videos already in the library that Gemini hasn't reviewed yet (review only — your text is never changed).
const vText = await readFile(new URL("videos.json", DATA), "utf8");
const vDoc = JSON.parse(vText);
const MAX_LIB = Number(process.env.MAX_AI_LIBRARY || 15);
let lib = 0;
if (KEY) {
  for (const v of vDoc.videos || []) {
    if (v.gemini || lib >= MAX_LIB || ai + aiFail >= MAX_AI + MAX_LIB) continue;
    if ((v.geminiTries || 0) >= 3) continue;
    if (usedMin + minutes(v.duration) > MAX_MINUTES) break;
    usedMin += minutes(v.duration);
    try {
      const d = await aiDraft({ yt: v.yt, title: v.title, category: v.category, subjects: subjectsFor(v.category), categories, key: KEY, model: MODEL });
      v.gemini = { date: new Date().toISOString().slice(0, 10), model: d.model, ...d.review };
      delete v.geminiTries; lib++;
      console.log(`  ✓ Library check: ${v.title} → ${d.review.recommend} ${d.review.relevance}/10${d.review.unsafe.length ? " ⚠ unsafe practice" : ""}`);
    } catch (e) {
      v.geminiTries = (v.geminiTries || 0) + 1; aiFail++;
      console.log(`  ! Library check failed for ${v.yt}: ${e.message}`);
      if (/API key|permission|quota|RESOURCE_EXHAUSTED/i.test(e.message)) break;
    }
    await sleep(7000);
  }
}
const vOut = JSON.stringify(vDoc, null, 2) + "\n";
if (vOut !== vText) await writeFile(new URL("videos.json", DATA), vOut);

const out = JSON.stringify(pending, null, 2) + "\n";
if (out !== pText) await writeFile(new URL("pending.json", DATA), out);
console.log(`Library videos checked by Gemini: ${lib}.`);
console.log(`Drafts: ${rules} from description/rules, ${ai} by Gemini${KEY ? "" : " (no GEMINI_API_KEY set)"}, ${aiFail} Gemini failures.`);
