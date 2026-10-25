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
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_AI = Number(process.env.MAX_AI_DRAFTS || 25);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const pText = await readFile(new URL("pending.json", DATA), "utf8");
const pending = JSON.parse(pText);
const videos = JSON.parse(await readFile(new URL("videos.json", DATA), "utf8")).videos || [];
const subjectsFor = cat => [...new Set(videos.filter(v => v.category === cat && v.subject).map(v => v.subject))];

let rules = 0, ai = 0, aiFail = 0;
for (const item of pending.queue || []) {
  const category = item.suggestedCategory || "";
  if (!item.draft) {
    item.draft = ruleDraft({ title: item.title, description: item.description, category, videos });
    rules++;
  }
  if (KEY && item.draft.source !== "ai" && (item.aiTries || 0) < 3 && ai + aiFail < MAX_AI) {
    try {
      item.draft = aiDraft ? await aiDraft({ yt: item.yt, title: item.title, category, subjects: subjectsFor(category), key: KEY, model: MODEL }) : item.draft;
      delete item.aiTries;
      ai++;
      console.log(`  ✓ AI draft: ${item.title}`);
    } catch (e) {
      item.aiTries = (item.aiTries || 0) + 1;
      aiFail++;
      console.log(`  ! AI draft failed for ${item.yt}: ${e.message}`);
      if (/API key|permission|quota|RESOURCE_EXHAUSTED/i.test(e.message)) break;
    }
    await sleep(7000); // stay inside the free-tier rate limit
  }
}
const out = JSON.stringify(pending, null, 2) + "\n";
if (out !== pText) await writeFile(new URL("pending.json", DATA), out);
console.log(`Drafts: ${rules} from description/rules, ${ai} by Gemini${KEY ? "" : " (no GEMINI_API_KEY set)"}, ${aiFail} Gemini failures.`);
