/**
 * ABFM Training — video request inbox.
 * Technicians send "Request a video" from the app; requests land in this Google Sheet,
 * and you read and manage them in the admin portal (Requests tab).
 *
 * Setup (about 5 minutes) — see "Request a video" in README.md:
 *  1. Create a new Google Sheet, then Extensions → Apps Script.
 *  2. Replace everything with this file and change ADMIN_KEY below to your own long password.
 *  3. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *  4. Copy the Web app URL into the admin portal: Settings → Request inbox, with the same ADMIN_KEY.
 */
const ADMIN_KEY = "CHANGE-THIS-TO-A-LONG-PASSWORD";
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
