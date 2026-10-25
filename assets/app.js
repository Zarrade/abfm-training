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
    listScroll: 0
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
  const tr = v => (v.tr && v.tr[state.lang]) || {};
  const titleOf = v => tr(v).title || v.title;
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
      const [vd, st, health] = await Promise.all([
        getJSON("data/videos.json"),
        getJSON("data/settings.json").catch(() => ({})),
        getJSON("data/health.json").catch(() => ({ problems: [] }))
      ]);
      Object.assign(state.settings, st);
      const dead = new Set((health.problems || []).filter(p => p.status === "notfound").map(p => p.yt));
      state.videos = (vd.videos || []).filter(v => v && v.yt && !v.hidden && !dead.has(v.yt))
        .map(v => Object.assign({ level: "Intermediate", ppe: [], steps: [], summary: "", safety: "" }, v));
      state.updated = vd.updated || "";
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
    if (s.tagline) $("#site-tag").textContent = s.tagline;
    const a = $("#announce");
    a.hidden = !s.announcement;
    a.textContent = s.announcement ? "📣  " + s.announcement : "";
    const n = state.videos.filter(isNew).length;
    const b = $("#new-badge"); b.hidden = !n; b.textContent = n > 99 ? "99+" : n;
  }

  /* ---------- filtering ---------- */
  function haystack(v) {
    const x = tr(v);
    return [v.title, v.summary, v.subject, v.channel, v.category, catLabel(v.category), (v.steps || []).join(" "), (v.ppe || []).join(" "), x.title, x.summary].join(" ").toLowerCase();
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
    return `<article class="card">
      <a class="card-link" href="#/v/${encodeURIComponent(v.id)}">
        <div class="thumb">
          <img loading="lazy" decoding="async" src="${thumb(v.yt)}" alt="" width="320" height="180">
          ${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}
          ${isNew(v) ? `<span class="tag-new">${esc(t("new"))}</span>` : ""}
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
  function mini(v) {
    return `<a class="mini" href="#/v/${encodeURIComponent(v.id)}">
      <div class="thumb"><img loading="lazy" src="${thumb(v.yt)}" alt="" width="320" height="180">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}</div>
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
        em.innerHTML = `<div class="big">🔍</div><h3>${esc(t("noResults"))}</h3><p>${esc(t("noResultsHint"))}</p><p><button class="btn" id="clear-all">${esc(t("clearFilters"))}</button></p>`;
      }
    }
    const s = state.settings;
    $("#foot").innerHTML = [state.updated ? esc(t("updated", { date: fmtDate(state.updated) })) : "", s.helpdesk ? esc(t("helpdesk")) + ": " + esc(s.helpdesk) : ""].filter(Boolean).join(" · ");
    $$("[data-tab]").forEach(b => b.toggleAttribute("aria-current", false));
    $$(`[data-tab="${state.tab}"]`).forEach(b => b.setAttribute("aria-current", "page"));
  }

  /* ---------- rendering: video page ---------- */
  function translateUrl(v) {
    const text = [v.title, v.summary, v.safety ? "⚠ " + v.safety : "", (v.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n")].filter(Boolean).join("\n\n");
    return `https://translate.google.com/?sl=en&tl=${state.lang}&op=translate&text=${encodeURIComponent(text.slice(0, 4500))}`;
  }
  function renderVideo(v) {
    const x = tr(v);
    const steps = (x.steps && x.steps.length === v.steps.length) ? x.steps : v.steps;
    const done = store.get("ab_steps_" + v.id, []);
    const on = state.saved.has(v.id);
    const related = state.videos.filter(o => o.id !== v.id && o.category === v.category)
      .sort((a, b) => (a.subject === v.subject ? -1 : 0) - (b.subject === v.subject ? -1 : 0)).slice(0, 4);
    const el = $("#video-view");
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm vp-back" id="back">${ICON.back}<span>${esc(t("back"))}</span></button>
      <div class="player" id="player">
        <button class="poster" id="poster" aria-label="${esc(t("play"))}">
          <img src="${thumb(v.yt, "hqdefault")}" alt="">
          <span class="play">${ICON.play}</span>
        </button>
      </div>
      <h1>${esc(x.title || v.title)}</h1>
      ${x.title ? `<p class="en-title" lang="en" dir="ltr">${esc(v.title)}</p>` : ""}
      <div class="meta">
        <span>${catIcon(v.category)} ${esc(catLabel(v.category))}</span>
        <span class="lvl lvl-${esc(v.level)}">${esc(t(v.level))}</span>
        ${v.duration ? `<span class="dot">${esc(v.duration)}</span>` : ""}
        ${v.channel ? `<span class="dot">${esc(v.channel)}</span>` : ""}
      </div>
      <div class="actions">
        <button class="btn" id="v-save" aria-pressed="${on}">${on ? ICON.bookmarkOn : ICON.bookmark}<span>${esc(on ? t("savedLabel") : t("save"))}</span></button>
        <button class="btn" id="v-share">${ICON.share}<span>${esc(t("share"))}</span></button>
        <a class="btn" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.yt)}" target="_blank" rel="noopener">${ICON.yt}<span>${esc(t("watchOnYouTube"))}</span></a>
      </div>
      ${state.lang !== "en" && !x.summary ? `<a class="btn btn-primary" style="width:100%;margin:-6px 0 14px" href="${translateUrl(v)}" target="_blank" rel="noopener">${ICON.translate}<span>${esc(t("translate"))}</span></a>` : ""}
      ${v.safety || v.ppe.length ? `<section class="panel safety">
        <h2>${ICON.shield}${esc(t("safety"))}</h2>
        ${v.safety ? `<p>${esc(x.safety || v.safety)}</p>` : ""}
        ${v.ppe.length ? `<div class="ppe" aria-label="${esc(t("ppe"))}">${v.ppe.map(p => `<span>${esc(p)}</span>`).join("")}</div>` : ""}
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
    $("#poster").onclick = () => {
      const hl = state.lang === "tl" ? "fil" : state.lang;
      const cc = state.lang !== "en" ? `&cc_load_policy=1&cc_lang_pref=${state.lang}` : "";
      const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.yt)}?autoplay=1&rel=0&playsinline=1&modestbranding=1&hl=${hl}${cc}`;
      $("#player").innerHTML = `<iframe src="${src}" title="${esc(v.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    };
    $("#back").onclick = () => { if (history.length > 1 && sessionStorage.getItem("ab_in_app")) history.back(); else location.hash = "#/"; };
    $("#v-save").onclick = () => { toggleSave(v.id); renderVideo(v); };
    $("#v-share").onclick = () => share(v);
    el.addEventListener("change", e => {
      const b = e.target.closest("[data-step]"); if (!b) return;
      const ids = $$("[data-step]", el).filter(x => x.checked).map(x => +x.dataset.step);
      store.set("ab_steps_" + v.id, ids);
      updateProg();
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
    const h = location.hash.replace(/^#\/?/, "");
    const [kind, arg] = h.split("/");
    const lv = $("#list-view"), vv = $("#video-view");
    if (kind === "v" && arg) {
      const v = state.videos.find(x => x.id === decodeURIComponent(arg));
      if (v) {
        if (!lv.hidden) state.listScroll = scrollY;
        lv.hidden = true; vv.hidden = false; $("#search-wrap").hidden = true;
        renderVideo(v);
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
      if (save) { e.preventDefault(); toggleSave(save.dataset.save); if (!$("#video-view").hidden) { const v = state.videos.find(x => x.id === location.hash.split("/").pop()); v && renderVideo(v); } else renderList(); return; }
      const c = e.target.closest("[data-cat]");
      if (c) { state.cat = c.dataset.cat; state.limit = PAGE; renderList(); return; }
      const l = e.target.closest("[data-level]");
      if (l) { state.level = l.dataset.level; state.limit = PAGE; renderList(); return; }
      const tb = e.target.closest("[data-tab]");
      if (tb) { location.hash = tb.dataset.tab === "library" ? "#/" : "#/" + tb.dataset.tab; scrollTo(0, 0); return; }
      if (e.target.closest("#clear-all")) { state.cat = "ALL"; state.level = "ALL"; state.q = ""; $("#q").value = ""; $("#q-clear").hidden = true; renderList(); return; }
      const lg = e.target.closest("[data-lang]");
      if (lg) { state.lang = lg.dataset.lang; store.set("ab_lang", state.lang); closeSheets(); applyLang(); route(); return; }
      if (e.target.closest("[data-close]") || e.target.classList.contains("sheet")) closeSheets();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
    $("#lang-btn").onclick = () => openSheet("#lang-sheet");

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
