/**
 * ABFM Training — private helper for the staff app.
 *  1. Video requests: technicians send "Request a video"; requests land in this Google Sheet,
 *     and you read and manage them in the admin portal (Requests tab).
 *  2. Ask AI: staff questions (and photos) are answered by Gemini. Your Gemini key stays here,
 *     private — it is never in the public app. Questions and photos are not saved anywhere.
 *
 * Setup (about 5 minutes) — also shown in the admin portal, Requests tab:
 *  1. Create a new Google Sheet, then Extensions → Apps Script.
 *  2. Replace everything with this file and change ADMIN_KEY below to your own long password.
 *  3. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *  4. Copy the Web app URL into the admin portal: Settings → Request inbox, with the same ADMIN_KEY.
 *  5. For "Ask AI": paste your Gemini key in GEMINI_KEY below, then tick "Show Ask AI to staff" in admin Settings.
 *  When you change this script later: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy
 *  (this keeps the same Web app URL).
 */
const ADMIN_KEY = "CHANGE-THIS-TO-A-LONG-PASSWORD";
const GEMINI_KEY = "";            // paste your Gemini API key between the quotes to turn on "Ask AI"
const AI_PER_HOUR = 300;          // safety limits so nobody can use up your free quota
const AI_PER_DAY = 2000;
const AI_PER_DEVICE_HOUR = 30;
const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
const SHEET = "Requests";
const HEAD = ["id", "time", "topic", "category", "details", "name", "site", "lang", "status"];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function clip_(v, n) {
  let s = String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  if (/^[=+\-@]/.test(s)) s = "'" + s;          // stop spreadsheet formulas
  return s;
}
function keyOk_(k) { return ADMIN_KEY !== "CHANGE-THIS-TO-A-LONG-PASSWORD" && String(k || "") === ADMIN_KEY; }

/* Admin: list requests.  GET ?key=... */
function doGet(e) {
  if (!keyOk_(e.parameter.key)) return json_({ ok: false, error: "key" });
  const rows = sheet_().getDataRange().getValues();
  rows.shift();
  const list = rows.filter(r => r[0]).map(r => {
    const o = {}; HEAD.forEach((h, i) => o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]); return o;
  });
  return json_({ ok: true, requests: list.reverse() });
}

/* Technicians: send a request.  Admin: {key, action:"status"|"delete", id, status} */
function doPost(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad" }); }
  if (b.action === "ask") {
    try { return json_(ask_(b)); } catch (err) { return json_({ ok: false, error: "error", detail: String(err).slice(0, 200) }); }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    if (b.action) {
      if (!keyOk_(b.key)) return json_({ ok: false, error: "key" });
      const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]));
      const row = ids.indexOf(String(b.id)) + 1;
      if (row < 2) return json_({ ok: false, error: "notfound" });
      if (b.action === "delete") sh.deleteRow(row);
      else sh.getRange(row, HEAD.indexOf("status") + 1).setValue(clip_(b.status, 20) || "new");
      return json_({ ok: true });
    }
    if (b.website) return json_({ ok: true });                    // spam trap
    const topic = clip_(b.topic, 200);
    if (!topic) return json_({ ok: false, error: "topic" });
    const cache = CacheService.getScriptCache();                  // simple flood protection
    const n = Number(cache.get("n") || 0);
    if (n > 40) return json_({ ok: false, error: "busy" });
    cache.put("n", String(n + 1), 60);
    if (sh.getLastRow() > 5000) return json_({ ok: false, error: "full" });
    sh.appendRow([Utilities.getUuid().slice(0, 8), new Date(), topic, clip_(b.category, 60), clip_(b.details, 1000),
      clip_(b.name, 80), clip_(b.site, 80), clip_(b.lang, 5), "new"]);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

/* ---------- Ask AI ---------- */
function count_(key, limit, seconds) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get(key) || 0);
  if (n >= limit) return false;
  c.put(key, String(n + 1), seconds);
  return true;
}
function dayCount_(limit) {
  const p = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), "Asia/Dubai", "yyyy-MM-dd");
  const lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    const cur = JSON.parse(p.getProperty("aiDay") || "{}");
    const n = cur.day === day ? cur.n : 0;
    if (n >= limit) return false;
    p.setProperty("aiDay", JSON.stringify({ day: day, n: n + 1 }));
    return true;
  } finally { lock.releaseLock(); }
}
function ask_(b) {
  const key = GEMINI_KEY || PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";
  if (!key) return { ok: false, error: "off" };
  const hour = Utilities.formatDate(new Date(), "UTC", "yyyyMMddHH");
  const dev = String(b.device || "x").replace(/[^\w-]/g, "").slice(0, 20);
  if (!count_("aih" + hour, AI_PER_HOUR, 3700) || !count_("aid" + dev + hour, AI_PER_DEVICE_HOUR, 3700) || !dayCount_(AI_PER_DAY)) return { ok: false, error: "busy" };

  const text = String(b.text || "").slice(0, 1500);
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 3)
    .filter(i => i && /^image\/(jpeg|png|webp)$/.test(i.mime) && typeof i.data === "string" && i.data.length < 2000000);
  if (!text && !images.length) return { ok: false, error: "empty" };
  const catalog = (Array.isArray(b.catalog) ? b.catalog : []).slice(0, 300).map(x => String(x).slice(0, 200));
  const lang = String(b.langName || "English").slice(0, 30);

  const system =
`You are the ABFM Training AI helper for facility-maintenance technicians at Al Bonian Facilities Management in Dubai (HVAC, electrical, plumbing, fire systems, water tank and duct cleaning, civil, painting, landscaping, health & safety).
Answer in ${lang}, in simple words, for someone with basic schooling. Be practical and short: under 180 words. Use numbered steps for procedures.
Safety first: if the task is dangerous (live electrical work, refrigerant, height, confined space, hot work, chemicals, gas), say so clearly, mention the permit/isolation/PPE needed, and say to ask the supervisor when the job needs a qualified person. Never explain how to bypass safety devices, interlocks, alarms or fire systems.
If a photo is attached, describe what you see that matters, then answer. If you can't tell from the photo, say what extra photo or detail would help.
If the question is not about maintenance, safety or this training, politely say you can only help with work topics.
Training library (id | title | trade / subject):
${catalog.join("\n")}
Reply with JSON only: {"answer": string, "videos": [up to 3 ids from the library that really match the question, best first, or empty]}.`;

  const contents = [];
  (Array.isArray(b.history) ? b.history : []).slice(-8).forEach(h => {
    const t = String(h && h.text || "").slice(0, 1500);
    if (t) contents.push({ role: h.role === "model" ? "model" : "user", parts: [{ text: t }] });
  });
  const parts = images.map(i => ({ inline_data: { mime_type: i.mime, data: i.data } }));
  parts.push({ text: text || "What do you see in this photo, and what should I check or do?" });
  contents.push({ role: "user", parts: parts });
  const body = { system_instruction: { parts: [{ text: system }] }, contents: contents,
    generationConfig: { temperature: 0.3, responseMimeType: "application/json" } };

  let last = "";
  for (const m of MODELS) {
    const r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
      method: "post", contentType: "application/json", headers: { "x-goog-api-key": key },
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    if (code === 404) { last = "model"; continue; }
    if (code === 429) return { ok: false, error: "busy" };
    if (code !== 200) return { ok: false, error: "error", detail: r.getContentText().slice(0, 200) };
    const j = JSON.parse(r.getContentText());
    const out = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const raw = out.map(p => p.text || "").join("");
    let ans;
    try { ans = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch (err) { ans = { answer: raw }; }
    const ids = new Set(catalog.map(x => x.split(" | ")[0].trim()));
    return { ok: true, model: m, answer: String(ans.answer || raw || "").slice(0, 4000),
      videos: (Array.isArray(ans.videos) ? ans.videos : []).map(String).filter(id => ids.has(id)).slice(0, 3) };
  }
  return { ok: false, error: "error", detail: last };
}
