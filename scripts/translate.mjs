// Auto-translates every video (title, summary, safety, steps, PPE) and the announcement banner
// into all app languages, and saves them inside data/videos.json and data/settings.json.
// Runs on GitHub Actions whenever the video list changes, and every morning.
// Translations you type yourself in the admin are never overwritten.
// If English text changes, auto-translations for that video are refreshed.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const DATA = new URL("../data/", import.meta.url);
const LANGS = ["hi", "ur", "ml", "bn", "ta", "ne", "tl", "ar"];
const MAX_REQUESTS = Number(process.env.MAX_TRANSLATIONS || 900);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const START = Date.now(), TIME_BUDGET = 20 * 60 * 1000;   // stop after 20 min and save what's done; the next run continues
let requests = 0, failures = 0;

async function gtx(text, tl) {
  if (requests >= MAX_REQUESTS || Date.now() - START > TIME_BUDGET) throw new Error("limit");
  requests++;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "Mozilla/5.0" },
        body: "q=" + encodeURIComponent(text),
        signal: AbortSignal.timeout(15000)
      });
      if (r.status === 429) { await sleep(4000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      return (j[0] || []).map(seg => seg[0] || "").join("");
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(1500);
    }
  }
  throw new Error("rate limited");
}

// Translate a list of single-line strings in one request; fall back to one request per line if lines get merged.
async function translateLines(lines, tl) {
  const clean = lines.map(s => String(s || "").replace(/\s*\n\s*/g, " ").trim());
  const out = (await gtx(clean.join("\n"), tl)).split("\n").map(s => s.trim());
  if (out.length === clean.length) return out;
  const res = [];
  for (const line of clean) { res.push(line ? (await gtx(line, tl)).trim() : ""); await sleep(250); }
  return res;
}

const hashOf = v => createHash("sha1").update(JSON.stringify([v.title, v.summary, v.safety, v.steps || [], v.ppe || []])).digest("hex").slice(0, 12);

async function translateVideos(doc) {
  let changed = 0;
  for (const v of doc.videos) {
    const src = hashOf(v);
    v.tr = v.tr || {};
    for (const tl of LANGS) {
      const cur = v.tr[tl];
      const manual = cur && !cur.auto;
      if (manual) continue;                       // typed by the admin: keep
      if (cur && cur.src === src) continue;       // already up to date
      const steps = v.steps || [], ppe = v.ppe || [];
      const lines = [v.title, v.summary || "", v.safety || "", ...steps, ...ppe];
      try {
        const t = await translateLines(lines, tl);
        let i = 0;
        const out = { auto: true, src, title: t[i++], summary: t[i++], safety: t[i++] };
        out.steps = steps.map(() => t[i++]);
        out.ppe = ppe.map(() => t[i++]);
        if (!out.summary) delete out.summary;
        if (!out.safety) delete out.safety;
        v.tr[tl] = out;
        changed++;
      } catch (e) {
        failures++;
        if (e.message === "limit") return changed;
        console.log(`  ! ${v.id} [${tl}]: ${e.message}`);
        if (failures >= 12 && !changed) { console.log("Translation service not reachable, stopping."); return changed; }
      }
      await sleep(300);
    }
    if (!Object.keys(v.tr).length) delete v.tr;
  }
  return changed;
}

async function translateSettings(s) {
  const fields = ["announcement", "tagline"];
  const src = createHash("sha1").update(JSON.stringify(fields.map(f => s[f] || ""))).digest("hex").slice(0, 12);
  s.tr = s.tr || {};
  let changed = 0;
  for (const tl of LANGS) {
    if (s.tr[tl] && s.tr[tl].src === src) continue;
    try {
      const t = await translateLines(fields.map(f => s[f] || ""), tl);
      s.tr[tl] = { src, announcement: s.announcement ? t[0] : "", tagline: s.tagline ? t[1] : "" };
      changed++;
    } catch (e) { failures++; if (e.message === "limit") break; }
    await sleep(300);
  }
  return changed;
}

async function translatePaths(doc) {
  let changed = 0;
  for (const p of doc.paths || []) {
    const src = createHash("sha1").update(JSON.stringify([p.title, p.description || ""])).digest("hex").slice(0, 12);
    p.tr = p.tr || {};
    for (const tl of LANGS) {
      const cur = p.tr[tl];
      if (cur && (!cur.auto || cur.src === src)) continue;
      try {
        const t = await translateLines([p.title, p.description || ""], tl);
        p.tr[tl] = { auto: true, src, title: t[0], description: p.description ? t[1] : "" };
        changed++;
      } catch (e) { failures++; if (e.message === "limit") return changed; }
      await sleep(300);
    }
  }
  return changed;
}

const vText = await readFile(new URL("videos.json", DATA), "utf8");
const sText = await readFile(new URL("settings.json", DATA), "utf8");
const videos = JSON.parse(vText), settings = JSON.parse(sText);

let paths = null;
try { paths = JSON.parse(await readFile(new URL("paths.json", DATA), "utf8")); } catch {}

const nv = await translateVideos(videos);
const ns = await translateSettings(settings);
const np = paths ? await translatePaths(paths) : 0;
if (np) await writeFile(new URL("paths.json", DATA), JSON.stringify(paths, null, 2) + "\n");
if (nv) await writeFile(new URL("videos.json", DATA), JSON.stringify(videos, null, 2) + "\n");
if (ns) await writeFile(new URL("settings.json", DATA), JSON.stringify(settings, null, 2) + "\n");
console.log(`Translated ${nv} video/language pairs ${ns} settings languages and ${np} path translations using ${requests} requests (${failures} failed).`);
if (failures && !nv && !ns && !np) process.exitCode = 1;
