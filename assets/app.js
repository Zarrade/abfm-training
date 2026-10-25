/* Al Bonian FM — public training library */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LANGS = window.AB_LANGS, TEXT = window.AB_TEXT;
  const LEVELS = ["Beginner", "Intermediate", "Advanced"];
  const PAGE = 24;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  const state = {
    videos: [], settings: { categories: [], newDays: 7 }, updated: "",
    lang: store.get("ab_lang", null),
    saved: new Set(store.get("ab_saved", [])),
    tab: "library", cat: "ALL", level: "ALL", sort: "new", q: "", limit: PAGE,
    listScroll: 0, showEn: false,
    paths: [], done: new Set(store.get("ab_done", [])), talks: []
  };

  /* ---------- helpers ---------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function t(key, vars) {
    let s = (TEXT[state.lang] && TEXT[state.lang][key]) || TEXT.en[key] || key;
    if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
    return s;
  }
  const catLabel = c => (TEXT[state.lang] && TEXT[state.lang].cats && TEXT[state.lang].cats[c]) || c;
  const catIcon = c => (state.settings.categories.find(x => x.name === c) || {}).icon || "▶️";
  const durSec = d => (d || "").split(":").reduce((a, n) => a * 60 + (+n || 0), 0);
  const daysSince = d => (Date.now() - new Date(d + "T00:00:00").getTime()) / 864e5;
  const isNew = v => v.added && daysSince(v.added) <= (state.settings.newDays || 7);
  const tr = v => (!state.showEn && v.tr && v.tr[state.lang]) || {};
  const titleOf = v => tr(v).title || v.title;
  const pTr = p => (!state.showEn && p.tr && p.tr[state.lang]) || {};
  const byId = id => state.videos.find(x => x.id === id);
  const pathVideos = p => p.videos.map(byId).filter(Boolean);
  function setDone(id, on) {
    on ? state.done.add(id) : state.done.delete(id);
    store.set("ab_done", [...state.done]);
  }
  const fmtDate = d => { try { return new Date(d + "T00:00:00").toLocaleDateString(state.lang === "en" ? "en-GB" : state.lang, { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };
  const link = v => location.href.split("#")[0] + "#/v/" + encodeURIComponent(v.id);
  const thumb = (yt, size = "mqdefault") => `https://i.ytimg.com/vi/${encodeURIComponent(yt)}/${size}.jpg`;

  let toastTimer;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200); }

  const ICON = {
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    bookmarkOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    yt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
    back: '<svg class="flip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    translate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h8M8 3v2c0 4-2 7-5 8M6 9c1 2 3 4 6 5M13 21l4-9 4 9M14.5 18h5"/></svg>'
  };

  /* ---------- language ---------- */
  function applyLang() {
    const meta = LANGS.find(l => l.code === state.lang) || LANGS[0];
    document.documentElement.lang = meta.code;
    document.documentElement.dir = meta.dir;
    $("#lang-label").textContent = meta.code === "en" ? "EN" : meta.name;
    $$("[data-t]").forEach(el => { el.textContent = t(el.dataset.t); });
    $("#q").placeholder = t("search");
    $("#q").setAttribute("aria-label", t("search"));
    renderLangList();
    if (state.videos.length) applySettings();
  }
  function renderLangList() {
    $("#lang-list").innerHTML = LANGS.map(l =>
      `<button lang="${l.code}" dir="${l.dir}" data-lang="${l.code}" aria-pressed="${l.code === state.lang}">${esc(l.name)}</button>`).join("");
  }
  function openSheet(id) { const s = $(id); s.hidden = false; const f = s.querySelector("button"); f && f.focus(); }
  function closeSheets() { $$(".sheet").forEach(s => s.hidden = true); }

  /* ---------- data ---------- */
  async function getJSON(path) {
    const r = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }
  async function load() {
    renderSkeleton();
    try {
      const [vd, st, health, pd, tb] = await Promise.all([
        getJSON("data/videos.json"),
        getJSON("data/settings.json").catch(() => ({})),
        getJSON("data/health.json").catch(() => ({ problems: [] })),
        getJSON("data/paths.json").catch(() => ({ paths: [] })),
        getJSON("data/toolbox.json").catch(() => ({ talks: [] }))
      ]);
      Object.assign(state.settings, st);
      const dead = new Set((health.problems || []).filter(p => p.status === "notfound").map(p => p.yt));
      state.videos = (vd.videos || []).filter(v => v && v.yt && !v.hidden && !dead.has(v.yt))
        .map(v => Object.assign({ level: "Intermediate", ppe: [], steps: [], summary: "", safety: "" }, v));
      state.updated = vd.updated || "";
      state.talks = (tb.talks || []).filter(k => k && k.id && k.title && !k.hidden);
      state.paths = (pd.paths || []).filter(p => p && p.id && !p.hidden && (p.videos || []).some(id => byId(id)));
      applySettings();
      route();
    } catch (e) {
      console.error(e);
      $("#grid").innerHTML = "";
      $("#count").textContent = "";
      const em = $("#empty");
      em.hidden = false;
      em.innerHTML = `<div class="big">📶</div><h3>${esc(t("loadError"))}</h3><p><button class="btn btn-primary" id="retry">${esc(t("retry"))}</button></p>`;
      $("#retry").onclick = load;
    }
  }
  function applySettings() {
    const s = state.settings;
    if (s.siteName) {
      const parts = s.siteName.split(" ");
      const last = parts.pop();
      $("#site-name").innerHTML = esc(parts.join(" ")) + (parts.length ? " " : "") + "<b>" + esc(last) + "</b>";
    }
    const st = (s.tr && s.tr[state.lang]) || {};
    if (s.tagline) $("#site-tag").textContent = st.tagline || s.tagline;
    const a = $("#announce");
    a.hidden = !s.announcement;
    a.textContent = s.announcement ? "📣  " + (st.announcement || s.announcement) : "";
    const n = state.videos.filter(isNew).length;
    const b = $("#new-badge"); b.hidden = !n; b.textContent = n > 99 ? "99+" : n;
  }

  /* ---------- filtering ---------- */
  function haystack(v) {
    const x = tr(v);
    return [v.title, v.summary, v.subject, v.channel, v.category, catLabel(v.category), (v.steps || []).join(" "), (v.ppe || []).join(" "), x.title, x.summary, (x.steps || []).join(" "), (x.ppe || []).join(" ")].join(" ").toLowerCase();
  }
  function baseSet() {
    let list = state.videos;
    if (state.tab === "new") list = list.filter(isNew);
    if (state.tab === "saved") list = list.filter(v => state.saved.has(v.id));
    const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) list = list.filter(v => { const h = haystack(v); return words.every(w => h.includes(w)); });
    return list;
  }
  function filtered() {
    let list = baseSet();
    if (state.cat !== "ALL") list = list.filter(v => v.category === state.cat);
    if (state.level !== "ALL") list = list.filter(v => v.level === state.level);
    const by = {
      new: (a, b) => (b.featured === true) - (a.featured === true) || (b.added || "").localeCompare(a.added || "") || a.title.localeCompare(b.title),
      short: (a, b) => durSec(a.duration) - durSec(b.duration),
      az: (a, b) => titleOf(a).localeCompare(titleOf(b), state.lang)
    }[state.sort];
    return [...list].sort(by);
  }

  /* ---------- rendering: list ---------- */
  function renderSkeleton() {
    $("#grid").innerHTML = Array.from({ length: 6 }, () =>
      `<div class="card" aria-hidden="true"><div class="thumb sk"></div><div class="card-body"><div class="sk" style="height:12px;width:40%"></div><div class="sk" style="height:16px"></div><div class="sk" style="height:16px;width:70%"></div></div></div>`).join("");
  }
  function card(v) {
    const on = state.saved.has(v.id);
    return `<article class="card${v.essential ? " is-ess" : ""}">
      <a class="card-link" href="#/v/${encodeURIComponent(v.id)}">
        <div class="thumb">
          <img loading="lazy" decoding="async" src="${thumb(v.yt)}" alt="" width="320" height="180">
          ${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}
          ${v.essential ? `<span class="tag-new tag-ess">🦺 ${esc(t("essentialTag"))}</span>` : isNew(v) ? `<span class="tag-new">${esc(t("new"))}</span>` : ""}
          ${state.done.has(v.id) ? `<span class="tag-done" title="${esc(t("doneLabel"))}">✓</span>` : ""}
        </div>
        <div class="card-body">
          <div class="meta"><span>${catIcon(v.category)} ${esc(catLabel(v.category))}</span><span class="lvl lvl-${esc(v.level)}">${esc(t(v.level))}</span></div>
          <h3>${esc(titleOf(v))}</h3>
          ${v.channel ? `<div class="chan">${esc(v.channel)}</div>` : ""}
        </div>
      </a>
      <button class="save-btn" data-save="${esc(v.id)}" aria-pressed="${on}" aria-label="${esc(on ? t("savedLabel") : t("save"))}">${on ? ICON.bookmarkOn : ICON.bookmark}</button>
    </article>`;
  }
  function mini(v, href) {
    return `<a class="mini" href="${href || "#/v/" + encodeURIComponent(v.id)}">
      <div class="thumb"><img loading="lazy" src="${thumb(v.yt)}" alt="" width="320" height="180">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}${state.done.has(v.id) ? `<span class="tag-done">✓</span>` : ""}</div>
      <div><h3>${esc(titleOf(v))}</h3><div class="meta"><span class="lvl lvl-${esc(v.level)}">${esc(t(v.level))}</span>${v.channel ? `<span>${esc(v.channel)}</span>` : ""}</div></div>
    </a>`;
  }
  function renderChips() {
    const base = baseSet().filter(v => state.level === "ALL" || v.level === state.level);
    const counts = {};
    base.forEach(v => counts[v.category] = (counts[v.category] || 0) + 1);
    const known = state.settings.categories.map(c => c.name);
    const extra = [...new Set(state.videos.map(v => v.category))].filter(c => !known.includes(c));
    const cats = [...known, ...extra].filter(c => counts[c] || c === state.cat);
    $("#cats").innerHTML =
      `<button class="chip" data-cat="ALL" aria-pressed="${state.cat === "ALL"}">${esc(t("all"))} <span class="n">${base.length}</span></button>` +
      cats.map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${catIcon(c)} ${esc(catLabel(c))} <span class="n">${counts[c] || 0}</span></button>`).join("");
    $("#levels").innerHTML = ["ALL", ...LEVELS].map(l =>
      `<button data-level="${l}" aria-pressed="${state.level === l}">${esc(l === "ALL" ? t("all") : t(l))}</button>`).join("");
  }
  function renderList() {
    renderChips();
    $("#sort").value = state.sort;
    const list = filtered();
    const showRail = state.tab === "library" && !state.q && state.cat === "ALL" && state.level === "ALL";
    const allNew = state.videos.filter(isNew);
    // Only show the "New this week" strip when it adds something (not when nearly everything is new).
    const fresh = showRail && allNew.length && allNew.length <= state.videos.length * 0.6 ? [...allNew].sort((a, b) => b.added.localeCompare(a.added)).slice(0, 12) : [];
    const talk = showRail ? todayTalk() : null;
    const tc = $("#talk-card");
    tc.hidden = !talk;
    if (talk) {
      const x = kTr(talk);
      tc.innerHTML = `<span class="tk-ico">${esc(talk.icon || "🦺")}</span>
        <span class="tk-body"><span class="tk-label">${esc(t("toolboxToday"))}</span><strong>${esc(x.title || talk.title)}</strong><span class="tk-hint">${esc(t("toolboxHint"))}</span></span>
        <span class="tk-go flip-r">${ICON.back}</span>`;
    }
    $("#req-row").hidden = !state.settings.requestUrl || !!state.q && !list.length;
    const ess = showRail ? state.videos.filter(v => v.essential) : [];
    $("#ess-wrap").hidden = !ess.length;
    $("#ess-rail").innerHTML = ess.sort((a, b) => state.done.has(a.id) - state.done.has(b.id)).map(card).join("");
    $("#paths-wrap").hidden = !(showRail && state.paths.length);
    $("#paths-rail").innerHTML = showRail ? state.paths.map(pathCard).join("") : "";
    $("#rail-wrap").hidden = !fresh.length;
    $("#rail").innerHTML = fresh.map(card).join("");

    $("#count").textContent = list.length ? t("videos", { n: list.length }) : "";
    $("#grid").innerHTML = list.slice(0, state.limit).map(card).join("");
    $("#more").hidden = list.length <= state.limit;

    const em = $("#empty");
    em.hidden = !!list.length;
    if (!list.length) {
      if (state.tab === "saved" && !state.q) {
        em.innerHTML = `<div class="big">🔖</div><h3>${esc(t("savedEmpty"))}</h3><p>${esc(t("savedEmptyHint"))}</p>`;
      } else {
        em.innerHTML = `<div class="big">🔍</div><h3>${esc(t("noResults"))}</h3><p>${esc(t("noResultsHint"))}</p><p><button class="btn" id="clear-all">${esc(t("clearFilters"))}</button></p>
          ${state.settings.requestUrl ? `<p class="hint">${esc(t("requestHint"))}</p><p><button class="btn btn-primary" data-request>🙋 ${esc(t("requestVideo"))}</button></p>` : ""}`;
      }
    }
    const s = state.settings;
    $("#foot").innerHTML = [state.updated ? esc(t("updated", { date: fmtDate(state.updated) })) : "", s.helpdesk ? esc(t("helpdesk")) + ": " + esc(s.helpdesk) : ""].filter(Boolean).join(" · ");
    $$("[data-tab]").forEach(b => b.toggleAttribute("aria-current", false));
    $$(`[data-tab="${state.tab}"]`).forEach(b => b.setAttribute("aria-current", "page"));
  }

  /* ---------- toolbox talk of the day ---------- */
  const kTr = k => (!state.showEn && k.tr && k.tr[state.lang]) || {};
  const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function todayTalk() {
    const list = state.talks; if (!list.length) return null;
    const today = localDay();
    const pinned = list.find(k => k.date === today);
    if (pinned) return pinned;
    const pool = list.filter(k => !k.date);
    if (!pool.length) return null;
    const n = Math.floor(Date.parse(today + "T00:00:00Z") / 864e5);
    return pool[n % pool.length];
  }
  function renderTalk(k) {
    const x = kTr(k), today = todayTalk();
    const pts = (x.points && x.points.length === (k.points || []).length) ? x.points : (k.points || []);
    const has = !!(x.title);
    const vid = k.video ? state.videos.find(v => v.id === k.video) : null;
    const others = state.talks.filter(o => o.id !== k.id);
    const el = $("#video-view");
    const canSpeak = "speechSynthesis" in window;
    const BCP = { en: "en-GB", hi: "hi-IN", ur: "ur-PK", ml: "ml-IN", bn: "bn-IN", ta: "ta-IN", ne: "ne-NP", tl: "fil-PH", ar: "ar-SA" };
    const sl = has ? state.lang : "en";
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm vp-back" id="back">${ICON.back}<span>${esc(t("back"))}</span></button>
      <article class="talk">
        <div class="talk-top"><span class="tk-label">${esc(k === today ? t("toolboxToday") : "🦺")}</span><span class="count">${esc(fmtDate(localDay()))}</span></div>
        <div class="path-head"><div class="ph-ico">${esc(k.icon || "🦺")}</div><div><h1>${esc(x.title || k.title)}</h1>${has ? `<p class="en-title" lang="en" dir="ltr">${esc(k.title)}</p>` : ""}</div></div>
        <ol class="talk-points" ${has || state.lang === "en" ? "" : 'lang="en" dir="ltr"'}>${pts.map(p => `<li>${esc(p)}</li>`).join("")}</ol>
        ${k.ask ? `<div class="talk-ask"><strong>💬 ${esc(t("askTeam"))}</strong><p ${x.ask || state.lang === "en" ? "" : 'lang="en" dir="ltr"'}>${esc(x.ask || k.ask)}</p></div>` : ""}
        <div class="actions">
          ${canSpeak ? `<button class="btn btn-primary" id="tk-listen">🔊 <span>${esc(t("listen"))}</span></button>` : ""}
          ${state.lang !== "en" && has ? `<button class="btn" id="tr-toggle">${state.showEn ? esc((LANGS.find(l => l.code === state.lang) || {}).name || "") : "English"}</button>` : ""}
        </div>
        ${vid ? `<div class="mini-list">${mini(vid)}</div>` : ""}
      </article>
      <div class="section-h" style="margin-top:22px"><h2>${esc(t("otherTalks"))}</h2></div>
      <div class="talk-list">${others.map(o => `<a href="#/talk/${encodeURIComponent(o.id)}"><span>${esc(o.icon || "🦺")}</span>${esc(kTr(o).title || o.title)}</a>`).join("")}</div>`;
    $("#back").onclick = () => { if (history.length > 1 && sessionStorage.getItem("ab_in_app")) history.back(); else location.hash = "#/"; };
    const tt = $("#tr-toggle"); if (tt) tt.onclick = () => { state.showEn = !state.showEn; renderTalk(k); };
    const lb = $("#tk-listen");
    if (lb) {
      let on = false;
      const draw = () => { lb.innerHTML = `${on ? "⏹" : "🔊"} <span>${esc(on ? t("stop") : t("listen"))}</span>`; };
      lb.onclick = () => {
        speechSynthesis.cancel();
        on = !on; draw();
        if (!on) return;
        const parts = [x.title && !state.showEn ? x.title : k.title, ...(state.showEn ? k.points : pts), (state.showEn ? k.ask : (x.ask || k.ask)) || ""].filter(Boolean);
        const lang = state.showEn ? "en" : sl;
        parts.forEach((txt, i) => {
          const u = new SpeechSynthesisUtterance(txt);
          u.lang = BCP[lang] || "en-GB"; u.rate = 0.95;
          const voice = speechSynthesis.getVoices().find(vo => vo.lang && vo.lang.toLowerCase().startsWith(lang === "tl" ? "fil" : lang));
          if (voice) u.voice = voice;
          if (i === parts.length - 1) u.onend = () => { on = false; draw(); };
          speechSynthesis.speak(u);
        });
      };
    }
  }

  /* ---------- request a video ---------- */
  function openRequest(topic) {
    const f = $("#req-form");
    f.reset();
    $("#r-topic").value = topic || "";
    $("#r-cat").innerHTML = state.settings.categories.map(c => `<option value="${esc(c.name)}">${c.icon || ""} ${esc(catLabel(c.name))}</option>`).join("") + `<option value="">${esc(t("other"))}</option>`;
    const low = String(topic || "").toLowerCase();
    const guess = state.cat !== "ALL" ? state.cat : (state.settings.categories.find(c => (c.keywords || []).some(w => w && low.includes(String(w).toLowerCase()))) || {}).name;
    $("#r-cat").value = guess || "";
    $("#r-topic").oninput = e => {
      if ($("#r-cat").dataset.touched) return;
      const l = e.target.value.toLowerCase();
      const g = (state.settings.categories.find(c => (c.keywords || []).some(w => w && l.includes(String(w).toLowerCase()))) || {}).name;
      if (g) $("#r-cat").value = g;
    };
    $("#r-cat").onchange = () => { $("#r-cat").dataset.touched = "1"; };
    delete $("#r-cat").dataset.touched;
    $("#r-name").value = store.get("ab_req_name", "");
    $("#r-site").value = store.get("ab_req_site", "");
    $("#r-msg").textContent = ""; $("#r-msg").className = "req-msg";
    $("#r-send").disabled = false; $("#r-send").textContent = t("send");
    $("#req-sheet").hidden = false;
    setTimeout(() => $("#r-topic").focus(), 50);
  }
  async function sendRequest(e) {
    e.preventDefault();
    const topic = $("#r-topic").value.trim(), msg = $("#r-msg"), btn = $("#r-send");
    if (!topic) { $("#r-topic").focus(); return; }
    btn.disabled = true; btn.textContent = t("sending"); msg.textContent = "";
    const body = {
      topic, category: $("#r-cat").value, details: $("#r-details").value.trim(),
      name: $("#r-name").value.trim(), site: $("#r-site").value.trim(), lang: state.lang, website: $("#r-web").value
    };
    store.set("ab_req_name", body.name); store.set("ab_req_site", body.site);
    try {
      const r = await fetch(state.settings.requestUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      msg.textContent = "✓ " + t("reqThanks"); msg.className = "req-msg ok";
      btn.textContent = "✓";
      setTimeout(() => { closeSheets(); toast(t("reqThanks")); }, 1600);
    } catch (err) {
      msg.textContent = t("reqFail"); msg.className = "req-msg bad";
      btn.disabled = false; btn.textContent = t("send");
    }
  }

  /* ---------- learning paths ---------- */
  function pathStats(p) {
    const vids = pathVideos(p), n = vids.length, done = vids.filter(v => state.done.has(v.id)).length;
    const next = vids.find(v => !state.done.has(v.id)) || vids[0];
    return { vids, n, done, next };
  }
  function pathCard(p) {
    const { vids, n, done } = pathStats(p), x = pTr(p);
    const pct = n ? Math.round(done / n * 100) : 0;
    return `<a class="path-card" href="#/p/${encodeURIComponent(p.id)}">
      <div class="pc-top"><span class="pc-ico">${esc(p.icon || "🎓")}</span><div class="pc-thumbs">${vids.slice(0, 3).map(v => `<img loading="lazy" src="${thumb(v.yt)}" alt="">`).join("")}</div></div>
      <h3>${esc(x.title || p.title)}</h3>
      ${p.description ? `<p>${esc(x.description || p.description)}</p>` : ""}
      <div class="pc-bar"><i style="width:${pct}%"></i></div>
      <div class="pc-foot"><span>${esc(t("progress", { done, n }))}</span><span class="pc-go">${esc(done === n && n ? "✓ " + t("doneLabel") : done ? t("continuePath") : t("startPath"))}</span></div>
    </a>`;
  }
  function renderPath(p) {
    const { vids, n, done, next } = pathStats(p), x = pTr(p);
    const el = $("#video-view");
    const href = v => `#/v/${encodeURIComponent(v.id)}/p/${encodeURIComponent(p.id)}`;
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm vp-back" id="back">${ICON.back}<span>${esc(t("back"))}</span></button>
      <div class="path-head">
        <div class="ph-ico">${esc(p.icon || "🎓")}</div>
        <div><h1>${esc(x.title || p.title)}</h1>${x.title ? `<p class="en-title" lang="en" dir="ltr">${esc(p.title)}</p>` : ""}</div>
      </div>
      ${p.description ? `<p class="ph-desc">${esc(x.description || p.description)}</p>` : ""}
      <div class="pc-bar big"><i style="width:${n ? done / n * 100 : 0}%"></i></div>
      <p class="count">${esc(t("progress", { done, n }))}</p>
      ${next ? `<a class="btn btn-primary" style="width:100%;margin:6px 0 18px" href="${href(next)}">${ICON.play}<span>${esc(done === n ? t("startPath") : done ? t("continuePath") : t("startPath"))}</span></a>` : ""}
      <ol class="path-list">${vids.map((v, i) => `<li class="${state.done.has(v.id) ? "is-done" : ""}">
        <span class="pl-n">${state.done.has(v.id) ? "✓" : i + 1}</span>${mini(v, href(v))}</li>`).join("")}</ol>`;
    $("#back").onclick = () => { if (history.length > 1 && sessionStorage.getItem("ab_in_app")) history.back(); else location.hash = "#/"; };
  }

  /* ---------- rendering: video page ---------- */
  function translateUrl(v) {
    const text = [v.title, v.summary, v.safety ? "⚠ " + v.safety : "", (v.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n")].filter(Boolean).join("\n\n");
    return `https://translate.google.com/?sl=en&tl=${state.lang}&op=translate&text=${encodeURIComponent(text.slice(0, 4500))}`;
  }
  function renderVideo(v, path) {
    const x = tr(v);
    const steps = (x.steps && x.steps.length === v.steps.length) ? x.steps : v.steps;
    const ppe = (x.ppe && x.ppe.length === v.ppe.length) ? x.ppe : v.ppe;
    const hasAnyTr = state.lang !== "en" && v.tr && v.tr[state.lang];
    const langName = (LANGS.find(l => l.code === state.lang) || {}).name || "";
    const done = store.get("ab_steps_" + v.id, []);
    const on = state.saved.has(v.id);
    const related = state.videos.filter(o => o.id !== v.id && o.category === v.category)
      .sort((a, b) => (a.subject === v.subject ? -1 : 0) - (b.subject === v.subject ? -1 : 0)).slice(0, 4);
    let pathBar = "";
    if (path) {
      const pv = pathVideos(path), i = pv.findIndex(o => o.id === v.id), nx = pv[i + 1];
      pathBar = `<div class="path-ctx"><a href="#/p/${encodeURIComponent(path.id)}">${esc(path.icon || "🎓")} ${esc(pTr(path).title || path.title)} · ${i + 1}/${pv.length}</a>
        ${nx ? `<a class="btn btn-primary btn-sm" href="#/v/${encodeURIComponent(nx.id)}/p/${encodeURIComponent(path.id)}" id="path-next"><span>${esc(t("nextInPath"))}</span><span class="flip-r">${ICON.back}</span></a>` : ""}</div>`;
    }
    const el = $("#video-view");
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm vp-back" id="back">${ICON.back}<span>${esc(t("back"))}</span></button>
      ${steps.length ? `<div class="mode-tabs" role="tablist">
        <button role="tab" data-mode="video" aria-selected="true">${ICON.play}<span>${esc(t("tabVideo"))}</span></button>
        <button role="tab" data-mode="guide" aria-selected="false">${ICON.list}<span>${esc(t("tabGuide"))}</span></button>
      </div>` : ""}
      <div class="player" id="player"></div>
      <h1>${esc(x.title || v.title)}</h1>
      ${x.title ? `<p class="en-title" lang="en" dir="ltr">${esc(v.title)}</p>` : ""}
      <div class="meta">
        <span>${catIcon(v.category)} ${esc(catLabel(v.category))}</span>
        <span class="lvl lvl-${esc(v.level)}">${esc(t(v.level))}</span>
        ${v.duration ? `<span class="dot">${esc(v.duration)}</span>` : ""}
        ${v.channel ? `<span class="dot">${esc(v.channel)}</span>` : ""}
      </div>
      ${pathBar}
      <div class="actions">
        <button class="btn${state.done.has(v.id) ? " is-done" : ""}" id="v-done" aria-pressed="${state.done.has(v.id)}">${state.done.has(v.id) ? "✓" : "○"}<span>${esc(state.done.has(v.id) ? t("doneLabel") : t("markDone"))}</span></button>
        <button class="btn" id="v-save" aria-pressed="${on}">${on ? ICON.bookmarkOn : ICON.bookmark}<span>${esc(on ? t("savedLabel") : t("save"))}</span></button>
        <button class="btn" id="v-share">${ICON.share}<span>${esc(t("share"))}</span></button>
        <a class="btn" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.yt)}" target="_blank" rel="noopener">${ICON.yt}<span>${esc(t("watchOnYouTube"))}</span></a>
      </div>
      ${hasAnyTr ? `<div class="tr-note"><span>🌐 ${state.showEn ? "English" : esc(t("autoNote"))}</span><button class="btn btn-sm" id="tr-toggle">${state.showEn ? esc(langName) : "English"}</button></div>` : ""}
      ${state.lang !== "en" && !hasAnyTr ? `<a class="btn btn-primary" style="width:100%;margin:-6px 0 14px" href="${translateUrl(v)}" target="_blank" rel="noopener">${ICON.translate}<span>${esc(t("translate"))}</span></a>` : ""}
      ${v.safety || v.ppe.length ? `<section class="panel safety">
        <h2>${ICON.shield}${esc(t("safety"))}</h2>
        ${v.safety ? `<p>${esc(x.safety || v.safety)}</p>` : ""}
        ${ppe.length ? `<div class="ppe" aria-label="${esc(t("ppe"))}">${ppe.map(p => `<span>${esc(p)}</span>`).join("")}</div>` : ""}
      </section>` : ""}
      ${steps.length ? `<section class="panel">
        <h2>${ICON.list}${esc(t("steps"))}</h2>
        <p class="hint">${esc(t("stepsHint"))}</p>
        <div class="progress"><i id="prog"></i></div>
        <ol class="steps">${steps.map((s, i) => `<li><label><input type="checkbox" data-step="${i}" ${done.includes(i) ? "checked" : ""}><span class="num">${i + 1}</span><span>${esc(s)}</span></label></li>`).join("")}</ol>
      </section>` : ""}
      ${v.summary ? `<section class="panel"><h2>${ICON.info}${esc(t("about"))}</h2><p>${esc(x.summary || v.summary)}</p>
        ${state.lang !== "en" ? `<p class="subnote">${esc(t("subtitles"))}</p>` : ""}</section>` : ""}
      ${related.length ? `<div class="section-h" style="margin-top:22px"><h2>${esc(t("related"))}</h2></div><div class="mini-list">${related.map(mini).join("")}</div>` : ""}
    `;
    const updateProg = () => {
      const boxes = $$("[data-step]", el), n = boxes.filter(b => b.checked).length;
      const p = $("#prog"); if (p) p.style.width = (boxes.length ? (n / boxes.length) * 100 : 0) + "%";
    };
    updateProg();
    const player = $("#player");
    /* --- Video (default) --- */
    function showPoster() {
      stopSpeech();
      player.classList.remove("is-guide");
      player.innerHTML = `<button class="poster" id="poster" aria-label="${esc(t("play"))}"><img src="${thumb(v.yt, "hqdefault")}" alt=""><span class="play">${ICON.play}</span></button>`;
      $("#poster").onclick = () => {
        const hl = state.lang === "tl" ? "fil" : state.lang;
        const cc = state.lang !== "en" ? `&cc_load_policy=1&cc_lang_pref=${state.lang}` : "";
        const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.yt)}?autoplay=1&rel=0&playsinline=1&modestbranding=1&hl=${hl}${cc}`;
        player.innerHTML = `<iframe src="${src}" title="${esc(v.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
      };
    }
    /* --- Step guide (secondary): one step per screen, optional voice read-out --- */
    const hasTr = !!(x.steps && x.steps.length === v.steps.length);
    const slides = [];
    if (v.safety || v.ppe.length) slides.push({ safety: true, text: x.safety || v.safety, say: (hasTr ? x.safety : v.safety) || "" });
    steps.forEach((s, i) => slides.push({ n: i + 1, text: s, say: s }));
    let idx = 0, speaking = false;
    const canSpeak = "speechSynthesis" in window;
    const speechLang = hasTr ? state.lang : "en";
    const BCP = { en: "en-GB", hi: "hi-IN", ur: "ur-PK", ml: "ml-IN", bn: "bn-IN", ta: "ta-IN", ne: "ne-NP", tl: "fil-PH", ar: "ar-SA" };
    function speak() {
      if (!canSpeak) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance((slides[idx].n ? `${t("steps")} ${slides[idx].n}. ` : `${t("safety")}. `) + slides[idx].say);
      u.lang = BCP[speechLang] || "en-GB";
      const voice = speechSynthesis.getVoices().find(vo => vo.lang && vo.lang.toLowerCase().startsWith(speechLang === "tl" ? "fil" : speechLang));
      if (voice) u.voice = voice;
      u.rate = 0.95;
      u.onend = () => { if (!speaking) return; if (idx < slides.length - 1) { idx++; drawSlide(); speak(); } else { speaking = false; drawSlide(); } };
      speechSynthesis.speak(u);
    }
    function drawSlide() {
      const sl = slides[idx], last = slides.length - 1;
      player.classList.add("is-guide");
      player.innerHTML = `<div class="guide" ${hasTr || state.lang === "en" ? "" : 'lang="en" dir="ltr"'}>
        <div class="g-top"><span class="g-badge">${esc(t("tabGuide"))}</span><span class="g-count">${sl.n ? `${sl.n} / ${steps.length}` : esc(t("safety"))}</span></div>
        <div class="g-body ${sl.safety ? "g-safety" : ""}">
          ${sl.safety ? `<div class="g-ico">${ICON.shield}</div>` : `<div class="g-num">${sl.n}</div>`}
          <p>${esc(sl.text)}</p>
          ${sl.safety && ppe.length ? `<div class="ppe">${ppe.map(p => `<span>${esc(p)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="g-bar"><i style="width:${((idx + 1) / slides.length) * 100}%"></i></div>
        <div class="g-ctl">
          <button class="g-btn" data-g="prev" aria-label="Previous" ${idx === 0 ? "disabled" : ""}>${ICON.back}</button>
          ${canSpeak ? `<button class="g-btn g-listen" data-g="listen" aria-pressed="${speaking}">${speaking ? "⏹" : "🔊"} <span>${esc(speaking ? t("stop") : t("listen"))}</span></button>` : "<span></span>"}
          <button class="g-btn" data-g="next" aria-label="Next" ${idx === last ? "disabled" : ""}><span class="flip-r">${ICON.back}</span></button>
        </div>
      </div>`;
    }
    function stopSpeech() { speaking = false; if (canSpeak) speechSynthesis.cancel(); }
    player.addEventListener("click", e => {
      const g = e.target.closest("[data-g]"); if (!g) return;
      if (g.dataset.g === "listen") { speaking = !speaking; if (speaking) speak(); else stopSpeech(); drawSlide(); return; }
      idx = Math.max(0, Math.min(slides.length - 1, idx + (g.dataset.g === "next" ? 1 : -1)));
      drawSlide();
      if (speaking) speak();
    });
    let sx = null;
    player.addEventListener("touchstart", e => { if (player.classList.contains("is-guide")) sx = e.touches[0].clientX; }, { passive: true });
    player.addEventListener("touchend", e => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) < 50) return;
      const fwd = (document.documentElement.dir === "rtl") ? dx > 0 : dx < 0;
      idx = Math.max(0, Math.min(slides.length - 1, idx + (fwd ? 1 : -1)));
      drawSlide(); if (speaking) speak();
    });
    $$(".mode-tabs [data-mode]", el).forEach(b => b.onclick = () => {
      $$(".mode-tabs [data-mode]", el).forEach(o => o.setAttribute("aria-selected", o === b));
      if (b.dataset.mode === "guide") { idx = 0; drawSlide(); } else showPoster();
    });
    showPoster();
    const tt = $("#tr-toggle");
    if (tt) tt.onclick = () => { state.showEn = !state.showEn; renderVideo(v, path); };
    const drawDone = () => {
      const d = state.done.has(v.id), b = $("#v-done");
      b.setAttribute("aria-pressed", d); b.classList.toggle("is-done", d);
      b.innerHTML = `${d ? "✓" : "○"}<span>${esc(d ? t("doneLabel") : t("markDone"))}</span>`;
    };
    $("#v-done").onclick = () => { setDone(v.id, !state.done.has(v.id)); drawDone(); if (state.done.has(v.id)) toast(t("doneLabel") + " ✓"); };
    const pn = $("#path-next");
    if (pn) pn.addEventListener("click", () => { if (!state.done.has(v.id)) setDone(v.id, true); });
    $("#back").onclick = () => { if (history.length > 1 && sessionStorage.getItem("ab_in_app")) history.back(); else location.hash = "#/"; };
    $("#v-save").onclick = () => {
      toggleSave(v.id);
      const now = state.saved.has(v.id), b = $("#v-save");
      b.setAttribute("aria-pressed", now);
      b.innerHTML = `${now ? ICON.bookmarkOn : ICON.bookmark}<span>${esc(now ? t("savedLabel") : t("save"))}</span>`;
    };
    $("#v-share").onclick = () => share(v);
    el.addEventListener("change", e => {
      const b = e.target.closest("[data-step]"); if (!b) return;
      const ids = $$("[data-step]", el).filter(x => x.checked).map(x => +x.dataset.step);
      store.set("ab_steps_" + v.id, ids);
      updateProg();
      if (ids.length === steps.length && !state.done.has(v.id)) { setDone(v.id, true); drawDone(); toast(t("doneLabel") + " ✓"); }
    });
  }

  async function share(v) {
    const url = link(v);
    const text = `▶ ${titleOf(v)}\n${catLabel(v.category)} · ${t(v.level)}${v.duration ? " · " + v.duration : ""}`;
    if (navigator.share) { try { await navigator.share({ title: titleOf(v), text, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    window.open("https://wa.me/?text=" + encodeURIComponent(text + "\n" + url), "_blank", "noopener");
  }
  function toggleSave(id) {
    state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
    store.set("ab_saved", [...state.saved]);
    if (state.saved.has(id)) toast(t("savedLabel") + " ✓");
  }

  /* ---------- routing ---------- */
  function route() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    const h = location.hash.replace(/^#\/?/, "");
    const [kind, arg, k2, a2] = h.split("/");
    const lv = $("#list-view"), vv = $("#video-view");
    if (kind === "talk") {
      const k = arg ? state.talks.find(x => x.id === decodeURIComponent(arg)) : todayTalk();
      if (k) {
        if (!lv.hidden) state.listScroll = scrollY;
        lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
        renderTalk(k);
        scrollTo(0, 0);
        document.title = (kTr(k).title || k.title) + " · ABFM Training";
        return;
      }
    }
    if (kind === "p" && arg) {
      const p = state.paths.find(x => x.id === decodeURIComponent(arg));
      if (p) {
        if (!lv.hidden) state.listScroll = scrollY;
        lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
        renderPath(p);
        scrollTo(0, 0);
        document.title = (pTr(p).title || p.title) + " · ABFM Training";
        return;
      }
    }
    if (kind === "v" && arg) {
      const v = state.videos.find(x => x.id === decodeURIComponent(arg));
      if (v) {
        if (!lv.hidden) state.listScroll = scrollY;
        lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
        const path = k2 === "p" && a2 ? state.paths.find(x => x.id === decodeURIComponent(a2)) : null;
        renderVideo(v, path);
        scrollTo(0, 0);
        document.title = titleOf(v) + " · ABFM Training";
        return;
      }
    }
    const wasVideo = !vv.hidden;
    vv.hidden = true; vv.innerHTML = ""; lv.hidden = false; $("#search-wrap").hidden = false;
    const tab = ["new", "saved"].includes(kind) ? kind : "library";
    if (tab !== state.tab) { state.tab = tab; state.limit = PAGE; }
    document.title = "ABFM Training";
    renderList();
    if (wasVideo) requestAnimationFrame(() => scrollTo(0, state.listScroll));
  }

  /* ---------- events ---------- */
  function bind() {
    window.addEventListener("hashchange", () => { sessionStorage.setItem("ab_in_app", "1"); route(); });
    let qTimer;
    $("#q").addEventListener("input", e => {
      $("#q-clear").hidden = !e.target.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = e.target.value; state.limit = PAGE; renderList(); }, 150);
    });
    $("#q").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
    $("#q-clear").onclick = () => { $("#q").value = ""; $("#q-clear").hidden = true; state.q = ""; renderList(); $("#q").focus(); };
    $("#sort").onchange = e => { state.sort = e.target.value; renderList(); };
    $("#more").onclick = () => { state.limit += PAGE; renderList(); };

    document.addEventListener("click", e => {
      const save = e.target.closest("[data-save]");
      if (save) { e.preventDefault(); toggleSave(save.dataset.save); const on = state.saved.has(save.dataset.save); save.setAttribute("aria-pressed", on); save.innerHTML = on ? ICON.bookmarkOn : ICON.bookmark; if ($("#video-view").hidden && state.tab === "saved") renderList(); return; }
      const c = e.target.closest("[data-cat]");
      if (c) { state.cat = c.dataset.cat; state.limit = PAGE; renderList(); return; }
      const l = e.target.closest("[data-level]");
      if (l) { state.level = l.dataset.level; state.limit = PAGE; renderList(); return; }
      const tb = e.target.closest("[data-tab]");
      if (tb) { location.hash = tb.dataset.tab === "library" ? "#/" : "#/" + tb.dataset.tab; scrollTo(0, 0); return; }
      if (e.target.closest("#clear-all")) { state.cat = "ALL"; state.level = "ALL"; state.q = ""; $("#q").value = ""; $("#q-clear").hidden = true; renderList(); return; }
      const lg = e.target.closest("[data-lang]");
      if (lg) { state.showEn = false; state.lang = lg.dataset.lang; store.set("ab_lang", state.lang); closeSheets(); applyLang(); route(); return; }
      if (e.target.closest("[data-request]")) { openRequest(state.q); return; }
      if (e.target.closest("[data-close]") || e.target.classList.contains("sheet")) closeSheets();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
    $("#lang-btn").onclick = () => openSheet("#lang-sheet");
    $("#req-form").addEventListener("submit", sendRequest);

    const off = () => { const o = $("#offline"); o.hidden = navigator.onLine; o.textContent = "📶  " + t("offline"); };
    addEventListener("online", off); addEventListener("offline", off); off();
  }

  /* ---------- install as app ---------- */
  function setupInstall() {
    let deferred = null;
    const btn = $("#install-btn");
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return;
    addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; btn.hidden = false; });
    addEventListener("appinstalled", () => { btn.hidden = true; deferred = null; });
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (ios) btn.hidden = false;
    btn.onclick = async () => {
      if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; btn.hidden = true; }
      else if (ios) openSheet("#ios-sheet");
    };
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  /* ---------- start ---------- */
  const firstVisit = !state.lang;
  if (!state.lang) {
    const nav = (navigator.language || "en").slice(0, 2);
    state.lang = LANGS.some(l => l.code === nav) ? nav : "en";
  }
  applyLang();
  bind();
  setupInstall();
  load();
  if (firstVisit) { store.set("ab_lang", state.lang); openSheet("#lang-sheet"); }
})();
