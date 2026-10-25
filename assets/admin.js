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
  const FILES = { videos: "data/videos.json", settings: "data/settings.json", channels: "data/channels.json", pending: "data/pending.json", health: "data/health.json", paths: "data/paths.json", toolbox: "data/toolbox.json" };
  const DEFAULTS = {
    videos: () => ({ updated: today(), videos: [] }),
    settings: () => ({ categories: [], newDays: 7 }),
    channels: () => ({ lookbackDays: 21, skipShorts: true, maxQueue: 150, channels: [] }),
    pending: () => ({ lastRun: null, channelStatus: {}, queue: [], rejected: [] }),
    health: () => ({ checked: null, problems: [] }),
    paths: () => ({ paths: [] }),
    toolbox: () => ({ talks: [] })
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
    loadRequests().then(() => { if (view === "requests") render(); else badgeRequests(); });
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
    ({ videos: renderVideos, queue: renderQueue, requests: renderRequests, paths: renderPaths, toolbox: renderToolbox, channels: renderChannels, settings: renderSettings })[view]();
  }

  /* ---------- Videos ---------- */
  function renderVideos() {
    const probs = problems();
    const words = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = V().filter(v => ui.cat === "ALL" || v.category === ui.cat);
    if (ui.show === "hidden") list = list.filter(v => v.hidden);
    if (ui.show === "problems") list = list.filter(v => probs.has(v.yt));
    if (ui.show === "featured") list = list.filter(v => v.featured);
    if (ui.show === "essential") list = list.filter(v => v.essential);
    const dupOf = new Map(V().map(v => [v.id, ABDraft.findDuplicates(v, V())]));
    if (ui.show === "dups") list = list.filter(v => dupOf.get(v.id).length);
    if (words.length) list = list.filter(v => { const h = [v.title, v.channel, v.subject, v.category, v.id].join(" ").toLowerCase(); return words.every(w => h.includes(w)); });
    list = [...list].sort((a, b) => (b.added || "").localeCompare(a.added || ""));
    const nProb = V().filter(v => probs.has(v.yt)).length;
    $("#app").innerHTML = `
      ${nProb ? `<div class="err">⚠ ${nProb} video${nProb > 1 ? "s" : ""} may no longer play (removed from YouTube or embedding turned off). <button class="btn btn-sm" id="see-probs">Show them</button></div>` : ""}
      <div class="bar">
        <input class="input grow" id="v-q" type="search" placeholder="Search title, channel, subject…" value="${esc(ui.q)}">
        <select id="v-cat"><option value="ALL">All categories</option>${cats().map(c => `<option ${c === ui.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="v-show">
          ${[["all", "All videos"], ["dups", "Possible duplicates"], ["essential", "Safety essentials"], ["featured", "Pinned to top"], ["hidden", "Hidden"], ["problems", "Problems"]].map(([k, l]) => `<option value="${k}" ${k === ui.show ? "selected" : ""}>${l}</option>`).join("")}
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
              ${dupOf.get(v.id).length ? `<span class="badge-s b-dup" title="${esc(dupOf.get(v.id).map(d => d.item.title).join("\n"))}">⚠ ${dupOf.get(v.id)[0].same ? "Same video twice" : "Similar to: " + esc(dupOf.get(v.id)[0].item.title)}</span>` : ""}
              ${v.essential ? `<span class="badge-s b-ess">🦺 Essential</span>` : ""}
              ${v.featured ? `<span class="badge-s b-feat">Pinned</span>` : ""}
              ${v.hidden ? `<span class="badge-s b-hidden">Hidden</span>` : ""}
              ${p ? `<span class="badge-s b-prob">${p.status === "notfound" ? "Not on YouTube" : "Can't play in app"}</span>` : ""}
              ${v.tr && Object.keys(v.tr).length ? `<span class="badge-s b-ok">🌐 ${Object.keys(v.tr).length}/8</span>` : `<span class="badge-s b-hidden">Translating…</span>`}
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
    if ((data.paths.json.paths || []).some(p => (p.videos || []).includes(id)))
      await update("paths", d => { (d.paths || []).forEach(p => p.videos = (p.videos || []).filter(x => x !== id)); return d; }, `Remove deleted video from learning paths`);
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
      <div class="field"><label for="f-title">Title</label><input class="input" id="f-title" required value="${esc(v.title || "")}"><div id="f-dup"></div></div>
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
      ${v.draftSource ? `<div class="draft-note">✨ ${v.draftSource === "ai" ? "Gemini watched this video and wrote a first draft of the summary, safety note and steps." : "First draft filled in from the YouTube description and safety rules."} ${STEPS_NOTE[v.stepsFrom] || ""} Check it before publishing.</div>` : ""}
      <div class="draft-row"><button type="button" class="btn btn-sm" id="f-draft">✨ Auto-draft</button><span class="help" id="f-draft-help">${geminiKey() ? "Gemini will watch the video and fill in the summary, safety, PPE and steps." : "Fills in safety, PPE and steps for this kind of job. Add a Gemini key in Settings to draft from the video itself."}</span></div>
      <div class="field"><label for="f-summary">What the video shows</label><textarea class="textarea" id="f-summary" placeholder="One or two plain sentences.">${esc(v.summary || "")}</textarea></div>
      <div class="field"><label for="f-safety">Safety warning</label><textarea class="textarea" id="f-safety" placeholder="e.g. Isolate power and prove dead before starting.">${esc(v.safety || "")}</textarea></div>
      <div class="field"><label for="f-ppe">Required PPE</label><input class="input" id="f-ppe" placeholder="Safety Glasses, Work Gloves" value="${esc((v.ppe || []).join(", "))}"><div class="help">Separate with commas.</div></div>
      <div class="field"><label for="f-steps">Key steps</label><textarea class="textarea" id="f-steps" rows="6" placeholder="One step per line">${esc((v.steps || []).join("\n"))}</textarea><div class="help">One step per line. 3–6 short steps work best.</div></div>
      <label class="check"><input type="checkbox" id="f-ess" ${v.essential ? "checked" : ""}> 🦺 Safety essential (shown in the pinned Safety section)</label>
      <label class="check"><input type="checkbox" id="f-feat" ${v.featured ? "checked" : ""}> Pin to top of the library</label>
      <label class="check"><input type="checkbox" id="f-hidden" ${v.hidden ? "checked" : ""}> Hide from staff</label>
      <details class="box" style="margin-top:10px">
        <summary>Translations (optional)</summary>
        <p class="help" style="margin:8px 0 12px">Every video is translated automatically about 2 minutes after you save. Correct any wording here and your version is kept. Clear all fields for a language to go back to automatic.</p>
        <div class="field"><label for="f-tr-lang">Language</label>
          <select class="input" id="f-tr-lang">${TR_LANGS.map(([c, n]) => `<option value="${c}">${n}${ed.tr[c] ? (ed.tr[c].auto ? " (automatic)" : " (checked by you)") : " (pending)"}</option>`).join("")}</select></div>
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
        if (!$("#f-title").value) { $("#f-title").value = meta.title; $("#f-title").dispatchEvent(new Event("input")); }
        if (!$("#f-chan").value) $("#f-chan").value = meta.channel;
        if (!dup) help.textContent = "Details filled in. Check the title and add the steps.";
        const cat = guessCategory(meta.title);
        if (cat && !ed.original && !prefill.category) $("#f-cat").value = cat;
      } else if (!dup) help.textContent = "Couldn't fetch the title automatically. Type it in.";
    };
    $("#f-draft").onclick = () => runDraft();
    const checkDup = () => {
      const others = V().filter(x => !ed.original || x.id !== ed.original.id);
      const d = ABDraft.findDuplicates({ title: $("#f-title").value, yt: parseYT($("#f-url").value) || ed.v.yt }, others).filter(x => !x.same).slice(0, 3);
      $("#f-dup").innerHTML = d.length ? `<div class="dup-note">⚠ Similar video${d.length > 1 ? "s" : ""} already in the library: ${d.map(x => `<b>${esc(x.item.title)}</b>`).join(", ")}. Check it isn't the same lesson.</div>` : "";
    };
    $("#f-title").addEventListener("input", checkDup);
    setTimeout(checkDup, 0);
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
    const prev = ed.tr[ed.trLang] || {};
    const x = { title: $("#t-title").value.trim(), summary: $("#t-summary").value.trim(), safety: $("#t-safety").value.trim(), steps: $("#t-steps").value.split("\n").map(s => s.trim()).filter(Boolean) };
    if (!(x.title || x.summary || x.safety || x.steps.length)) { delete ed.tr[ed.trLang]; return; }   // empty = let auto-translate refill it
    const same = (prev.title || "") === x.title && (prev.summary || "") === x.summary && (prev.safety || "") === x.safety && JSON.stringify(prev.steps || []) === JSON.stringify(x.steps);
    const next = Object.assign({}, prev, x);
    if (!x.steps.length) delete next.steps;
    if (!same) { delete next.auto; delete next.src; }   // you edited it: keep your version, never overwrite
    ed.tr[ed.trLang] = next;
  }
  const STEPS_NOTE = {
    chapters: "Steps come from the video's own chapters.",
    description: "Steps come from the list in the YouTube description.",
    topic: "Steps are the standard procedure for this kind of job — watch the video and adjust them to match.",
    general: "Steps are general safe-work steps — replace them with the steps shown in the video."
  };
  const geminiKey = () => { try { return localStorage.getItem("ab_gemini_key") || ""; } catch { return ""; } };
  async function runDraft() {
    const yt = parseYT($("#f-url").value) || ed.v.yt;
    const title = $("#f-title").value.trim();
    const category = $("#f-cat").value;
    if (!yt || !title) return alert("Paste the YouTube link and check the title first.");
    const filled = ["#f-summary", "#f-safety", "#f-ppe", "#f-steps"].some(id => $(id).value.trim());
    if (filled && !confirm("Replace what is already in the summary, safety, PPE and steps?")) return;
    const btn = $("#f-draft"), help = $("#f-draft-help");
    let d;
    if (geminiKey()) {
      btn.disabled = true; help.textContent = "Gemini is watching the video… (up to a minute)";
      try {
        const subjects = [...new Set(V().filter(v => v.category === category && v.subject).map(v => v.subject))];
        d = await ABDraft.aiDraft({ yt, title, category, subjects, key: geminiKey(), model: localStorage.getItem("ab_gemini_model") || undefined });
        help.textContent = "Done. Gemini drafted this from the video — check it before publishing.";
      } catch (e) {
        help.textContent = "Gemini couldn't draft this one (" + e.message + "). Used the built-in rules instead.";
      } finally { btn.disabled = false; }
    }
    if (!d) {
      d = ABDraft.ruleDraft({ title, description: ed.v.description || "", category, videos: V() });
      if (!geminiKey()) help.textContent = "Filled in safety, PPE, level and steps." + (d.summary ? "" : " Write the summary from the video.");
    }
    if (d.summary) $("#f-summary").value = d.summary;
    if (d.safety) $("#f-safety").value = d.safety;
    if (d.ppe && d.ppe.length) $("#f-ppe").value = d.ppe.join(", ");
    if (d.steps && d.steps.length) $("#f-steps").value = d.steps.join("\n");
    if (d.source !== "ai" && STEPS_NOTE[d.stepsFrom]) help.textContent = (geminiKey() ? help.textContent + " " : "") + STEPS_NOTE[d.stepsFrom];
    if (d.level) $("#f-level").value = d.level;
    if (d.subject && !$("#f-subject").value) $("#f-subject").value = d.subject;
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
    if ($("#f-ess").checked) v.essential = true;
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
    const dupNote = item => {
      const lib = ABDraft.findDuplicates(item, V())[0];
      if (lib) return `<div class="dup-note">⚠ ${lib.same ? "Already in the library" : "Looks like a video already in the library"}: <b>${esc(lib.item.title)}</b></div>`;
      const qd = ABDraft.findDuplicates(item, q)[0];
      if (qd) return `<div class="dup-note soft">⚠ Similar video also waiting in the queue: <b>${esc(qd.item.title)}</b> — you may only need one.</div>`;
      return "";
    };
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
            <div class="meta"><span>${esc(item.suggestedCategory || "Unsorted")}</span>${item.published ? `<span class="dot">${esc(item.published.slice(0, 10))}</span>` : ""}${item.draft ? `<span class="badge-s b-draft">✨ ${item.draft.source === "ai" ? "AI draft from video" : { chapters: "Draft · steps from video", description: "Draft · steps from description", topic: "Draft · standard steps", general: "Draft · general steps" }[item.draft.stepsFrom] || "Draft"}</span>` : ""}</div>
            <h3>${esc(item.title)}</h3>
            <div class="count" style="margin:0">${esc(item.channel || "")}</div>
            ${dupNote(item)}
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
    const d = item.draft || {};
    const fromDraft = {};
    ["summary", "safety", "subject", "level"].forEach(k => { if (d[k]) fromDraft[k] = d[k]; });
    ["ppe", "steps"].forEach(k => { if (d[k] && d[k].length) fromDraft[k] = d[k]; });
    if (item.draft) { fromDraft.draftSource = d.source; fromDraft.stepsFrom = d.stepsFrom; }
    openEditor(null, {
      ...fromDraft,
      yt: item.yt, title: item.title, channel: item.channel, duration: item.duration || "",
      category: item.suggestedCategory || cats()[0], description: item.description || "",
      ...(item.suggestedCategory === "Health & Safety" ? { essential: true } : {})
    }, async () => { await removeFromQueue(yt, false); });
  }

  /* ---------- Learning paths ---------- */
  let pe = null;   // path being edited
  const P = () => data.paths.json.paths || (data.paths.json.paths = []);
  function renderPaths() {
    if (pe) return renderPathEditor();
    const byId = new Map(V().map(v => [v.id, v]));
    $("#app").innerHTML = `
      <div class="bar"><p class="help grow" style="margin:0">Learning paths are short courses shown on the home screen (e.g. “New HVAC Technician”). Staff tick off videos as they go; their progress stays on their own phone.</p>
        <button class="btn btn-primary" id="p-add">＋ New path</button></div>
      <div class="rows">${P().map((p, i) => {
        const vids = (p.videos || []).map(id => byId.get(id)).filter(Boolean);
        return `<div class="row">
          <div class="thumb path-ico">${esc(p.icon || "🎓")}</div>
          <div><h3>${esc(p.title)}</h3>
            <div class="meta"><span>${vids.length} video${vids.length === 1 ? "" : "s"}</span>${p.hidden ? `<span class="badge-s b-hidden">Hidden</span>` : ""}
            ${p.tr && Object.keys(p.tr).length ? `<span class="badge-s b-ok">🌐 ${Object.keys(p.tr).length}/8</span>` : `<span class="badge-s b-hidden">Translating…</span>`}</div></div>
          <div class="row-actions">
            <button class="btn btn-sm" data-p-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button class="btn btn-sm" data-p-edit="${i}">Edit</button>
            <button class="btn btn-sm btn-danger" data-p-del="${i}">Delete</button>
          </div></div>`;
      }).join("") || `<div class="empty"><h3>No learning paths yet</h3></div>`}</div>`;
    $("#p-add").onclick = () => { pe = { index: -1, p: { id: "", icon: "🎓", title: "", description: "", videos: [] } }; renderPaths(); };
    $$("[data-p-edit]").forEach(b => b.onclick = () => { const i = +b.dataset.pEdit; pe = { index: i, p: JSON.parse(JSON.stringify(P()[i])) }; renderPaths(); });
    $$("[data-p-del]").forEach(b => b.onclick = async () => {
      const p = P()[+b.dataset.pDel]; if (!confirm(`Delete the path “${p.title}”? The videos stay in the library.`)) return;
      await update("paths", d => { d.paths = (d.paths || []).filter(x => x.id !== p.id); return d; }, `Delete learning path: ${p.title}`);
      toast("Deleted."); render();
    });
    $$("[data-p-up]").forEach(b => b.onclick = async () => {
      const id = P()[+b.dataset.pUp].id;
      await update("paths", d => { const i = d.paths.findIndex(x => x.id === id); if (i > 0) d.paths.splice(i - 1, 0, d.paths.splice(i, 1)[0]); return d; }, "Reorder learning paths");
      render();
    });
  }
  function renderPathEditor() {
    const p = pe.p, byId = new Map(V().map(v => [v.id, v]));
    const avail = V().filter(v => !p.videos.includes(v.id));
    const groups = cats().map(c => [c, avail.filter(v => v.category === c)]).filter(([, l]) => l.length);
    $("#app").innerHTML = `
      <button class="btn btn-sm btn-ghost" id="pe-back">‹ All paths</button>
      <h2 style="margin:10px 0 14px">${pe.index < 0 ? "New learning path" : "Edit learning path"}</h2>
      <div class="two" style="grid-template-columns:90px 1fr">
        <div class="field"><label for="pe-icon">Icon</label><input class="input" id="pe-icon" maxlength="4" value="${esc(p.icon || "")}" style="text-align:center;font-size:22px"></div>
        <div class="field"><label for="pe-title">Title</label><input class="input" id="pe-title" placeholder="e.g. New HVAC Technician" value="${esc(p.title)}"></div>
      </div>
      <div class="field"><label for="pe-desc">Description</label><textarea class="textarea" id="pe-desc" placeholder="Who is this for and what will they learn?">${esc(p.description || "")}</textarea></div>
      <label class="check"><input type="checkbox" id="pe-hidden" ${p.hidden ? "checked" : ""}> Hide from staff</label>
      <h3 style="margin:18px 0 8px">Videos in order (${p.videos.length})</h3>
      <div class="rows">${p.videos.map((id, i) => {
        const v = byId.get(id);
        return `<div class="row">
          <div class="thumb">${v ? `<img src="${thumb(v.yt)}" alt="" width="320" height="180">` : ""}</div>
          <div><h3>${i + 1}. ${esc(v ? v.title : id + " (deleted)")}</h3><div class="meta">${v ? `<span>${esc(v.category)}</span><span class="lvl lvl-${esc(v.level)}">${esc(v.level)}</span>` : ""}</div></div>
          <div class="row-actions">
            <button class="btn btn-sm" data-pv-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button class="btn btn-sm" data-pv-down="${i}" ${i === p.videos.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            <button class="btn btn-sm btn-danger" data-pv-rm="${i}" aria-label="Remove">✕</button>
          </div></div>`;
      }).join("") || `<p class="help">No videos yet. Add some below.</p>`}</div>
      <div class="bar" style="margin-top:12px">
        <select class="input grow" id="pe-add"><option value="">＋ Add a video…</option>${groups.map(([c, l]) => `<optgroup label="${esc(c)}">${l.map(v => `<option value="${esc(v.id)}">${esc(v.title)}</option>`).join("")}</optgroup>`).join("")}</select>
      </div>
      <div class="bar" style="margin-top:20px;justify-content:flex-end">
        <button class="btn" id="pe-cancel">Cancel</button>
        <button class="btn btn-primary" id="pe-save">${pe.index < 0 ? "Publish path" : "Save path"}</button>
      </div>`;
    const keep = () => { p.icon = $("#pe-icon").value.trim(); p.title = $("#pe-title").value.trim(); p.description = $("#pe-desc").value.trim(); p.hidden = $("#pe-hidden").checked; };
    const move = (i, d) => { keep(); const [x] = p.videos.splice(i, 1); p.videos.splice(i + d, 0, x); renderPathEditor(); };
    $$("[data-pv-up]").forEach(b => b.onclick = () => move(+b.dataset.pvUp, -1));
    $$("[data-pv-down]").forEach(b => b.onclick = () => move(+b.dataset.pvDown, 1));
    $$("[data-pv-rm]").forEach(b => b.onclick = () => { keep(); p.videos.splice(+b.dataset.pvRm, 1); renderPathEditor(); });
    $("#pe-add").onchange = e => { if (!e.target.value) return; keep(); p.videos.push(e.target.value); renderPathEditor(); };
    $("#pe-back").onclick = $("#pe-cancel").onclick = () => { pe = null; renderPaths(); };
    $("#pe-save").onclick = async () => {
      keep();
      if (!p.title) return alert("Add a title.");
      if (!p.videos.length) return alert("Add at least one video.");
      if (!p.hidden) delete p.hidden;
      if (!p.id) {
        const base = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "path";
        let id = base, n = 2; while (P().some(x => x.id === id)) id = base + "-" + n++;
        p.id = id;
      }
      // Changed wording → let the translator redo automatic translations.
      if (p.tr) for (const k in p.tr) if (p.tr[k].auto) p.tr[k].src = "";
      const isNew = pe.index < 0;
      await update("paths", d => {
        d.paths = d.paths || [];
        const i = d.paths.findIndex(x => x.id === p.id);
        if (i >= 0) d.paths[i] = p; else d.paths.push(p);
        return d;
      }, `${isNew ? "Add" : "Edit"} learning path: ${p.title}`);
      pe = null; toast(isNew ? "Published. Live in about a minute." : "Saved. Live in about a minute."); render();
    };
  }

  /* ---------- Video requests (Google Sheet inbox) ---------- */
  const reqKey = () => { try { return localStorage.getItem("ab_req_key") || ""; } catch { return ""; } };
  let reqs = null, reqErr = "", reqFilter = "new";
  async function loadRequests() {
    const url = data.settings.json.requestUrl;
    if (!url || !reqKey()) { reqs = null; return; }
    try {
      const r = await fetch(url + (url.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(reqKey()), { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error === "key" ? "The inbox password doesn't match the one in the Google script." : (j.error || "error"));
      reqs = j.requests || []; reqErr = "";
    } catch (e) { reqErr = e.message === "Failed to fetch" ? "Couldn't reach the request inbox. Check the link in Settings." : e.message; }
  }
  function badgeRequests() {
    const n = (reqs || []).filter(r => r.status === "new").length;
    const b = $("#n-req"); if (b) { b.hidden = !n; b.textContent = n; }
  }
  async function reqAction(body) {
    busy(true);
    try {
      const r = await fetch(data.settings.json.requestUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ key: reqKey(), ...body }) });
      const j = await r.json(); if (!j.ok) throw new Error(j.error || "failed");
    } catch (e) { alert("Couldn't update the request: " + e.message); }
    finally { busy(false); }
    await loadRequests(); render();
  }
  function renderRequests() {
    badgeRequests();
    const url = data.settings.json.requestUrl;
    if (!url || !reqKey()) {
      $("#app").innerHTML = `<div class="card-plain"><h2>Video requests</h2>
        <p>Technicians can tap <b>🙋 Request a video</b> in the app. Requests come here, privately — they are kept in a Google Sheet that only you can open, not in the public GitHub repo.</p>
        <p><b>One-time setup (about 5 minutes):</b></p>
        <ol class="setup-steps">
          <li>Open <a href="https://sheets.new" target="_blank" rel="noopener">sheets.new</a> to create a new Google Sheet. Name it “ABFM video requests”.</li>
          <li>In the sheet: <b>Extensions → Apps Script</b>. Delete what's there and paste the script from <a href="https://github.com/${esc(cfg.owner)}/${esc(cfg.repo)}/blob/${esc(cfg.branch)}/setup/request-inbox.gs" target="_blank" rel="noopener">setup/request-inbox.gs</a>.</li>
          <li>On the line <code>const ADMIN_KEY = "CHANGE-THIS-TO-A-LONG-PASSWORD";</code> put your own long password. Click 💾 Save.</li>
          <li><b>Deploy → New deployment</b> → gear icon → <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Click Deploy and allow access.</li>
          <li>Copy the <b>Web app URL</b> and paste it, with your password, in <b>Settings → Request inbox</b> here.</li>
        </ol>
        <button class="btn btn-primary" id="go-settings">Open Settings</button></div>`;
      $("#go-settings").onclick = () => { view = "settings"; render(); };
      return;
    }
    const list = (reqs || []).filter(r => reqFilter === "all" || (reqFilter === "new" ? r.status === "new" : r.status !== "new"));
    const ago = iso => { const d = (Date.now() - Date.parse(iso)) / 864e5; return d < 1 ? "today" : d < 2 ? "yesterday" : Math.floor(d) + " days ago"; };
    $("#app").innerHTML = `
      ${reqErr ? `<div class="err">⚠ ${esc(reqErr)}</div>` : ""}
      <div class="bar">
        <select id="rq-filter">${[["new", "New"], ["done", "Done"], ["all", "All"]].map(([k, l]) => `<option value="${k}" ${k === reqFilter ? "selected" : ""}>${l}</option>`).join("")}</select>
        <p class="count grow" style="margin:0">${reqs ? `${(reqs || []).filter(r => r.status === "new").length} new · ${(reqs || []).length} total` : "Loading…"}</p>
        <button class="btn btn-sm" id="rq-refresh">↻ Refresh</button>
      </div>
      <div class="rows">${list.map(r => `
        <div class="row req ${r.status !== "new" ? "is-hidden" : ""}">
          <div class="req-ico">🙋</div>
          <div>
            <h3>${esc(r.topic)}</h3>
            ${r.details ? `<p class="req-d">${esc(r.details)}</p>` : ""}
            <div class="meta">
              ${r.category ? `<span>${esc(r.category)}</span>` : ""}
              ${r.name ? `<span>👤 ${esc(r.name)}</span>` : ""}${r.site ? `<span>📍 ${esc(r.site)}</span>` : ""}
              <span>${esc(ago(r.time))}</span>${r.lang && r.lang !== "en" ? `<span>${esc(String(r.lang).toUpperCase())}</span>` : ""}
              ${r.status !== "new" ? `<span class="badge-s b-ok">✓ Done</span>` : ""}
            </div>
          </div>
          <div class="row-actions">
            <a class="btn btn-sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent(r.topic)}" target="_blank" rel="noopener">Search YouTube</a>
            ${r.status === "new" ? `<button class="btn btn-sm btn-primary" data-rq-add="${esc(r.id)}">Add video</button><button class="btn btn-sm" data-rq-done="${esc(r.id)}">Mark done</button>` : `<button class="btn btn-sm" data-rq-open="${esc(r.id)}">Reopen</button>`}
            <button class="btn btn-sm btn-danger" data-rq-del="${esc(r.id)}">Delete</button>
          </div>
        </div>`).join("") || (reqs ? `<div class="empty"><div class="big">📭</div><h3>No ${reqFilter === "all" ? "" : reqFilter + " "}requests</h3></div>` : "")}</div>`;
    $("#rq-filter").onchange = e => { reqFilter = e.target.value; renderRequests(); };
    $("#rq-refresh").onclick = async () => { reqs = null; renderRequests(); await loadRequests(); render(); };
    $$("[data-rq-done]").forEach(b => b.onclick = () => reqAction({ action: "status", id: b.dataset.rqDone, status: "done" }));
    $$("[data-rq-open]").forEach(b => b.onclick = () => reqAction({ action: "status", id: b.dataset.rqOpen, status: "new" }));
    $$("[data-rq-del]").forEach(b => b.onclick = () => { if (confirm("Delete this request?")) reqAction({ action: "delete", id: b.dataset.rqDel }); });
    $$("[data-rq-add]").forEach(b => b.onclick = () => {
      const r = reqs.find(x => String(x.id) === b.dataset.rqAdd);
      openEditor(null, cats().includes(r.category) ? { category: r.category } : {}, async () => { await reqAction({ action: "status", id: r.id, status: "done" }); });
    });
    if (reqs === null && !reqErr) loadRequests().then(render);
  }

  /* ---------- Toolbox talks ---------- */
  let te = null;
  const TK = () => data.toolbox.json.talks || (data.toolbox.json.talks = []);
  const dayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function todayTalkId() {
    const list = TK().filter(k => !k.hidden), today = dayStr();
    const pinned = list.find(k => k.date === today); if (pinned) return pinned.id;
    const pool = list.filter(k => !k.date); if (!pool.length) return null;
    return pool[Math.floor(Date.parse(today + "T00:00:00Z") / 864e5) % pool.length].id;
  }
  function renderToolbox() {
    if (te) return renderTalkEditor();
    const tid = todayTalkId();
    $("#app").innerHTML = `
      <div class="bar"><p class="help grow" style="margin:0">A different talk shows on the app's home screen each day, in rotation. Supervisors can read it out (or press 🔊) at the morning briefing. To choose the talk for a specific day, set its date.</p>
        <button class="btn btn-primary" id="tk-add">＋ New talk</button></div>
      <div class="rows">${TK().map((k, i) => `
        <div class="row ${k.hidden ? "is-hidden" : ""}">
          <div class="thumb path-ico">${esc(k.icon || "🦺")}</div>
          <div><h3>${esc(k.title)}</h3>
            <div class="meta"><span>${(k.points || []).length} points</span>
              ${k.id === tid ? `<span class="badge-s b-feat">Today</span>` : ""}
              ${k.date ? `<span class="badge-s b-ess">📅 ${esc(k.date)}</span>` : ""}
              ${k.hidden ? `<span class="badge-s b-hidden">Hidden</span>` : ""}
              ${k.tr && Object.keys(k.tr).length ? `<span class="badge-s b-ok">🌐 ${Object.keys(k.tr).length}/8</span>` : `<span class="badge-s b-hidden">Translating…</span>`}</div></div>
          <div class="row-actions">
            <button class="btn btn-sm" data-tk-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button class="btn btn-sm" data-tk-edit="${i}">Edit</button>
            <button class="btn btn-sm btn-danger" data-tk-del="${i}">Delete</button>
          </div></div>`).join("") || `<div class="empty"><h3>No toolbox talks yet</h3></div>`}</div>`;
    $("#tk-add").onclick = () => { te = { index: -1, k: { id: "", icon: "🦺", title: "", points: [], ask: "" } }; renderToolbox(); };
    $$("[data-tk-edit]").forEach(b => b.onclick = () => { const i = +b.dataset.tkEdit; te = { index: i, k: JSON.parse(JSON.stringify(TK()[i])) }; renderToolbox(); });
    $$("[data-tk-del]").forEach(b => b.onclick = async () => {
      const k = TK()[+b.dataset.tkDel]; if (!confirm(`Delete the talk “${k.title}”?`)) return;
      await update("toolbox", d => { d.talks = (d.talks || []).filter(x => x.id !== k.id); return d; }, `Delete toolbox talk: ${k.title}`);
      toast("Deleted."); render();
    });
    $$("[data-tk-up]").forEach(b => b.onclick = async () => {
      const id = TK()[+b.dataset.tkUp].id;
      await update("toolbox", d => { const i = d.talks.findIndex(x => x.id === id); if (i > 0) d.talks.splice(i - 1, 0, d.talks.splice(i, 1)[0]); return d; }, "Reorder toolbox talks");
      render();
    });
  }
  function renderTalkEditor() {
    const k = te.k;
    $("#app").innerHTML = `
      <button class="btn btn-sm btn-ghost" id="te-back">‹ All talks</button>
      <h2 style="margin:10px 0 14px">${te.index < 0 ? "New toolbox talk" : "Edit toolbox talk"}</h2>
      <div class="two" style="grid-template-columns:90px 1fr">
        <div class="field"><label for="te-icon">Icon</label><input class="input" id="te-icon" maxlength="4" value="${esc(k.icon || "")}" style="text-align:center;font-size:22px"></div>
        <div class="field"><label for="te-title">Title</label><input class="input" id="te-title" placeholder="e.g. Heat stress" value="${esc(k.title)}"></div>
      </div>
      <div class="field"><label for="te-points">Key points</label><textarea class="textarea" id="te-points" rows="6" placeholder="One point per line">${esc((k.points || []).join("\n"))}</textarea><div class="help">One point per line. 3–5 short points work best.</div></div>
      <div class="field"><label for="te-ask">Question to ask the team</label><input class="input" id="te-ask" placeholder="e.g. Where is the nearest drinking water on today's site?" value="${esc(k.ask || "")}"></div>
      <div class="two">
        <div class="field"><label for="te-video">Linked video (optional)</label>
          <select class="input" id="te-video"><option value="">None</option>${cats().map(c => `<optgroup label="${esc(c)}">${V().filter(v => v.category === c).map(v => `<option value="${esc(v.id)}" ${v.id === k.video ? "selected" : ""}>${esc(v.title)}</option>`).join("")}</optgroup>`).join("")}</select></div>
        <div class="field"><label for="te-date">Show on a specific date (optional)</label><input class="input" id="te-date" type="date" value="${esc(k.date || "")}"><div class="help">Leave empty to include it in the daily rotation.</div></div>
      </div>
      <label class="check"><input type="checkbox" id="te-hidden" ${k.hidden ? "checked" : ""}> Hide from staff</label>
      <div class="bar" style="margin-top:20px;justify-content:flex-end">
        <button class="btn" id="te-cancel">Cancel</button>
        <button class="btn btn-primary" id="te-save">${te.index < 0 ? "Publish talk" : "Save talk"}</button>
      </div>`;
    $("#te-back").onclick = $("#te-cancel").onclick = () => { te = null; renderToolbox(); };
    $("#te-save").onclick = async () => {
      k.icon = $("#te-icon").value.trim() || "🦺";
      k.title = $("#te-title").value.trim();
      k.points = $("#te-points").value.split("\n").map(x => x.trim().replace(/^[-•*\d.)\s]+/, "")).filter(Boolean);
      k.ask = $("#te-ask").value.trim();
      const vid = $("#te-video").value, date = $("#te-date").value;
      if (vid) k.video = vid; else delete k.video;
      if (date) k.date = date; else delete k.date;
      if ($("#te-hidden").checked) k.hidden = true; else delete k.hidden;
      if (!k.title) return alert("Add a title.");
      if (!k.points.length) return alert("Add at least one point.");
      if (!k.id) {
        const base = k.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "talk";
        let id = base, n = 2; while (TK().some(x => x.id === id)) id = base + "-" + n++;
        k.id = id;
      }
      const isNew = te.index < 0;
      await update("toolbox", d => {
        d.talks = d.talks || [];
        const i = d.talks.findIndex(x => x.id === k.id);
        if (i >= 0) d.talks[i] = k; else d.talks.push(k);
        return d;
      }, `${isNew ? "Add" : "Edit"} toolbox talk: ${k.title}`);
      te = null; toast(isNew ? "Published. Live in about a minute." : "Saved. Live in about a minute."); render();
    };
  }

  /* ---------- Channels ---------- */
  let chEdit = null;
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
        if (chEdit === ch.url) return `<form class="ch-row ch-edit" id="ch-edit-form">
          <div class="ch-edit-fields">
            <div class="field"><label for="ce-name">Name</label><input class="input" id="ce-name" required value="${esc(ch.name || "")}"></div>
            <div class="field"><label for="ce-url">Channel link</label><input class="input" id="ce-url" required autocapitalize="off" spellcheck="false" value="${esc(ch.url)}"></div>
            <div class="field"><label for="ce-cat">Send videos to</label><select class="input" id="ce-cat"><option value="">Pick from title</option>${cats().map(x => `<option ${x === ch.category ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
            <label class="check"><input type="checkbox" id="ce-active" ${ch.active === false ? "" : "checked"}> Active (checked every day)</label>
          </div>
          <div class="row-actions">
            <button type="button" class="btn btn-sm" id="ce-cancel">Cancel</button>
            <button class="btn btn-sm btn-primary">Save</button>
          </div>
        </form>`;
        return `<div class="ch-row">
          <div>
            <b>${esc(ch.name || ch.url)}</b> ${ch.active === false ? `<span class="badge-s b-hidden">Paused</span>` : ""}
            ${s.error ? `<span class="badge-s b-prob">Problem</span>` : s.id ? `<span class="badge-s b-ok">OK</span>` : `<span class="badge-s b-hidden">Not checked yet</span>`}
            <div class="small">${esc(ch.url)}${ch.category ? " · goes to " + esc(ch.category) : " · category picked from title"}</div>
            ${s.error ? `<div class="small" style="color:var(--danger)">${esc(s.error)}</div>` : ""}
          </div>
          <div class="row-actions">
            <button class="btn btn-sm" data-ch-edit="${esc(ch.url)}">Edit</button>
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
    $$("[data-ch-edit]").forEach(b => b.onclick = () => { chEdit = b.dataset.chEdit; renderChannels(); const f = $("#ce-name"); if (f) f.focus(); });
    const ef = $("#ch-edit-form");
    if (ef) {
      $("#ce-cancel").onclick = () => { chEdit = null; renderChannels(); };
      ef.onsubmit = async e => {
        e.preventDefault();
        const oldUrl = chEdit;
        const url = $("#ce-url").value.trim().replace(/\/(videos|featured|shorts|streams)\/?$/, "").replace(/\?.*$/, "");
        if (!/youtube\.com\/(@|channel\/|c\/|user\/)/.test(url)) return alert("Use a channel link like https://www.youtube.com/@ChannelName");
        if (url !== oldUrl && (c.channels || []).some(x => x.url === url)) return alert("That channel is already in the list.");
        const name = $("#ce-name").value.trim(), category = $("#ce-cat").value, active = $("#ce-active").checked;
        if (!name) return alert("Add a name.");
        await update("channels", d => {
          const ch = (d.channels || []).find(x => x.url === oldUrl);
          if (ch) Object.assign(ch, { name, url, category, active });
          return d;
        }, `Edit channel: ${name}`);
        chEdit = null;
        toast(url !== oldUrl ? "Saved. The new link will be checked on the next run." : "Channel saved.");
        render();
      };
    }
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
        <div class="card-plain">
          <h2>Request inbox</h2>
          <p class="count">Where “Request a video” sends requests. See the Requests tab for the 5-minute setup.</p>
          <div class="field"><label for="s-req">Web app URL (from Google Apps Script)</label><input class="input" id="s-req" inputmode="url" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.requestUrl || "")}"><div class="help">Saved with the site settings. Leave empty to hide the Request button.</div></div>
          <div class="field"><label for="s-reqkey">Inbox password (ADMIN_KEY in the script)</label><input class="input" id="s-reqkey" type="password" autocomplete="off" value="${esc(reqKey())}"><div class="help">Kept only in this browser — never saved to GitHub.</div></div>
        </div>
        <div class="card-plain">
          <h2>Auto-draft with Gemini (optional)</h2>
          <p class="count">Without a key, drafts come from the YouTube description and built-in safety rules. With a free Gemini key, Gemini watches each video and drafts the summary, safety note and steps from what it shows.</p>
          <ol class="setup-steps">
            <li>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> (sign in with Google → Create API key).</li>
            <li>For the <b>✨ Auto-draft</b> button here, paste it below.</li>
            <li>For the daily review queue, also add it on GitHub: repo <b>Settings → Secrets and variables → Actions → New repository secret</b>, name <code>GEMINI_API_KEY</code>.</li>
          </ol>
          <div class="field"><label for="s-gem">Gemini API key</label><input class="input" id="s-gem" type="password" autocomplete="off" value="${esc(geminiKey())}"><div class="help">Kept only in this browser.</div></div>
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
        excludeKeywords: $("#s-excl").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean),
        requestUrl: $("#s-req").value.trim()
      };
      try {
        localStorage.setItem("ab_req_key", $("#s-reqkey").value.trim());
        localStorage.setItem("ab_gemini_key", $("#s-gem").value.trim());
      } catch {}
      await update("settings", d => Object.assign(d, vals), "Update site settings");
      reqs = null; loadRequests().then(badgeRequests);
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
