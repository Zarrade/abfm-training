/* Al Bonian FM — Training admin.
   Saves changes by committing the JSON files in /data to your GitHub repo.
   Your GitHub token is kept only in this browser. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const thumb = yt => `https://i.ytimg.com/vi/${encodeURIComponent(yt)}/mqdefault.jpg`;
  const LEVELS = ["Beginner", "Intermediate", "Advanced"];
  const TR_LANGS = [["hi", "Hindi"], ["ur", "Urdu"], ["ml", "Malayalam"], ["bn", "Bengali"], ["ta", "Tamil"], ["ne", "Nepali"], ["tl", "Filipino"], ["ar", "Arabic"]];
  const CFG_KEY = "ab_admin_cfg";
  const FILES = { videos: "data/videos.json", settings: "data/settings.json", channels: "data/channels.json", pending: "data/pending.json", health: "data/health.json" };
  const DEFAULTS = {
    videos: () => ({ updated: today(), videos: [] }),
    settings: () => ({ categories: [], newDays: 7 }),
    channels: () => ({ lookbackDays: 21, skipShorts: true, maxQueue: 150, channels: [] }),
    pending: () => ({ lastRun: null, channelStatus: {}, queue: [], rejected: [] }),
    health: () => ({ checked: null, problems: [] })
  };

  let cfg = loadCfg();
  const data = {};
  let view = "videos";
  const ui = { q: "", cat: "ALL", show: "all" };

  /* ---------- small UI helpers ---------- */
  let tt;
  function toast(m) { const el = $("#toast"); el.textContent = m; el.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => el.classList.remove("show"), 2600); }
  const busy = on => { $("#saving").hidden = !on; };

  /* ---------- config ---------- */
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || sessionStorage.getItem(CFG_KEY) || "null"); } catch { return null; }
  }
  function saveCfg(c, remember) {
    const s = JSON.stringify(c);
    localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY);
    (remember ? localStorage : sessionStorage).setItem(CFG_KEY, s);
  }
  function guessRepo() {
    const h = location.hostname;
    if (h.endsWith(".github.io")) {
      const owner = h.split(".")[0];
      const seg = location.pathname.split("/").filter(Boolean)[0];
      return { owner, repo: seg && !seg.endsWith(".html") ? seg : h };
    }
    return { owner: "", repo: "" };
  }

  /* ---------- GitHub API ---------- */
  async function gh(path, opts = {}) {
    const r = await fetch("https://api.github.com" + path, {
      method: opts.method || "GET",
      headers: {
        Authorization: "Bearer " + cfg.token,
        Accept: opts.accept || "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store"
    });
    return r;
  }
  const enc = s => { const b = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); };
  const dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

  async function readFile(key) {
    const path = `/repos/${cfg.owner}/${cfg.repo}/contents/${FILES[key]}?ref=${encodeURIComponent(cfg.branch)}`;
    const r = await gh(path);
    if (r.status === 404) return { json: DEFAULTS[key](), sha: null };
    if (!r.ok) throw new Error(`Could not read ${FILES[key]} (${r.status})`);
    const j = await r.json();
    let text = j.content ? dec(j.content) : "";
    if (!text) text = await (await gh(path, { accept: "application/vnd.github.raw+json" })).text();
    return { json: JSON.parse(text), sha: j.sha };
  }
  async function writeFile(key, json, sha, message) {
    const body = { message, content: enc(JSON.stringify(json, null, 2) + "\n"), branch: cfg.branch };
    if (sha) body.sha = sha;
    const r = await gh(`/repos/${cfg.owner}/${cfg.repo}/contents/${FILES[key]}`, { method: "PUT", body });
    if (r.status === 409 || r.status === 422) { const e = new Error("conflict"); e.conflict = true; throw e; }
    if (!r.ok) {
      let msg = r.status;
      try { msg = (await r.json()).message; } catch {}
      throw new Error(`GitHub refused the save: ${msg}`);
    }
    return (await r.json()).content.sha;
  }
  /* Read the latest copy, apply the change, save. Retries if the file changed meanwhile (e.g. the daily job ran). */
  async function update(key, fn, message) {
    busy(true);
    try {
      for (let i = 0; i < 3; i++) {
        const { json, sha } = await readFile(key);
        const next = fn(json) || json;
        try {
          const newSha = await writeFile(key, next, sha, message);
          data[key] = { json: next, sha: newSha };
          return next;
        } catch (e) { if (!e.conflict || i === 2) throw e; }
      }
    } catch (e) {
      alert(e.message || String(e));
      throw e;
    } finally { busy(false); }
  }

  /* ---------- YouTube helpers ---------- */
  function parseYT(s) {
    s = (s || "").trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/|\/v\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  async function fetchMeta(yt) {
    const watch = "https://www.youtube.com/watch?v=" + yt;
    const tries = [
      "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watch),
      "https://noembed.com/embed?url=" + encodeURIComponent(watch)
    ];
    for (const u of tries) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const j = await r.json();
        if (j && j.title) return { title: j.title, channel: j.author_name || "" };
      } catch {}
    }
    return null;
  }

  /* ---------- connect screen ---------- */
  function renderConnect(error) {
    $("#tabs").hidden = true; $("#disconnect").hidden = true; $("#repo-label").textContent = "Not connected";
    const g = cfg || guessRepo();
    $("#app").innerHTML = `
      <div class="connect">
        <div class="card-plain">
          <h2>Connect to your GitHub repo</h2>
          <p>Changes you make here are saved straight to the repo, and the site updates for all staff in about a minute.</p>
          ${error ? `<div class="err">${esc(error)}</div>` : ""}
          <form id="connect-form">
            <div class="two">
              <div class="field"><label for="c-owner">GitHub username</label><input class="input" id="c-owner" required value="${esc(g.owner || "")}" autocapitalize="off" spellcheck="false"></div>
              <div class="field"><label for="c-repo">Repo name</label><input class="input" id="c-repo" required value="${esc(g.repo || "")}" autocapitalize="off" spellcheck="false"></div>
            </div>
            <div class="field"><label for="c-branch">Branch</label><input class="input" id="c-branch" value="${esc((cfg && cfg.branch) || "main")}" autocapitalize="off" spellcheck="false"></div>
            <div class="field"><label for="c-token">Access token</label><input class="input" id="c-token" type="password" required autocomplete="off" spellcheck="false" placeholder="github_pat_…">
              <div class="help">Kept only in this browser. Never share it.</div></div>
            <label class="check"><input type="checkbox" id="c-remember" checked> Stay signed in on this device</label>
            <button class="btn btn-primary" style="width:100%;margin-top:8px">Connect</button>
          </form>
        </div>
        <details class="box">
          <summary>How to get an access token (one time, 3 minutes)</summary>
          <ol class="steps-help">
            <li>On github.com open your profile picture → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
            <li>Name it “Training admin”. Set expiry to 1 year.</li>
            <li><b>Repository access</b>: Only select repositories → pick this training repo.</li>
            <li><b>Permissions</b> → Repository permissions: <b>Contents: Read and write</b>. Also <b>Actions: Read and write</b> if you want the “Find new videos now” button.</li>
            <li>Generate, copy the token and paste it above.</li>
          </ol>
        </details>
      </div>`;
    $("#connect-form").onsubmit = async e => {
      e.preventDefault();
      const c = { owner: $("#c-owner").value.trim(), repo: $("#c-repo").value.trim(), branch: $("#c-branch").value.trim() || "main", token: $("#c-token").value.trim() };
      cfg = c;
      busy(true);
      try {
        const r = await gh(`/repos/${c.owner}/${c.repo}`);
        if (r.status === 401) throw new Error("The token was not accepted. Check you copied all of it.");
        if (r.status === 404) throw new Error("Repo not found, or the token has no access to it. Check the username, repo name and the token's repository access.");
        const j = await r.json();
        if (j.permissions && !j.permissions.push) throw new Error("This token can read the repo but not save to it. Give it Contents: Read and write.");
        saveCfg(c, $("#c-remember").checked);
        await start();
      } catch (err) { cfg = null; renderConnect(err.message); }
      finally { busy(false); }
    };
  }

  /* ---------- start ---------- */
  async function start() {
    $("#app").innerHTML = `<p class="count" style="padding:24px 0">Loading from GitHub…</p>`;
    try {
      const keys = Object.keys(FILES);
      const res = await Promise.all(keys.map(k => readFile(k)));
      keys.forEach((k, i) => data[k] = res[i]);
    } catch (e) { return renderConnect(e.message); }
    $("#tabs").hidden = false; $("#disconnect").hidden = false;
    $("#repo-label").textContent = `${cfg.owner}/${cfg.repo}`;
    render();
  }

  const V = () => data.videos.json.videos;
  const cats = () => {
    const known = (data.settings.json.categories || []).map(c => c.name);
    const used = [...new Set(V().map(v => v.category))].filter(c => c && !known.includes(c));
    return [...known, ...used];
  };
  const problems = () => {
    const m = new Map();
    (data.health.json.problems || []).forEach(p => m.set(p.yt, p));
    return m;
  };

  function render() {
    $("#n-videos").textContent = V().length;
    const q = (data.pending.json.queue || []).length;
    const nq = $("#n-queue"); nq.hidden = !q; nq.textContent = q;
    $$("#tabs [data-view]").forEach(b => { if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    ({ videos: renderVideos, queue: renderQueue, channels: renderChannels, settings: renderSettings })[view]();
  }

  /* ---------- Videos ---------- */
  function renderVideos() {
    const probs = problems();
    const words = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = V().filter(v => ui.cat === "ALL" || v.category === ui.cat);
    if (ui.show === "hidden") list = list.filter(v => v.hidden);
    if (ui.show === "problems") list = list.filter(v => probs.has(v.yt));
    if (ui.show === "featured") list = list.filter(v => v.featured);
    if (words.length) list = list.filter(v => { const h = [v.title, v.channel, v.subject, v.category, v.id].join(" ").toLowerCase(); return words.every(w => h.includes(w)); });
    list = [...list].sort((a, b) => (b.added || "").localeCompare(a.added || ""));
    const nProb = V().filter(v => probs.has(v.yt)).length;
    $("#app").innerHTML = `
      ${nProb ? `<div class="err">⚠ ${nProb} video${nProb > 1 ? "s" : ""} may no longer play (removed from YouTube or embedding turned off). <button class="btn btn-sm" id="see-probs">Show them</button></div>` : ""}
      <div class="bar">
        <input class="input grow" id="v-q" type="search" placeholder="Search title, channel, subject…" value="${esc(ui.q)}">
        <select id="v-cat"><option value="ALL">All categories</option>${cats().map(c => `<option ${c === ui.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="v-show">
          ${[["all", "All videos"], ["featured", "Pinned to top"], ["hidden", "Hidden"], ["problems", "Problems"]].map(([k, l]) => `<option value="${k}" ${k === ui.show ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="btn btn-primary" id="add-video">＋ Add video</button>
      </div>
      <p class="count">${list.length} of ${V().length} videos</p>
      <div class="rows">${list.map(v => {
        const p = probs.get(v.yt);
        return `<div class="row ${v.hidden ? "is-hidden" : ""}">
          <div class="thumb"><img loading="lazy" src="${thumb(v.yt)}" alt="" width="320" height="180">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}</div>
          <div>
            <h3>${esc(v.title)}</h3>
            <div class="meta">
              <span>${esc(v.category)}</span><span class="lvl lvl-${esc(v.level)}">${esc(v.level)}</span><span>${esc(v.added || "")}</span>
              ${v.featured ? `<span class="badge-s b-feat">Pinned</span>` : ""}
              ${v.hidden ? `<span class="badge-s b-hidden">Hidden</span>` : ""}
              ${p ? `<span class="badge-s b-prob">${p.status === "notfound" ? "Not on YouTube" : "Can't play in app"}</span>` : ""}
              ${v.tr && Object.keys(v.tr).length ? `<span class="badge-s b-ok">${Object.keys(v.tr).length} translation${Object.keys(v.tr).length > 1 ? "s" : ""}</span>` : ""}
            </div>
          </div>
          <div class="row-actions">
            <button class="btn btn-sm" data-edit="${esc(v.id)}">Edit</button>
            <button class="btn btn-sm" data-hide="${esc(v.id)}">${v.hidden ? "Show" : "Hide"}</button>
            <button class="btn btn-sm btn-danger" data-del="${esc(v.id)}" aria-label="Delete">Delete</button>
          </div>
        </div>`;
      }).join("") || `<div class="empty"><h3>No videos match</h3></div>`}</div>`;
    $("#v-q").oninput = e => { ui.q = e.target.value; const pos = e.target.selectionStart; renderVideos(); const i = $("#v-q"); i.focus(); i.setSelectionRange(pos, pos); };
    $("#v-cat").onchange = e => { ui.cat = e.target.value; renderVideos(); };
    $("#v-show").onchange = e => { ui.show = e.target.value; renderVideos(); };
    $("#add-video").onclick = () => openEditor(null);
    const sp = $("#see-probs"); if (sp) sp.onclick = () => { ui.show = "problems"; renderVideos(); };
  }

  async function hideToggle(id) {
    const v = V().find(x => x.id === id); if (!v) return;
    const to = !v.hidden;
    await update("videos", d => { const x = d.videos.find(y => y.id === id); if (x) { if (to) x.hidden = true; else delete x.hidden; } d.updated = today(); return d; }, `${to ? "Hide" : "Show"} video: ${v.title}`);
    toast(to ? "Hidden from staff" : "Visible to staff again"); render();
  }
  async function del(id) {
    const v = V().find(x => x.id === id); if (!v) return;
    if (!confirm(`Delete “${v.title}”?\n\nTip: use Hide instead if you might want it back.`)) return;
    await update("videos", d => { d.videos = d.videos.filter(y => y.id !== id); d.updated = today(); return d; }, `Delete video: ${v.title}`);
    toast("Deleted"); render();
  }

  /* ---------- Editor ---------- */
  let ed = null;
  function openEditor(video, prefill = {}, onSaved) {
    const v = Object.assign({ level: "Intermediate", added: today(), ppe: [], steps: [], tr: {} }, video ? JSON.parse(JSON.stringify(video)) : {}, prefill);
    ed = { original: video, v, tr: v.tr || {}, trLang: "hi", onSaved };
    const subjects = [...new Set(V().map(x => x.subject).filter(Boolean))].sort();
    $("#drawer-title").textContent = video ? "Edit video" : (prefill.yt ? "Approve video" : "Add video");
    $("#drawer-body").innerHTML = `
      <div class="field"><label for="f-url">YouTube link</label>
        <input class="input" id="f-url" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="Paste a YouTube link" value="${v.yt ? "https://www.youtube.com/watch?v=" + esc(v.yt) : ""}">
        <div class="help" id="f-url-help">Paste the link from the YouTube app (Share → Copy link). Title and channel fill in automatically.</div>
      </div>
      <div class="preview" id="f-preview" ${v.yt ? "" : "hidden"}>${v.yt ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(v.yt)}?rel=0" allowfullscreen allow="encrypted-media; picture-in-picture; fullscreen"></iframe>` : ""}</div>
      ${prefill.description ? `<details class="box"><summary>YouTube description</summary><p style="white-space:pre-wrap;font-size:14px;margin:8px 0 0">${esc(prefill.description)}</p></details>` : ""}
      <div class="field"><label for="f-title">Title</label><input class="input" id="f-title" required value="${esc(v.title || "")}"></div>
      <div class="two">
        <div class="field"><label for="f-cat">Category</label>
          <select class="input" id="f-cat">${cats().map(c => `<option ${c === v.category ? "selected" : ""}>${esc(c)}</option>`).join("")}<option value="__new">＋ New category…</option></select></div>
        <div class="field"><label for="f-level">Level</label>
          <select class="input" id="f-level">${LEVELS.map(l => `<option ${l === v.level ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="f-subject">Subject</label><input class="input" id="f-subject" list="subjects" placeholder="e.g. Preventive Maintenance" value="${esc(v.subject || "")}">
        <datalist id="subjects">${subjects.map(s => `<option value="${esc(s)}">`).join("")}</datalist></div>
      <div class="three">
        <div class="field"><label for="f-dur">Length</label><input class="input" id="f-dur" placeholder="6:12" value="${esc(v.duration || "")}"></div>
        <div class="field"><label for="f-added">Date added</label><input class="input" id="f-added" type="date" value="${esc(v.added || today())}"></div>
        <div class="field"><label for="f-chan">Channel</label><input class="input" id="f-chan" value="${esc(v.channel || "")}"></div>
      </div>
      <div class="field"><label for="f-summary">What the video shows</label><textarea class="textarea" id="f-summary" placeholder="One or two plain sentences.">${esc(v.summary || "")}</textarea></div>
      <div class="field"><label for="f-safety">Safety warning</label><textarea class="textarea" id="f-safety" placeholder="e.g. Isolate power and prove dead before starting.">${esc(v.safety || "")}</textarea></div>
      <div class="field"><label for="f-ppe">Required PPE</label><input class="input" id="f-ppe" placeholder="Safety Glasses, Work Gloves" value="${esc((v.ppe || []).join(", "))}"><div class="help">Separate with commas.</div></div>
      <div class="field"><label for="f-steps">Key steps</label><textarea class="textarea" id="f-steps" rows="6" placeholder="One step per line">${esc((v.steps || []).join("\n"))}</textarea><div class="help">One step per line. 3–6 short steps work best.</div></div>
      <label class="check"><input type="checkbox" id="f-feat" ${v.featured ? "checked" : ""}> Pin to top of the library</label>
      <label class="check"><input type="checkbox" id="f-hidden" ${v.hidden ? "checked" : ""}> Hide from staff</label>
      <details class="box" style="margin-top:10px">
        <summary>Translations (optional)</summary>
        <p class="help" style="margin:8px 0 12px">Staff see a translation button anyway. Add your own text here only if you want a checked translation for a language.</p>
        <div class="field"><label for="f-tr-lang">Language</label>
          <select class="input" id="f-tr-lang">${TR_LANGS.map(([c, n]) => `<option value="${c}">${n}${ed.tr[c] ? " ✓" : ""}</option>`).join("")}</select></div>
        <div id="tr-fields"></div>
      </details>`;
    renderTrFields();
    $("#drawer-foot").innerHTML = `<button class="btn" data-close-drawer>Cancel</button><button class="btn btn-primary" id="f-save">${prefill.yt && !video ? "Approve & publish" : "Save"}</button>`;
    $("#drawer").hidden = false;
    document.body.style.overflow = "hidden";

    const url = $("#f-url");
    const onUrl = async () => {
      const yt = parseYT(url.value);
      const help = $("#f-url-help");
      if (!yt) { help.textContent = url.value ? "That doesn't look like a YouTube link." : "Paste the link from the YouTube app (Share → Copy link)."; return; }
      if (yt === ed.v.yt && $("#f-title").value) return;
      ed.v.yt = yt;
      $("#f-preview").hidden = false;
      $("#f-preview").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(yt)}?rel=0" allowfullscreen allow="encrypted-media; picture-in-picture; fullscreen"></iframe>`;
      const dup = V().find(x => x.yt === yt && (!ed.original || x.id !== ed.original.id));
      help.innerHTML = dup ? `<span style="color:var(--danger);font-weight:700">Already in the library: “${esc(dup.title)}”.</span>` : "Fetching title…";
      const meta = await fetchMeta(yt);
      if (meta) {
        if (!$("#f-title").value) $("#f-title").value = meta.title;
        if (!$("#f-chan").value) $("#f-chan").value = meta.channel;
        if (!dup) help.textContent = "Details filled in. Check the title and add the steps.";
        const cat = guessCategory(meta.title);
        if (cat && !ed.original && !prefill.category) $("#f-cat").value = cat;
      } else if (!dup) help.textContent = "Couldn't fetch the title automatically. Type it in.";
    };
    url.addEventListener("change", onUrl);
    url.addEventListener("paste", () => setTimeout(onUrl, 0));
    $("#f-cat").onchange = e => {
      if (e.target.value !== "__new") return;
      const name = (prompt("New category name:") || "").trim();
      if (!name) { e.target.value = cats()[0] || ""; return; }
      const o = document.createElement("option"); o.textContent = name; e.target.insertBefore(o, e.target.lastElementChild); e.target.value = name;
      ed.newCategory = name;
    };
    $("#f-tr-lang").onchange = e => { stashTr(); ed.trLang = e.target.value; renderTrFields(); };
    $("#f-save").onclick = saveEditor;
  }
  function renderTrFields() {
    const x = ed.tr[ed.trLang] || {};
    const rtl = ["ur", "ar"].includes(ed.trLang) ? 'dir="rtl"' : "";
    $("#tr-fields").innerHTML = `
      <div class="field"><label for="t-title">Title</label><input class="input" id="t-title" ${rtl} value="${esc(x.title || "")}"></div>
      <div class="field"><label for="t-summary">What the video shows</label><textarea class="textarea" id="t-summary" ${rtl}>${esc(x.summary || "")}</textarea></div>
      <div class="field"><label for="t-safety">Safety warning</label><textarea class="textarea" id="t-safety" ${rtl}>${esc(x.safety || "")}</textarea></div>
      <div class="field"><label for="t-steps">Key steps (one per line, same order as English)</label><textarea class="textarea" id="t-steps" ${rtl}>${esc((x.steps || []).join("\n"))}</textarea></div>`;
  }
  function stashTr() {
    const x = { title: $("#t-title").value.trim(), summary: $("#t-summary").value.trim(), safety: $("#t-safety").value.trim(), steps: $("#t-steps").value.split("\n").map(s => s.trim()).filter(Boolean) };
    if (x.title || x.summary || x.safety || x.steps.length) { if (!x.steps.length) delete x.steps; ed.tr[ed.trLang] = x; }
    else delete ed.tr[ed.trLang];
  }
  function guessCategory(text) {
    const t = " " + (text || "").toLowerCase() + " ";
    let best = null, score = 0;
    (data.settings.json.categories || []).forEach(c => {
      const s = (c.keywords || []).reduce((n, k) => n + (t.includes(k.toLowerCase()) ? 1 : 0), 0);
      if (s > score) { score = s; best = c.name; }
    });
    return best;
  }
  function closeDrawer() { $("#drawer").hidden = true; document.body.style.overflow = ""; ed = null; }

  async function saveEditor() {
    stashTr();
    const yt = parseYT($("#f-url").value) || ed.v.yt;
    const title = $("#f-title").value.trim();
    const category = $("#f-cat").value;
    if (!yt) return alert("Paste a YouTube link first.");
    if (!title) return alert("Add a title.");
    if (!category || category === "__new") return alert("Choose a category.");
    const dup = V().find(x => x.yt === yt && (!ed.original || x.id !== ed.original.id));
    if (dup && !confirm(`This video is already in the library as “${dup.title}”. Save anyway?`)) return;
    const slug = category.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 5) || "vid";
    const v = {
      id: ed.original ? ed.original.id : `${slug}-${yt}`,
      yt, title, category,
      subject: $("#f-subject").value.trim(),
      level: $("#f-level").value,
      channel: $("#f-chan").value.trim(),
      duration: $("#f-dur").value.trim(),
      added: $("#f-added").value || today(),
      summary: $("#f-summary").value.trim(),
      safety: $("#f-safety").value.trim(),
      ppe: $("#f-ppe").value.split(",").map(s => s.trim()).filter(Boolean),
      steps: $("#f-steps").value.split("\n").map(s => s.trim().replace(/^\d+[.)]\s*/, "")).filter(Boolean)
    };
    if ($("#f-feat").checked) v.featured = true;
    if ($("#f-hidden").checked) v.hidden = true;
    if (Object.keys(ed.tr).length) v.tr = ed.tr;
    const isEdit = !!ed.original, onSaved = ed.onSaved, newCat = ed.newCategory;
    await update("videos", d => {
      const i = d.videos.findIndex(x => x.id === v.id);
      if (i >= 0) d.videos[i] = v; else d.videos.unshift(v);
      d.updated = today();
      return d;
    }, `${isEdit ? "Edit" : "Add"} video: ${title}`);
    if (newCat && !(data.settings.json.categories || []).some(c => c.name === newCat)) {
      await update("settings", s => { s.categories = s.categories || []; s.categories.push({ name: newCat, icon: "▶️", keywords: [] }); return s; }, `Add category: ${newCat}`);
    }
    closeDrawer();
    if (onSaved) await onSaved(v);
    toast(isEdit ? "Saved. Live in about a minute." : "Published. Live in about a minute.");
    render();
  }

  /* ---------- Review queue ---------- */
  function renderQueue() {
    const p = data.pending.json;
    const q = p.queue || [];
    const errs = Object.entries(p.channelStatus || {}).filter(([, s]) => s && s.error);
    $("#app").innerHTML = `
      <div class="card-plain">
        <h2>Review queue</h2>
        <p>Every day the finder checks your trusted channels and puts new uploads here. Nothing goes live until you approve it.</p>
        <p class="count" style="margin:0">${p.lastRun ? "Last check: " + esc(new Date(p.lastRun).toLocaleString()) : "The finder hasn't run yet. It runs every morning, or use “Find new videos now” on the Channels tab."}</p>
      </div>
      ${errs.length ? `<div class="err">⚠ ${errs.length} channel${errs.length > 1 ? "s" : ""} couldn't be checked. See the Channels tab.</div>` : ""}
      ${q.length ? `<div class="bar"><p class="count grow" style="margin:0">${q.length} waiting</p><button class="btn btn-sm" id="q-clear">Reject all</button></div>` : ""}
      <div class="grid">${q.map(item => `
        <article class="qcard" data-yt="${esc(item.yt)}">
          <div class="thumb" data-preview="${esc(item.yt)}" style="cursor:pointer"><img loading="lazy" src="${thumb(item.yt)}" alt="" width="320" height="180">${item.duration ? `<span class="dur">${esc(item.duration)}</span>` : ""}</div>
          <div class="body">
            <div class="meta"><span>${esc(item.suggestedCategory || "Unsorted")}</span>${item.published ? `<span class="dot">${esc(item.published.slice(0, 10))}</span>` : ""}</div>
            <h3>${esc(item.title)}</h3>
            <div class="count" style="margin:0">${esc(item.channel || "")}</div>
            ${item.description ? `<div class="desc">${esc(item.description)}</div>` : ""}
            <div class="acts">
              <button class="btn btn-sm" data-reject="${esc(item.yt)}">Reject</button>
              <button class="btn btn-sm btn-primary" data-approve="${esc(item.yt)}">Review & approve</button>
            </div>
          </div>
        </article>`).join("")}</div>
      ${q.length ? "" : `<div class="empty"><div class="big">✅</div><h3>Nothing waiting</h3><p>New videos from your channels will appear here.</p></div>`}`;
    const qc = $("#q-clear");
    if (qc) qc.onclick = async () => {
      if (!confirm(`Reject all ${q.length} videos in the queue?`)) return;
      const yts = q.map(i => i.yt);
      await update("pending", d => { d.rejected = [...new Set([...(d.rejected || []), ...yts])].slice(-3000); d.queue = (d.queue || []).filter(i => !yts.includes(i.yt)); return d; }, "Reject all queued videos");
      render();
    };
  }
  async function removeFromQueue(yt, reject) {
    await update("pending", d => {
      d.queue = (d.queue || []).filter(i => i.yt !== yt);
      if (reject) d.rejected = [...new Set([...(d.rejected || []), yt])].slice(-3000);
      return d;
    }, reject ? `Reject queued video ${yt}` : `Approve queued video ${yt}`);
  }
  function approve(yt) {
    const item = (data.pending.json.queue || []).find(i => i.yt === yt); if (!item) return;
    openEditor(null, {
      yt: item.yt, title: item.title, channel: item.channel, duration: item.duration || "",
      category: item.suggestedCategory || cats()[0], description: item.description || ""
    }, async () => { await removeFromQueue(yt, false); });
  }

  /* ---------- Channels ---------- */
  function renderChannels() {
    const c = data.channels.json, st = data.pending.json.channelStatus || {};
    $("#app").innerHTML = `
      <div class="card-plain">
        <h2>Trusted channels</h2>
        <p>The daily finder only looks at these YouTube channels. Add channels whose videos you'd be happy for staff to watch.</p>
        <button class="btn" id="run-now">🔎 Find new videos now</button>
        <span class="count" id="run-msg" style="margin-inline-start:8px"></span>
      </div>
      <div class="rows" style="margin-bottom:16px">${(c.channels || []).map((ch, i) => {
        const s = st[ch.url] || {};
        return `<div class="ch-row">
          <div>
            <b>${esc(ch.name || ch.url)}</b> ${ch.active === false ? `<span class="badge-s b-hidden">Paused</span>` : ""}
            ${s.error ? `<span class="badge-s b-prob">Problem</span>` : s.id ? `<span class="badge-s b-ok">OK</span>` : `<span class="badge-s b-hidden">Not checked yet</span>`}
            <div class="small">${esc(ch.url)}${ch.category ? " · goes to " + esc(ch.category) : " · category picked from title"}</div>
            ${s.error ? `<div class="small" style="color:var(--danger)">${esc(s.error)}</div>` : ""}
          </div>
          <div class="row-actions">
            <button class="btn btn-sm" data-ch-toggle="${i}">${ch.active === false ? "Resume" : "Pause"}</button>
            <button class="btn btn-sm btn-danger" data-ch-del="${i}">Remove</button>
          </div>
        </div>`;
      }).join("")}</div>
      <form class="card-plain" id="ch-add">
        <h2>Add a channel</h2>
        <div class="field"><label for="ch-url">Channel link</label><input class="input" id="ch-url" required placeholder="https://www.youtube.com/@ChannelName" autocapitalize="off" spellcheck="false">
          <div class="help">Open the channel on YouTube, tap Share → Copy link, paste here.</div></div>
        <div class="two">
          <div class="field"><label for="ch-name">Name</label><input class="input" id="ch-name" required></div>
          <div class="field"><label for="ch-cat">Send videos to</label><select class="input" id="ch-cat"><option value="">Pick from title</option>${cats().map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
        </div>
        <button class="btn btn-primary">Add channel</button>
      </form>
      <form class="card-plain" id="ch-opts">
        <h2>Finder options</h2>
        <div class="two">
          <div class="field"><label for="o-look">Look back (days)</label><input class="input" id="o-look" type="number" min="1" max="365" value="${esc(c.lookbackDays || 21)}"></div>
          <div class="field"><label for="o-max">Max videos in queue</label><input class="input" id="o-max" type="number" min="10" max="500" value="${esc(c.maxQueue || 150)}"></div>
        </div>
        <label class="check"><input type="checkbox" id="o-shorts" ${c.skipShorts !== false ? "checked" : ""}> Skip YouTube Shorts (under 1 minute)</label>
        <button class="btn">Save options</button>
      </form>`;
    $("#ch-add").onsubmit = async e => {
      e.preventDefault();
      const url = $("#ch-url").value.trim().replace(/\/(videos|featured|shorts|streams)\/?$/, "");
      if (!/youtube\.com\/(@|channel\/|c\/|user\/)/.test(url)) return alert("Use a channel link like https://www.youtube.com/@ChannelName");
      const ch = { name: $("#ch-name").value.trim(), url, category: $("#ch-cat").value, active: true };
      await update("channels", d => { d.channels = d.channels || []; if (!d.channels.some(x => x.url === url)) d.channels.push(ch); return d; }, `Add channel: ${ch.name}`);
      toast("Channel added. It will be checked on the next run."); render();
    };
    $("#ch-opts").onsubmit = async e => {
      e.preventDefault();
      const look = +$("#o-look").value || 21, max = +$("#o-max").value || 150, shorts = $("#o-shorts").checked;
      await update("channels", d => { d.lookbackDays = look; d.maxQueue = max; d.skipShorts = shorts; return d; }, "Update finder options");
      toast("Saved");
    };
    $("#run-now").onclick = runFinder;
  }
  async function runFinder() {
    const msg = $("#run-msg");
    msg.textContent = "Starting…";
    const r = await gh(`/repos/${cfg.owner}/${cfg.repo}/actions/workflows/find-videos.yml/dispatches`, { method: "POST", body: { ref: cfg.branch } });
    if (r.status === 204) msg.textContent = "Started. New videos show up in the Review queue in 1–3 minutes (reload this page).";
    else if (r.status === 403 || r.status === 404) msg.textContent = "Couldn't start it. Give your token “Actions: Read and write”, and check Actions are enabled on the repo.";
    else msg.textContent = "Couldn't start it (" + r.status + ").";
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    const s = data.settings.json;
    const counts = {}; V().forEach(v => counts[v.category] = (counts[v.category] || 0) + 1);
    $("#app").innerHTML = `
      <form id="set-form">
        <div class="card-plain">
          <h2>Site</h2>
          <div class="two">
            <div class="field"><label for="s-name">Site name</label><input class="input" id="s-name" value="${esc(s.siteName || "")}"></div>
            <div class="field"><label for="s-tag">Tagline</label><input class="input" id="s-tag" value="${esc(s.tagline || "")}"></div>
          </div>
          <div class="field"><label for="s-ann">Announcement banner</label><input class="input" id="s-ann" placeholder="e.g. New fire safety videos added this week" value="${esc(s.announcement || "")}"><div class="help">Shown at the top of the library. Leave empty to hide.</div></div>
          <div class="two">
            <div class="field"><label for="s-help">Helpdesk contact</label><input class="input" id="s-help" placeholder="e.g. 04 123 4567" value="${esc(s.helpdesk || "")}"></div>
            <div class="field"><label for="s-new">“New” badge for (days)</label><input class="input" id="s-new" type="number" min="1" max="60" value="${esc(s.newDays || 7)}"></div>
          </div>
        </div>
        <div class="card-plain">
          <h2>Categories</h2>
          <p class="count">Icon, name, and words the finder uses to sort new videos (comma separated). Empty categories are hidden from staff.</p>
          <div id="cat-rows">${(s.categories || []).map((c, i) => catRow(c, i, counts[c.name] || 0)).join("")}</div>
          <button type="button" class="btn btn-sm" id="cat-add">＋ Add category</button>
        </div>
        <div class="card-plain">
          <h2>Finder: skip videos containing</h2>
          <textarea class="textarea" id="s-excl">${esc((s.excludeKeywords || []).join(", "))}</textarea>
          <div class="help">Comma separated. Videos whose title contains any of these are never queued.</div>
        </div>
        <button class="btn btn-primary" style="width:100%">Save settings</button>
      </form>`;
    $("#cat-add").onclick = () => { $("#cat-rows").insertAdjacentHTML("beforeend", catRow({ name: "", icon: "▶️", keywords: [] }, Date.now(), 0)); };
    $("#cat-rows").onclick = e => {
      const b = e.target.closest("[data-cat-del]"); if (!b) return;
      const row = b.closest(".cat-row");
      const n = +row.dataset.count;
      if (n && !confirm(`${n} videos use this category. Remove it anyway? (The videos stay; edit them to move them.)`)) return;
      row.remove();
    };
    $("#set-form").onsubmit = async e => {
      e.preventDefault();
      const categories = $$(".cat-row").map(r => ({
        name: $(".c-name", r).value.trim(), icon: $(".c-icon", r).value.trim() || "▶️",
        keywords: $(".c-kw", r).value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean)
      })).filter(c => c.name);
      const vals = {
        siteName: $("#s-name").value.trim(), tagline: $("#s-tag").value.trim(), announcement: $("#s-ann").value.trim(),
        helpdesk: $("#s-help").value.trim(), newDays: Math.max(1, +$("#s-new").value || 7), categories,
        excludeKeywords: $("#s-excl").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean)
      };
      await update("settings", d => Object.assign(d, vals), "Update site settings");
      toast("Settings saved. Live in about a minute."); render();
    };
  }
  function catRow(c, i, count) {
    return `<div class="cat-row" data-count="${count}">
      <input class="input c-icon" aria-label="Icon" value="${esc(c.icon || "")}" style="text-align:center">
      <div><input class="input c-name" aria-label="Category name" placeholder="Name" value="${esc(c.name)}">
        <textarea class="textarea c-kw" aria-label="Keywords" style="min-height:60px;margin-top:6px;font-size:14px" placeholder="keywords, comma, separated">${esc((c.keywords || []).join(", "))}</textarea>
        <div class="help">${count} video${count === 1 ? "" : "s"}</div></div>
      <button type="button" class="btn btn-sm btn-danger" data-cat-del aria-label="Remove category">✕</button>
    </div>`;
  }

  /* ---------- global events ---------- */
  document.addEventListener("click", e => {
    const tab = e.target.closest("#tabs [data-view]");
    if (tab) { view = tab.dataset.view; render(); scrollTo(0, 0); return; }
    if (e.target.closest("[data-close-drawer]") || e.target.id === "drawer") { closeDrawer(); return; }
    const t = e.target.closest("[data-edit],[data-hide],[data-del],[data-approve],[data-reject],[data-preview],[data-ch-toggle],[data-ch-del]");
    if (!t) return;
    const d = t.dataset;
    if (d.edit) openEditor(V().find(v => v.id === d.edit));
    else if (d.hide) hideToggle(d.hide);
    else if (d.del) del(d.del);
    else if (d.approve) approve(d.approve);
    else if (d.reject) removeFromQueue(d.reject, true).then(() => { toast("Rejected. It won't be suggested again."); render(); });
    else if (d.preview) t.outerHTML = `<div class="preview" style="margin:0;border-radius:0"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(d.preview)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`;
    else if (d.chToggle) { const i = +d.chToggle; update("channels", x => { x.channels[i].active = x.channels[i].active === false; return x; }, "Pause/resume channel").then(render); }
    else if (d.chDel) { const i = +d.chDel; const ch = data.channels.json.channels[i]; if (confirm(`Remove ${ch.name}?`)) update("channels", x => { x.channels = x.channels.filter(c => c.url !== ch.url); return x; }, `Remove channel: ${ch.name}`).then(render); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
  $("#disconnect").onclick = () => { if (!confirm("Sign out of the admin on this device?")) return; localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY); cfg = null; renderConnect(); };

  if (cfg && cfg.token) start(); else renderConnect();
})();
