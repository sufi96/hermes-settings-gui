/* Hermes Settings Panel — simple, explicit, save-button driven */
"use strict";

/* ---------------- token ---------------- */
const TOKEN = new URLSearchParams(location.search).get("token") || "";

/* ---------------- api ---------------- */
async function api(path, opts = {}) {
  const init = { headers: { "X-Config-Token": TOKEN } };
  if (opts.body !== undefined) {
    init.method = "POST";
    init.body = JSON.stringify(opts.body);
    init.headers["Content-Type"] = "application/json";
  }
  const r = await fetch(path, init);
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401) {
    showFatal("Access token missing or wrong. Close this tab, run start.bat again, and open the new address it prints.");
    throw new Error("unauthorized");
  }
  if (!r.ok) {
    data.ok = false;
    if (!data.message && data.error) data.message = data.error;
    if (!data.message) data.message = `HTTP ${r.status}: ${r.statusText || "Request failed"}`;
  }
  return data;
}

function showFatal(msg) {
  const page = document.getElementById("page");
  if (page) page.innerHTML = '<div class="note">' + esc(msg) + "</div>";
}

/* ---------------- toasts ---------------- */
function toast(msg, kind = "", ms = 4500) {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "toast " + kind;
  let icon = "ℹ️ ";
  if (kind === "ok") icon = "✓ ";
  else if (kind === "err") icon = "✗ ";
  else if (kind === "warn") icon = "⚠️ ";
  el.textContent = (msg.startsWith("✓") || msg.startsWith("✗") || msg.startsWith("⚠") || msg.startsWith("ℹ️")) ? msg : icon + msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    el.style.transition = "all 0.2s ease";
    setTimeout(() => el.remove(), 220);
  }, ms);
}

function setSaved(text, cls) {
  const si = document.getElementById("save-indicator");
  if (si) {
    si.className = cls;
    const dot = si.querySelector(".status-dot") || el("span", { class: "status-dot" }, "●");
    const txt = si.querySelector(".status-text") || el("span", { class: "status-text" }, text);
    txt.textContent = text.replace(/^[✓✗●]\s*/, "");
    si.replaceChildren(dot, txt);
  }
  const mdot = document.getElementById("mobile-save-dot");
  if (mdot) {
    mdot.className = cls;
    mdot.title = text;
  }
}

/* ---------------- state ---------------- */
let STATE = null;
async function loadState() {
  setSaved("Loading…", "saving");
  try {
    STATE = await api("/api/state");
    setSaved("All changes saved", "saved");
    updateDeckStatus();
  } catch (e) {
    setSaved("Connection problem", "error");
  }
  return STATE;
}

function updateDeckStatus() {
  const ds = document.getElementById("deck-status");
  if (!ds) return;
  const h = STATE?.system_health;
  if (!h) return;

  if (h.all_met) {
    ds.className = "deck-tag ready";
    ds.textContent = "● Engine Ready";
    ds.title = "System requirements: All 6 checks met (Click to inspect)";
  } else if (!h.hermes_installed) {
    ds.className = "deck-tag missing";
    ds.textContent = "● Hermes Missing";
    ds.title = "Hermes Agent CLI is not installed on this machine (Click for guide)";
  } else {
    ds.className = "deck-tag";
    ds.textContent = "● Needs Setup";
    ds.title = "Some components need attention (Click to inspect)";
  }
  ds.onclick = () => openSystemHealthModal();
}

function openSystemHealthModal() {
  const h = STATE?.system_health || {
    checks: [
      { name: "Python Environment", num: 1, ok: true, status: "ok", title: "Python Ready", detail: "Active runtime", help: "" },
      { name: "Dependencies (PyYAML)", num: 2, ok: true, status: "ok", title: "PyYAML Ready", detail: "Installed", help: "" },
      { name: "Hermes Agent CLI", num: 3, ok: false, status: "err", title: "Not installed", detail: "Executable not found", help: "Install Hermes Agent on this machine." }
    ],
    all_met: false,
    hermes_installed: false
  };

  openModal("🖥️ System Pre-Flight & Portability Check", (body, actions) => {
    const listEl = el("div", { class: "req-checklist" });

    (h.checks || []).forEach(ch => {
      const icon = ch.ok ? "✓" : (ch.status === "warn" ? "!" : "✗");
      const badgeText = ch.title || (ch.ok ? "Good" : "Missing");

      const itemEl = el("div", { class: `req-item ${ch.status}` },
        el("div", { class: "req-icon" }, icon),
        el("div", { class: "req-info" },
          el("div", { class: "req-header" },
            el("span", { class: "req-name" }, ch.name),
            el("span", { class: "req-badge" }, badgeText)
          ),
          ch.detail ? el("div", { class: "req-detail" }, ch.detail) : null,
          ch.help && !ch.ok ? el("div", { class: "req-help" }, ch.help) : null
        )
      );
      listEl.append(itemEl);
    });

    const guideBox = el("div", { class: "card", style: "margin-top:14px;padding:14px 16px;background:var(--bg-subtle);border-radius:8px;" },
      el("div", { style: "font-weight:700;font-size:13.5px;margin-bottom:6px;display:flex;align-items:center;gap:6px;" },
        "📦 Carrying this system in a folder across machines:"
      ),
      el("ol", { style: "margin:0;padding-left:20px;font-size:12.5px;line-height:1.6;color:var(--muted);" },
        el("li", {}, "Copy this entire ", el("b", {}, "hermes-gui-web"), " folder to your USB drive or other computer."),
        el("li", {}, "Double-click ", el("code", { class: "badge info" }, "start.bat"), " — it automatically checks Python and installs missing dependencies."),
        el("li", {}, "If Hermes Agent is installed on that machine, everything activates instantly. If not, the GUI opens in setup mode so you can view settings and restore backups.")
      )
    );

    body.append(
      el("p", { class: "dim small", style: "margin-bottom:10px;" },
        h.hermes_installed
          ? "All prerequisites are satisfied. Your local machine is fully configured to execute Hermes agent tasks."
          : "Pre-flight check result: Hermes Agent CLI is not detected on this machine. The GUI is running in portable setup mode."
      ),
      listEl,
      guideBox
    );

    actions.append(
      el("button", { onclick: closeModal }, "Close"),
      el("button", {
        class: "primary",
        onclick: async () => {
          const r = await api("/api/backup", { body: {} });
          if (r.ok) toast("Backup created ✓ (" + (r.path || "") + ")", "ok", 4000);
          else toast("Backup failed: " + r.message, "err");
        }
      }, "💾 Create Portability Backup")
    );
  });
}

/* ---------------- helpers ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;   // only used with trusted content
    else if (k.startsWith("on")) n[k] = v;
    else if (k === "value") n.value = v ?? "";
    else if (k === "checked") n.checked = !!v;
    else if (k === "disabled") n.disabled = !!v;
    else if (k === "hidden") n.hidden = !!v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

/* Save button factory — the ONLY way anything is written. */
function saveBtn(getDirty, doSave, label = "Save changes") {
  const status = el("span", { class: "status" });
  const btn = el("button", { class: "primary", onclick: async () => {
    btn.disabled = true;
    status.textContent = "Saving…";
    setSaved("Saving…", "saving");
    try {
      const r = await doSave();
      if (r && r.ok === false) {
        status.textContent = "";
        toast("Could not save: " + (r.message || "unknown error"), "err", 7000);
        setSaved("✗ Save failed", "error");
      } else {
        status.textContent = "Saved ✓";
        setTimeout(() => status.textContent = "", 2500);
        setSaved("✓ All changes saved", "saved");
      }
    } catch (e) {
      status.textContent = "";
      toast("Error: " + e.message, "err", 7000);
      setSaved("✗ Save failed", "error");
    } finally {
      btn.disabled = false;
    }
  } }, label);
  return { btn, status };
}

function field(labelText, input, hint) {
  const f = el("div", { class: "field" });
  f.append(el("label", {}, labelText));
  f.append(input);
  if (hint) f.append(el("div", { class: "hint" }, hint));
  return f;
}
function settingToggle(label, desc, checked, onChange) {
  const tgl = el("label", { class: "tgl" });
  const inp = el("input", { type: "checkbox", checked });
  inp.onchange = () => onChange(inp.checked);
  tgl.append(inp, el("span", { class: "knob" }));
  const left = el("div", {},
    el("div", { class: "s-label" }, label),
    el("div", { class: "s-desc" }, desc));
  return el("div", { class: "setting-row" }, left, tgl);
}
function card(title, sub, ...children) {
  const c = el("div", { class: "card" });
  c.append(el("h2", {}, title));
  if (sub) c.append(el("p", { class: "card-sub" }, sub));
  c.append(...children);
  return c;
}

/* models cache for the datalist */
function modelsFor(provider) {
  if (!provider) return [];
  const cp = (STATE.custom_providers || []).find(p => p.name === provider);
  if (cp && cp.models && cp.models.length) return cp.models;
  const mc = (STATE.model_cache || {})[provider];
  return mc || [];
}

const KNOWN_PROVIDERS = [
  "openrouter", "anthropic", "openai", "nous", "gemini", "xai", "deepseek", "zai",
  "groq", "mistral", "together", "minimax", "minimax-cn", "kimi-coding", "alibaba", "xiaomi", "huggingface",
  "fireworks", "novita", "nvidia", "deepinfra", "gmi", "arcee", "stepfun",
  "upstage", "ollama", "ollama-cloud", "copilot", "custom",
];
function providerNames(extra = "") {
  const custom = (STATE?.custom_providers || []).map(p => p.name).filter(Boolean);
  const std = (STATE?.standard_providers || []).map(p => p.name).filter(Boolean);
  const builtin = typeof BUILTIN_PROVIDERS_INFO !== "undefined" ? BUILTIN_PROVIDERS_INFO.map(p => p.name) : [];
  const set = new Set([...KNOWN_PROVIDERS, ...builtin, ...std, ...custom]);
  if (extra) set.add(extra);
  if (STATE?.fallback_chain) {
    STATE.fallback_chain.forEach(f => { if (f && f.provider) set.add(f.provider); });
  }
  if (STATE?.model?.provider) set.add(STATE.model.provider);
  return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/* ================================================================
   INLINE TEST RESULT CARD HELPER
================================================================ */
function renderTestResultCard(container, { state, model, provider, reply, error, keyEnv }) {
  if (!container) return;
  container.replaceChildren();

  if (state === "loading") {
    const cardEl = el("div", { class: "model-test-card loading" },
      el("div", { class: "mtc-spinner" }),
      el("div", {},
        el("div", { style: "font-weight:650;font-size:13px" }, `Testing Model Response…`),
        el("div", { class: "dim small", style: "margin-top:2px" }, `Sending prompt to “${model || "selected model"}” via ${provider || "server"}. Please wait…`)
      )
    );
    container.append(cardEl);
    return;
  }

  if (state === "ok") {
    const cardEl = el("div", { class: "model-test-card ok" });
    const head = el("div", { class: "mtc-head" },
      el("div", { class: "mtc-title" },
        el("span", {}, "✓ Model Test Passed"),
        model ? el("span", { class: "mtc-model-tag" }, model) : null
      ),
      el("button", { type: "button", class: "mtc-close", title: "Dismiss", onclick: () => container.replaceChildren() }, "✕")
    );

    const body = el("div", { class: "mtc-body" },
      el("div", { style: "font-weight:650;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--green);margin-bottom:4px" }, "Model Response:"),
      el("div", { class: "mtc-reply" }, reply || "(Empty response received)")
    );

    const timeStr = new Date().toLocaleTimeString();
    const meta = el("div", { class: "mtc-meta" },
      el("span", {}, `🔌 Provider: ${provider || "default"}`),
      keyEnv ? el("span", {}, `🔑 Key: ${keyEnv}`) : null,
      el("span", {}, `⏱ Tested at ${timeStr}`)
    );

    cardEl.append(head, body, meta);
    container.append(cardEl);
    return;
  }

  if (state === "err") {
    const cardEl = el("div", { class: "model-test-card err" });
    const head = el("div", { class: "mtc-head" },
      el("div", { class: "mtc-title" },
        el("span", {}, "✗ Model Test Failed"),
        model ? el("span", { class: "mtc-model-tag" }, model) : null
      ),
      el("button", { type: "button", class: "mtc-close", title: "Dismiss", onclick: () => container.replaceChildren() }, "✕")
    );

    const body = el("div", { class: "mtc-body" },
      el("div", { style: "font-weight:600;margin-bottom:4px;color:var(--red)" }, error || "The server rejected the test message."),
      el("div", { class: "dim small", style: "line-height:1.4" },
        "Tip: Check that the API key is set in .env, verify your base URL or quota, and confirm the model identifier is spelled correctly."
      )
    );

    const timeStr = new Date().toLocaleTimeString();
    const meta = el("div", { class: "mtc-meta" },
      el("span", {}, `🔌 Provider: ${provider || "default"}`),
      keyEnv ? el("span", {}, `🔑 Required Key: ${keyEnv}`) : null,
      el("span", {}, `⏱ Tested at ${timeStr}`)
    );

    cardEl.append(head, body, meta);
    container.append(cardEl);
    return;
  }
}

/* ================================================================
   MODEL PICKER — text input + "Find models" (live fetch) + a
   SEARCHABLE dropdown (filter matches anywhere in the model name,
   not just the start) + "Test model". Manual typing always works.
================================================================ */
let _mpSeq = 0;
function modelPicker({ value = "", placeholder = "", initialModels = [], getProvider, keyEnv, onApiKey }) {
  const id = "mp" + (++_mpSeq);
  let allModels = (initialModels || []).slice();
  let liveFetched = false;
  let filtered = allModels.slice();
  let activeIdx = -1;

  const dl = el("datalist", { id: "dl-" + id },
    allModels.map(m => el("option", { value: m })));
  const input = el("input", { type: "text", value, placeholder: placeholder || "model id — type it, or press Find models" });
  input.setAttribute("list", "dl-" + id);

  /* ---- searchable dropdown panel ---- */
  const search = el("input", { type: "text", placeholder: "Type to filter — matches anywhere in the name (e.g. glm, sonnet, free)" });
  const list = el("div", { class: "mpd-list" });
  const countLabel = el("div", { class: "mpd-count" });
  const panel = el("div", { class: "mpd", hidden: true }, search, list, countLabel);

  function matches(q, m) {
    if (!q) return true;
    const mm = m.toLowerCase();
    return q.toLowerCase().split(/\s+/).every(w => mm.includes(w));  // every word must appear somewhere
  }
  function renderList() {
    filtered = allModels.filter(m => matches(search.value.trim(), m));
    list.replaceChildren();
    if (!filtered.length) {
      list.append(el("div", { class: "mpd-empty" },
        allModels.length ? "No models match “" + search.value + "”." : "No models yet — press 🔍 Find models first."));
    } else {
      filtered.forEach(m => {
        const isSel = m === input.value;
        const item = el("button", { type: "button", class: "mpd-item" + (isSel ? " sel" : ""), onclick: () => {
          choose(m);
        } }, m);
        list.append(item);
      });
    }
    countLabel.textContent = allModels.length
      ? (filtered.length === allModels.length
          ? filtered.length + " models"
          : filtered.length + " of " + allModels.length + " models")
      : "";
    activeIdx = -1;
  }
  function choose(m) {
    input.value = m;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    panel.hidden = true;
  }
  function openPanel() {
    panel.hidden = false;
    search.value = "";
    renderList();
    setTimeout(() => search.focus(), 30);
  }
  search.oninput = renderList;
  search.onkeydown = (e) => {
    const items = list.querySelectorAll(".mpd-item");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      activeIdx = e.key === "ArrowDown"
        ? Math.min(activeIdx + 1, items.length - 1)
        : Math.max(activeIdx - 1, 0);
      items.forEach((it, i) => it.classList.toggle("active", i === activeIdx));
      items[activeIdx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[activeIdx >= 0 ? activeIdx : 0];
      if (pick) choose(pick);
    } else if (e.key === "Escape") {
      panel.hidden = true;
    }
  };
  // click outside closes the panel
  document.addEventListener("click", (e) => {
    if (panel.hidden) return;
    if (!panel.contains(e.target) && e.target !== input && !dropBtn.contains(e.target)) panel.hidden = true;
  });

  const dropBtn = el("button", { class: "mp-btn mp-drop-btn", onclick: () => { panel.hidden ? openPanel() : (panel.hidden = true); } }, "▾");
  dropBtn.title = "Open the searchable model list";

  const inputRow = el("div", { class: "mp-input-row" }, input, dropBtn);

  const status = el("div", { class: "mp-status", hidden: true });
  const testCard = el("div", { class: "model-test-card-wrap" });

  const findBtn = el("button", { class: "mp-btn", onclick: findModels }, "🔍 Find models");
  findBtn.title = "Test the connection and load this provider's model list";

  const testBtn = el("button", { class: "mp-btn", onclick: testModel }, "✉ Test model");
  testBtn.title = "Send a tiny test message to the model in the box to check it really answers";

  const speedBtn = el("button", { class: "mp-btn", onclick: testSpeed }, "⚡ Benchmark speed");
  speedBtn.title = "Benchmark inference speed (Tokens Per Second, TTFT latency, duration, tokens, rate limits)";

  let apiKeyBtn = null;
  const targetKey = keyEnv || (typeof getProvider === "function" ? getProvider()?.keyEnv : null);
  if (targetKey || onApiKey) {
    apiKeyBtn = el("button", {
      type: "button",
      class: "mp-btn",
      onclick: () => {
        if (typeof onApiKey === "function") onApiKey();
        else if (targetKey) askEnvValue(targetKey);
      }
    }, "🔑 API Key");
    apiKeyBtn.title = "View, copy or change provider API key";
  }

  const actionsRow = el("div", { class: "mp-actions-row" }, findBtn, testBtn, speedBtn, apiKeyBtn);

  async function findModels() {
    const p = (typeof getProvider === "function" ? getProvider() : null) || {};
    status.hidden = false;
    status.className = "mp-status dim";
    status.textContent = "Connecting to " + (p.provider || "the server") + "…";
    findBtn.disabled = true;
    try {
      const r = await api("/api/probe/provider", { body: { provider: p.provider || "", base_url: p.base_url || "" } });
      if (r.ok) {
        liveFetched = true;
        allModels = r.models.slice();
        status.className = "mp-status ok";
        const keyNote = r.key_needed
          ? (r.key_found ? " — key found (" + r.key_env + ")" : " — no key in .env (set it in API Keys if this server needs one)")
          : " — no key needed";
        status.textContent = "✓ Connected — " + r.count + " models found" + keyNote;
        dl.replaceChildren(...allModels.map(m => el("option", { value: m })));
        openPanel();  // open the searchable list right away
      } else {
        status.className = "mp-status err";
        status.textContent = "✗ " + (r.message || "couldn't connect");
      }
    } catch (e) {
      status.className = "mp-status err";
      status.textContent = "✗ " + e.message;
    } finally {
      findBtn.disabled = false;
    }
  }

  async function testModel() {
    const p = (typeof getProvider === "function" ? getProvider() : null) || {};
    const model = input.value.trim();
    if (!model) {
      renderTestResultCard(testCard, {
        state: "err",
        model: "",
        provider: p.provider,
        error: "Type or pick a model first before testing."
      });
      return;
    }
    testBtn.disabled = true;
    renderTestResultCard(testCard, {
      state: "loading",
      model,
      provider: p.provider
    });
    try {
      const r = await api("/api/probe/provider", { body: { provider: p.provider || "", base_url: p.base_url || "", model, test_chat: true } });
      if (r.ok && r.chat_ok) {
        renderTestResultCard(testCard, {
          state: "ok",
          model,
          provider: p.provider,
          reply: r.chat,
          keyEnv: r.key_env
        });
      } else if (r.ok) {
        renderTestResultCard(testCard, {
          state: "err",
          model,
          provider: p.provider,
          error: r.chat || "Connected, but the test message failed.",
          keyEnv: r.key_env
        });
      } else {
        renderTestResultCard(testCard, {
          state: "err",
          model,
          provider: p.provider,
          error: r.message || "Test failed.",
          keyEnv: r.key_env
        });
      }
    } catch (e) {
      renderTestResultCard(testCard, {
        state: "err",
        model,
        provider: p.provider,
        error: e.message
      });
    } finally {
      testBtn.disabled = false;
    }
  }

  async function testSpeed() {
    const p = (typeof getProvider === "function" ? getProvider() : null) || {};
    const model = input.value.trim();
    if (!model) { toast("Type or pick a model first", "err"); return; }
    openSpeedBenchmarkModal(p.provider || "", p.base_url || "", model, "standard");
  }

  const root = el("div", { class: "mp" },
    dl,
    panel,
    inputRow,
    actionsRow,
    status,
    testCard
  );

  return {
    root, input, panel,
    setSuggestions(list2) {
      if (!liveFetched) {
        allModels = (list2 || []).slice();
        dl.replaceChildren(...allModels.map(m => el("option", { value: m })));
      }
    },
  };
}

/* ================================================================
   PAGES
================================================================ */
const PAGES = {};
let currentPage = null;

function closeMobileMenu() {
  const menu = document.getElementById("menu");
  const backdrop = document.getElementById("menu-backdrop");
  if (menu) menu.classList.remove("open");
  if (backdrop) backdrop.classList.remove("open");
}

function showPage(name) {
  currentPage = name;
  document.querySelectorAll(".menu-item").forEach(b =>
    b.classList.toggle("active", b.dataset.page === name));
  
  closeMobileMenu();

  const page = document.getElementById("page");
  if (!page) return;
  page.classList.toggle("home-page", name === "home");
  page.classList.toggle("chat-page", name === "chat");
  page.classList.toggle("providers-page", name === "providers");
  page.classList.toggle("wide-page", name === "home" || name === "providers" || name === "chat" || name === "tools");
  page.replaceChildren(el("div", { class: "loading" }, "Loading…"));
  if (PAGES[name]) {
    PAGES[name](page);
  }
}

/* ---------------- dashboard helpers ---------------- */
function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function timeAgoStr(ts) {
  if (!ts) return "";
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

window.resumeSessionFromHome = async function(sid) {
  CHAT.session_id = sid;
  showPage("chat");
};

/* ---------------- HOME (EXECUTIVE SUMMARY & FEATURE SHORTCUTS) ---------------- */
PAGES.home = async function (page) {
  await loadState();
  let overview = null;
  try {
    overview = await api("/api/dashboard/overview");
  } catch {}
  overview = overview || {};
  const recents = overview.recent_sessions || [];
  const tot = overview.totals || {};
  const mem = overview.memory || {};
  const skills = overview.skills || {};
  const m = STATE.model || {};
  const fb = STATE.fallback_chain || [];
  const keysSet = (STATE.env_entries || []).filter(e => e.set && /KEY|TOKEN|SECRET|PASSWORD/i.test(e.key)).length;
  const customCount = (STATE.custom_providers || []).length;
  const totalProviders = 27 + customCount;

  // 1. REAL-TIME STATS & STATUS BAR
  const statsBar = el("div", { class: "home-stats-bar" });
  const statBox = (icon, label, value, sub, accent, isHero = false, onClick = null) => {
    const box = el("div", {
      class: "stat" + (isHero ? " stat-hero" : ""),
      onclick: onClick,
      style: onClick ? "cursor:pointer" : ""
    },
      el("div", { style: "display:flex;align-items:center;justify-content:space-between;" },
        el("div", { class: "k" }, icon + " " + label),
        isHero ? el("span", { class: "badge standard", style: "font-size:10px;padding:2px 7px;background:var(--gold-soft);color:var(--gold-text);border-color:var(--gold-border);font-weight:700;" }, "PRIMARY ENGINE") : null
      ),
      el("div", { class: "v" + (accent ? " accent" : "") }, value),
      sub ? el("div", { class: "dim small", style: "margin-top:4px;display:flex;align-items:center;justify-content:space-between;" },
        el("span", {}, sub),
        isHero ? el("span", { style: "color:var(--gold-text);font-weight:600;font-size:11px;" }, "Configure →") : null
      ) : null
    );
    return box;
  };

  statsBar.append(
    statBox("🤖", "Main AI Model", m.default || "(none)", `via ${m.provider || "openrouter"}`, true, true, () => showPage("model")),
    statBox("🛟", "Failover Backups", `${fb.length} armed`, fb.length ? "Auto failover active" : "No fallback set", false, false, () => showPage("fallback")),
    statBox("🔑", "Saved API Keys", `${keysSet} configured`, "Stored in .env", false, false, () => showPage("keys")),
    statBox("🔌", "AI Providers", `${totalProviders} connected`, `27 built-in + ${customCount} custom`, false, false, () => showPage("providers")),
    statBox("🛠️", "Capabilities", "26 tools", "Full agent permissions", false, false, () => showPage("tools"))
  );

  // 2. FEATURE HUB CARDS
  const featureGrid = el("div", { class: "home-feature-grid" });

  const makeFeatureCard = ({ icon, title, badge, desc, status, actionText, onAction }) => {
    const cardEl = el("div", { class: "feature-card", onclick: onAction });

    const top = el("div", { class: "feature-card-top" },
      el("div", { class: "feature-card-title" },
        el("div", { class: "feature-card-icon" }, icon),
        el("span", {}, title)
      ),
      badge ? el("span", { class: "badge standard" }, badge) : null
    );

    const descEl = el("div", { class: "feature-card-desc" }, desc);
    const statusEl = status ? el("div", { class: "feature-card-status" },
      el("span", { class: "dim" }, "Current status:"),
      el("span", { style: "font-weight:600" }, status)
    ) : null;

    const foot = el("div", { class: "feature-card-foot" },
      el("span", { class: "feature-card-action" }, actionText || "Open Feature →"),
      el("span", { style: "font-size:16px;color:var(--gold)" }, "→")
    );

    cardEl.append(top, descEl, statusEl, foot);
    return cardEl;
  };

  featureGrid.append(
    makeFeatureCard({
      icon: "💬",
      title: "Interactive Agent Chat",
      badge: "Core Deck",
      desc: "Converse in real-time with the full Hermes agent. Executes terminal tools, reads codebases, leverages memory, and retains conversation history.",
      status: `Active Engine: ${m.default ? m.default.split("/").pop() : "None"}`,
      actionText: "Open Web Chat",
      onAction: () => showPage("chat")
    }),
    makeFeatureCard({
      icon: "🤖",
      title: "Main AI & Diagnostics",
      badge: "Engine",
      desc: "Configure primary model, provider endpoints, token context window limits, model speed benchmarking, and system doctor diagnostics.",
      status: `${m.provider || "openrouter"} (${m.default || "unconfigured"})`,
      actionText: "Configure Main AI",
      onAction: () => showPage("model")
    }),
    makeFeatureCard({
      icon: "🛟",
      title: "Backup Models (Failover)",
      badge: "Fault Tolerance",
      desc: "Automatic failover chain. If your primary AI hits rate limits or server downtime, Hermes seamlessly falls back down this priority list.",
      status: fb.length ? `${fb.length} backup model(s) armed` : "No backups — Hermes will stop on error",
      actionText: "Configure Failover Chain",
      onAction: () => showPage("fallback")
    }),
    makeFeatureCard({
      icon: "🔑",
      title: "API Keys & Security Vault",
      badge: "Credentials",
      desc: "Securely store and manage API keys for OpenRouter, OpenAI, Anthropic, Gemini, Groq, DeepSeek, xAI, and custom servers in .env.",
      status: `${keysSet} secret key(s) safely stored`,
      actionText: "Manage Credentials",
      onAction: () => showPage("keys")
    }),
    makeFeatureCard({
      icon: "🔌",
      title: "Providers & Custom Endpoints",
      badge: "Platforms",
      desc: "Browse 27 built-in official AI platforms, local Ollama runner, or connect custom OpenAI-compatible proxies (TokenRouter, vLLM, LM Studio).",
      status: `27 Built-in + ${customCount} Custom`,
      actionText: "Explore Provider Grid",
      onAction: () => showPage("providers")
    }),
    makeFeatureCard({
      icon: "🛠️",
      title: "Agent Tools & Capabilities",
      badge: "Permissions",
      desc: "Granular capability controls across web search, headless browser automation, bash terminal execution, file system access, and code runners.",
      status: "26 agent tool capabilities supported",
      actionText: "Configure Agent Tools",
      onAction: () => showPage("tools")
    }),
    makeFeatureCard({
      icon: "⚙️",
      title: "Agent Settings & Raw YAML",
      badge: "Deck",
      desc: "Fine-tune autonomous agent behavior flags, logging levels, safety permissions, and view or export the raw config.yaml manifest.",
      status: "config.yaml verified",
      actionText: "Open Settings Deck",
      onAction: () => showPage("config")
    }),
    makeFeatureCard({
      icon: "💻",
      title: "Terminal & CLI Bridge",
      badge: "Shell",
      desc: "Browser-based command shell to run raw hermes CLI subcommands, skills, and background daemon tasks directly in your workspace.",
      status: "Hermes CLI binary linked",
      actionText: "Launch Terminal",
      onAction: () => showPage("terminal")
    }),
    makeFeatureCard({
      icon: "🎨",
      title: "Display & Voice Interface",
      badge: "Appearance",
      desc: "Switch between modern Light and Dark color themes, customize interface spacing, and configure speech/voice synthesis output.",
      status: `Current Theme: ${localStorage.getItem("hermes-theme") || "light"}`,
      actionText: "Customize Display",
      onAction: () => showPage("display")
    }),
    makeFeatureCard({
      icon: "🩺",
      title: "Hermes Doctor Diagnostics",
      badge: "Health Scan",
      desc: "Run an automated diagnostic check across Python runtime, SQLite state database, token files, and active network connections.",
      status: "One-click health inspection",
      actionText: "Run Health Scan Now",
      onAction: async (e) => {
        e?.stopPropagation();
        toast("Running hermes doctor…");
        const r = await api("/api/doctor");
        openModal("Hermes Doctor Health Scan Report", r.stdout || r.stderr || "(no output)");
      }
    }),
    makeFeatureCard({
      icon: "💾",
      title: "State & Config Backup",
      badge: "Archive",
      desc: "Create an instant timestamped archive of your full configuration, credentials, and custom endpoint definitions.",
      status: "Zero-data-loss snapshots",
      actionText: "Create Full Backup",
      onAction: async (e) => {
        e?.stopPropagation();
        const r = await api("/api/backup", { body: {} });
        if (r.ok) toast("Backup created successfully ✓ " + (r.stdout ? "\n" + r.stdout.split("\n")[0] : ""), "ok", 7000);
        else toast("Backup failed: " + r.message, "err", 7000);
      }
    }),
    makeFeatureCard({
      icon: "🖥️",
      title: "System Pre-Flight & Portability",
      badge: STATE?.system_health?.hermes_installed ? "Ready" : "Missing",
      desc: "Pre-flight checklist verifying Python runtime, PyYAML, Hermes CLI installation, and portability when carrying this system across machines.",
      status: STATE?.system_health?.hermes_installed ? "All 6 Prerequisites Met" : "Hermes Agent CLI Missing",
      actionText: "Check Requirements",
      onAction: (e) => {
        e?.stopPropagation();
        openSystemHealthModal();
      }
    }),
  );

  // 3. QUICK COMMANDS BAR
  const quickBar = el("div", { class: "btnrow", style: "margin-top:10px;flex-wrap:wrap" },
    el("button", { class: "primary", onclick: () => showPage("chat") }, "💬 Start Chat"),
    el("button", { onclick: () => openSpeedBenchmarkModal(m.provider, m.base_url, m.default) }, "⚡ Benchmark TPS & Latency"),
    el("button", { onclick: () => showPage("model") }, "🤖 Main AI Engine"),
    el("button", { onclick: () => showPage("providers") }, "🔌 Providers"),
    el("button", { onclick: () => showPage("tools") }, "🛠️ Agent Tools"),
    el("button", { onclick: () => showPage("keys") }, "🔑 API Keys"),
    el("button", { onclick: openSystemHealthModal }, "🖥️ System Check"),
    el("button", { onclick: async () => {
      toast("Running hermes doctor…");
      const r = await api("/api/doctor");
      openModal("Hermes Doctor Diagnostic Report", r.stdout || r.stderr || "(no output)");
    } }, "🩺 Doctor Diagnostics"),
    el("button", { onclick: async () => {
      const r = await api("/api/backup", { body: {} });
      if (r.ok) toast("Backup created ✓", "ok");
      else toast("Backup failed: " + r.message, "err");
    } }, "💾 Quick Backup")
  );

  let systemAlertBanner = null;
  const h = STATE?.system_health;
  if (h && !h.hermes_installed) {
    const checks = h.checks || [];
    const pyCheck = checks.find(c => c.id === "python");
    const yamlCheck = checks.find(c => c.id === "pyyaml");
    const hermesCheck = checks.find(c => c.id === "hermes_cli");

    systemAlertBanner = el("div", { class: "system-alert-banner" },
      el("div", { class: "sab-icon" }, "⚠️"),
      el("div", { class: "sab-body" },
        el("div", { class: "sab-title" }, "System Requirements Notice: Hermes Agent CLI is not detected on this machine"),
        el("div", { class: "sab-desc" },
          `1. Python: ✓ ${pyCheck?.title || "Ready"}  |  2. PyYAML: ✓ ${yamlCheck?.title || "Installed"}  |  3. Hermes CLI: ✗ ${hermesCheck?.title || "Not installed"}`
        ),
        el("div", { class: "dim small", style: "margin-top:4px;" },
          "The GUI is running in setup mode. You can configure providers, keys, and restore backups."
        )
      ),
      el("div", { class: "sab-actions" },
        el("button", { class: "primary", onclick: (e) => { e.stopPropagation(); openSystemHealthModal(); } }, "📋 Pre-Flight Checklist")
      )
    );
  }

  // 3. RECENT CHAT SESSIONS GRID
  const recentGrid = el("div", { class: "home-recent-grid" });
  if (recents.length) {
    for (const s of recents) {
      const card = el("div", {
        class: "home-recent-card",
        onclick: () => resumeSessionFromHome(s.id)
      },
        el("div", { class: "home-recent-top" },
          el("span", { class: "badge standard", style: "font-weight:700;font-size:11px;" }, s.model),
          el("span", { class: "dim small", style: "font-family:var(--font-mono);" }, timeAgoStr(s.started_at))
        ),
        el("div", { class: "home-recent-title", title: s.title }, s.title),
        el("div", { class: "home-recent-meta" },
          el("span", { class: "home-recent-chip" }, `💬 ${s.message_count} msgs`),
          s.tool_call_count > 0 ? el("span", { class: "home-recent-chip" }, `🛠️ ${s.tool_call_count} tools`) : null,
          el("span", { class: "home-recent-chip" }, `⚡ ${fmtTokens(s.input_tokens + s.output_tokens)} tokens`)
        ),
        el("button", {
          class: "home-recent-btn",
          onclick: (e) => {
            e.stopPropagation();
            resumeSessionFromHome(s.id);
          }
        }, "▶ Resume Chat")
      );
      recentGrid.append(card);
    }
  }

  // 4. LIFETIME COMPUTE & TOKEN EFFICIENCY
  const lifetimeBar = el("div", { class: "home-stats-bar" });
  lifetimeBar.append(
    statBox("📊", "Lifetime Tokens", fmtTokens(tot.input_tokens + tot.output_tokens), `In: ${fmtTokens(tot.input_tokens)} · Out: ${fmtTokens(tot.output_tokens)}`, false),
    statBox("🚀", "Cache Hit Rate", `${tot.cache_savings_pct || 0}%`, `${fmtTokens(tot.cache_read_tokens)} tokens read free`, true),
    statBox("🛠️", "Tool Executions", `${tot.tool_calls || 0} calls`, `Across ${tot.sessions || 0} agent sessions`, false),
    statBox("💬", "Lifetime Turns", `${tot.messages || 0} turns`, "Persisted in SQLite state.db", false)
  );

  // 5. AGENT BRAIN & SKILLS
  const brainGrid = el("div", { class: "home-brain-grid" });
  const pct = mem.char_limit ? Math.min(100, Math.round(((mem.used_chars || 0) / mem.char_limit) * 100)) : 0;
  const memCard = el("div", { class: "home-brain-card" },
    el("div", {},
      el("div", { class: "home-brain-top" },
        el("div", { class: "home-brain-title" }, "🧠 Long-Term Memory"),
        el("span", { class: "badge standard", style: "background:var(--gold-soft);color:var(--gold-text);border-color:var(--gold-border);font-weight:700;" }, mem.enabled ? "ACTIVE" : "OFF")
      ),
      el("div", { style: "display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:4px;" },
        el("span", {}, "Memory Storage (MEMORY.md)"),
        el("span", { style: "font-family:var(--font-mono);font-weight:600;" }, `${mem.used_chars || 0} / ${mem.char_limit || 10000} chars (${pct}%)`)
      ),
      el("div", { class: "home-memory-meter" },
        el("div", { class: "home-memory-fill", style: `width:${pct}%` })
      ),
      mem.snippet ? el("div", { class: "home-memory-snippet" }, `“${mem.snippet}”`) : null
    ),
    el("div", { style: "margin-top:14px;display:flex;justify-content:flex-end;" },
      el("button", { class: "ghost", style: "font-size:12px;padding:4px 10px;", onclick: () => showPage("config") }, "Memory Settings →")
    )
  );

  const skillsWrap = el("div", { class: "home-skills-wrap" });
  for (const sk of (skills.list || [])) {
    skillsWrap.append(el("span", { class: "home-skill-pill" }, `🧩 ${sk}`));
  }
  const skillsCard = el("div", { class: "home-brain-card" },
    el("div", {},
      el("div", { class: "home-brain-top" },
        el("div", { class: "home-brain-title" }, "🧩 Installed Skills"),
        el("span", { class: "badge standard", style: "font-weight:700;" }, `${skills.count || 0} LOADED`)
      ),
      el("p", { class: "dim small", style: "margin:0 0 8px;" }, "Autonomous skill capabilities active in your Hermes workspace:"),
      skillsWrap
    ),
    el("div", { style: "margin-top:14px;display:flex;justify-content:flex-end;" },
      el("button", { class: "ghost", style: "font-size:12px;padding:4px 10px;", onclick: () => showPage("tools") }, "Manage Toolsets →")
    )
  );
  brainGrid.append(memCard, skillsCard);

  const pageElements = [];
  if (systemAlertBanner) {
    pageElements.push(systemAlertBanner);
  }

  const makeDivider = (title, icon) => el("div", { class: "home-section-divider" },
    el("div", { class: "divider-title" }, `${icon} ${title}`),
    el("div", { class: "divider-line" })
  );

  pageElements.push(
    el("h1", { class: "pagetitle" },
      el("span", { class: "title-gold" }, "Hermes Agent"),
      " Command Center"
    ),
    el("p", { class: "pagesub" }, "Executive overview of your AI agent stack with instant shortcuts to all core features, models, capabilities, and system tools."),
    makeDivider("Engine Status & System Vitals", "⚡"),
    statsBar
  );

  if (recents.length) {
    pageElements.push(
      makeDivider("Recent Conversations & Quick Resume", "💬"),
      recentGrid
    );
  }

  pageElements.push(
    makeDivider("Lifetime Compute & Token Efficiency", "📊"),
    lifetimeBar,
    makeDivider("Agent Memory & Skill Extensions", "🧠"),
    brainGrid,
    makeDivider("Feature Deck & Capabilities", "🧭"),
    featureGrid,
    makeDivider("Quick Actions", "⚡"),
    card("Quick System Shortcuts", "Direct 1-click execution of high-frequency tasks", quickBar)
  );

  page.replaceChildren(...pageElements);
};

/* ---------------- MAIN AI (MODEL & PROVIDER) ---------------- */
PAGES.model = async function (page) {
  await loadState();
  const m = STATE.model || {};
  const currentProvider = m.provider || "openrouter";
  const currentModel = m.default || "";

  // 1. HERO ACTIVE STATUS BANNER
  const heroPill = el("div", { class: "hero-ai-badge" },
    el("span", { style: "color:var(--green);font-size:10px" }, "●"),
    "Active Agent Engine"
  );

  const heroTitle = el("div", { class: "hero-ai-title" }, currentModel || "(No model selected)");
  
  // Find provider display info
  const bInfo = (typeof BUILTIN_PROVIDERS_INFO !== "undefined" ? BUILTIN_PROVIDERS_INFO : []).find(p => p.name === currentProvider);
  const cInfo = (STATE.custom_providers || []).find(p => p.name === currentProvider);
  const provIcon = cInfo ? "🔌" : (bInfo?.icon || "🤖");
  const provLabel = cInfo ? (cInfo.name + " (Custom)") : (bInfo?.label || currentProvider);

  const heroSub = el("div", { class: "hero-ai-sub" },
    el("span", { style: "font-weight:600;color:var(--ink)" }, `${provIcon} ${provLabel}`),
    m.base_url ? el("span", { class: "mono small dim" }, `· ${m.base_url}`) : null,
    m.context_length ? el("span", { class: "badge info" }, `${m.context_length.toLocaleString()} ctx`) : null
  );

  const heroTestCard = el("div", { class: "model-test-card-wrap" });

  const heroActions = el("div", { class: "hero-ai-actions" },
    el("button", {
      class: "primary",
      onclick: () => openSpeedBenchmarkModal(currentProvider, m.base_url, currentModel)
    }, "⚡ Benchmark Speed"),
    el("button", {
      onclick: async () => {
        if (!currentModel) {
          renderTestResultCard(heroTestCard, {
            state: "err",
            model: "",
            provider: currentProvider,
            error: "Select a model first before testing connection."
          });
          return;
        }
        renderTestResultCard(heroTestCard, {
          state: "loading",
          model: currentModel,
          provider: currentProvider
        });
        try {
          const r = await api("/api/probe/chat", { body: { provider: currentProvider, model: currentModel, base_url: m.base_url || "" } });
          if (r.ok && r.chat_ok) {
            renderTestResultCard(heroTestCard, {
              state: "ok",
              model: currentModel,
              provider: currentProvider,
              reply: r.chat,
              keyEnv: r.key_env
            });
          } else {
            renderTestResultCard(heroTestCard, {
              state: "err",
              model: currentModel,
              provider: currentProvider,
              error: r.message || "Connection issue: model reply failed."
            });
          }
        } catch (e) {
          renderTestResultCard(heroTestCard, {
            state: "err",
            model: currentModel,
            provider: currentProvider,
            error: e.message
          });
        }
      }
    }, "🩺 Test Connection"),
    el("button", { onclick: () => showPage("chat") }, "💬 Open Chat")
  );

  const heroCard = el("div", { class: "hero-ai-card" },
    el("div", { class: "hero-ai-head" }, heroPill),
    heroTitle,
    heroSub,
    heroActions,
    heroTestCard
  );

  // 2. CONFIGURATION CARD
  const provSel = el("select", { style: "width:100%" });
  const allProvidersList = providerNames(currentProvider);
  
  // Categorize providers into optgroups
  const customNames = (STATE.custom_providers || []).map(p => p.name);
  const optCustom = el("optgroup", { label: "Custom Providers" });
  const optBuiltin = el("optgroup", { label: "Official / Built-in Providers" });

  allProvidersList.forEach(p => {
    const isCustom = customNames.includes(p);
    const bi = (typeof BUILTIN_PROVIDERS_INFO !== "undefined" ? BUILTIN_PROVIDERS_INFO : []).find(x => x.name === p);
    const label = bi ? `${bi.icon} ${bi.label || p}` : (isCustom ? `🔌 ${p}` : p);
    const opt = el("option", { value: p }, label);
    if (isCustom) optCustom.append(opt);
    else optBuiltin.append(opt);
  });

  if (optCustom.children.length) provSel.append(optCustom);
  provSel.append(optBuiltin);
  provSel.value = currentProvider;

  const urlIn = el("input", {
    type: "text",
    value: m.base_url || "",
    placeholder: "e.g. http://localhost:11434/v1 or https://your-endpoint.com/v1"
  });

  const ctxIn = el("input", {
    type: "number",
    value: m.context_length || "",
    placeholder: "Leave empty for model default, or e.g. 128000"
  });

  const picker = modelPicker({
    value: m.default || "",
    placeholder: "e.g. anthropic/claude-3.7-sonnet — type freely or press Find models",
    initialModels: modelsFor(currentProvider),
    getProvider: () => ({ provider: provSel.value, base_url: urlIn.value.trim() }),
  });

  provSel.onchange = () => {
    const pVal = provSel.value;
    const cp = (STATE.custom_providers || []).find(p => p.name === pVal);
    picker.setSuggestions(modelsFor(pVal));
    if (cp) {
      urlIn.value = cp.base_url || '';
      if (cp.model && !picker.input.value.trim()) {
        picker.input.value = cp.model;
        picker.input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      const bi = (typeof BUILTIN_PROVIDERS_INFO !== "undefined" ? BUILTIN_PROVIDERS_INFO : []).find(x => x.name === pVal);
      if (bi && !bi.oauth) {
        urlIn.placeholder = bi.base_url || "Default official URL";
      }
    }
    updateKeyCard(pVal);
  };

  const sb = saveBtn(null, async () => {
    const steps = [];
    if (provSel.value !== (m.provider || "")) steps.push(["model.provider", provSel.value]);
    if (picker.input.value.trim() !== (m.default || "")) steps.push(["model.default", picker.input.value.trim()]);
    if (urlIn.value.trim() !== (m.base_url || "")) steps.push(["model.base_url", urlIn.value.trim()]);
    
    const ctxVal = parseInt(ctxIn.value.trim(), 10);
    if (!isNaN(ctxVal) && ctxVal > 0) {
      if (ctxVal !== m.context_length) steps.push(["model.context_length", ctxVal]);
    } else if (m.context_length) {
      steps.push(["model.context_length", null]);
    }

    if (!steps.length) return { ok: true };
    let last;
    for (const [k, v] of steps) {
      if (v === null) last = await api("/api/unset", { body: { key: k } });
      else last = await api("/api/set", { body: { key: k, value: v } });
      if (last.ok === false) return last;
    }
    await loadState();
    showPage("model");
    return last;
  });

  const modelCard = card("Engine & Model Configuration", "Configure the primary language model and provider settings.",
    field("Provider", provSel, "Select an official AI platform or one of your custom endpoints."),
    field("Model identifier", picker.root, "Find models retrieves live available models. Test model verifies reply capability, and Benchmark measures tokens per second."),
    field("Server address (base URL)", urlIn, "Only required for custom endpoints or proxies; official providers use their standard cloud endpoints automatically."),
    field("Context window limit (optional)", ctxIn, "Override maximum token context length if needed by your model or workflow."),
    el("div", { class: "savebar", style: "margin-top:18px" }, sb.btn, sb.status)
  );

  // 3. AUTHENTICATION & KEY CARD
  const keyCardContainer = el("div");
  function updateKeyCard(pVal) {
    keyCardContainer.replaceChildren();
    
    // Resolve key requirements for pVal
    const cp = (STATE.custom_providers || []).find(p => p.name === pVal);
    const bi = (typeof BUILTIN_PROVIDERS_INFO !== "undefined" ? BUILTIN_PROVIDERS_INFO : []).find(x => x.name === pVal);
    
    let keyEnv = cp ? cp.key_env : (bi?.keys?.[0] || "");
    let isLocal = (pVal === "ollama");
    let isOauth = bi?.oauth;

    const content = el("div");

    if (isOauth) {
      content.append(
        el("div", { class: "setting-row" },
          el("div", {},
            el("div", { class: "s-label" }, "🔑 OAuth Authentication"),
            el("div", { class: "s-desc" }, `Run 'hermes auth add ${pVal}' in your terminal to login with OAuth.`)),
          el("span", { class: "badge info" }, "OAuth Mode")
        )
      );
    } else if (isLocal) {
      content.append(
        el("div", { class: "setting-row" },
          el("div", {},
            el("div", { class: "s-label" }, "✓ No API Key Required"),
            el("div", { class: "s-desc" }, "Ollama runs locally on your machine. Ensure the Ollama app is running.")),
          el("span", { class: "badge ok" }, "Local Free")
        )
      );
    } else if (keyEnv) {
      const entry = (STATE.env_entries || []).find(e => e.key === keyEnv);
      const isSet = entry && entry.set;

      content.append(
        el("div", { class: "setting-row" },
          el("div", {},
            el("div", { class: "s-label" }, `Required key: ${keyEnv}`),
            el("div", { class: "s-desc" }, isSet
              ? `Configured safely in .env (${entry.masked})`
              : "MISSING — This model will not work until you set this key.")
          ),
          el("div", { style: "display:flex;gap:8px" },
            isSet ? el("button", { onclick: () => revealEnvValue(keyEnv) }, "👁️ Reveal") : null,
            el("button", {
              class: isSet ? "" : "primary",
              onclick: () => askEnvValue(keyEnv)
            }, isSet ? "Change Key" : "Set API Key")
          )
        )
      );
    } else {
      content.append(
        el("p", { class: "dim small" }, "No specific key mapped. Check the API Keys page to configure provider credentials.")
      );
    }

    content.append(
      el("div", { class: "btnrow", style: "margin-top:14px" },
        el("button", { onclick: () => showPage("keys") }, "Open API Keys Dashboard →")
      )
    );

    keyCardContainer.append(card("Authentication & Credentials", "API key status for the selected provider.", content));
  }
  updateKeyCard(currentProvider);

  // 4. MODEL SHORTCUTS (ALIASES) CARD
  const aliases = m.aliases || {};
  const alCard = card("Model Shortcuts (Aliases)", "Create handy aliases you can invoke in terminal or chat with /model <name>.");
  const alTable = el("table", { class: "rows" });
  alTable.append(el("tr", {}, el("th", {}, "Shortcut"), el("th", {}, "Target Model"), el("th", { style: "text-align:right" }, "Action")));
  
  for (const [name, target] of Object.entries(aliases)) {
    alTable.append(el("tr", {},
      el("td", { class: "mono", style: "font-weight:700;color:var(--gold-text)" }, "/" + name),
      el("td", { class: "mono dim" }, String(target)),
      el("td", { class: "actions" },
        el("button", { class: "danger", onclick: async () => {
          const r = await api("/api/unset", { body: { key: "model.aliases." + name } });
          if (r.ok) { toast("Shortcut " + name + " removed ✓", "ok"); showPage("model"); }
          else toast("Could not remove: " + r.message, "err");
        } }, "Delete")
      )
    ));
  }
  if (!Object.keys(aliases).length) {
    alTable.append(el("tr", {}, el("td", { colspan: "3", class: "dim", style: "text-align:center;padding:16px" }, "No shortcuts yet. Add one below (e.g. 'fast' pointing to a quick model).")));
  }

  const alName = el("input", { type: "text", placeholder: "Shortcut name, e.g. fast" });
  const alVal = el("input", { type: "text", placeholder: "Target model, e.g. groq/llama-3.3-70b" });
  const alAdd = el("button", { class: "primary", onclick: async () => {
    const sName = alName.value.trim().replace(/^\//, "");
    const sVal = alVal.value.trim();
    if (!sName || !sVal) { toast("Fill in both shortcut name and model target", "err"); return; }
    const r = await api("/api/set", { body: { key: "model.aliases." + sName, value: sVal } });
    if (r.ok) { toast("Shortcut /" + sName + " added ✓", "ok"); showPage("model"); }
    else toast("Could not add: " + r.message, "err");
  } }, "+ Add Shortcut");

  alCard.append(
    alTable,
    el("div", { class: "row2", style: "margin-top:14px" },
      field("Shortcut trigger", alName),
      field("Points to model", alVal)
    ),
    el("div", { class: "btnrow" }, alAdd)
  );

  // 5. SYSTEM DIAGNOSTICS & MAINTENANCE (Merged from Home)
  const diagCard = card("System Diagnostics & Maintenance", "Run one-click agent health inspections, check failovers, and create full state backups.",
    el("div", { class: "setting-row" },
      el("div", {},
        el("div", { class: "s-label" }, "Agent Health & Doctor Scan"),
        el("div", { class: "s-desc" }, "Inspects Python venv, SQLite state database, token files, and network reachability.")),
      el("button", { onclick: async () => {
        toast("Running hermes doctor…");
        const r = await api("/api/doctor");
        openModal("Hermes Doctor Diagnostic Report", r.stdout || r.stderr || "(no output)");
      } }, "🩺 Run Health Check (Doctor)")),
    el("div", { class: "setting-row" },
      el("div", {},
        el("div", { class: "s-label" }, "Full System State Backup"),
        el("div", { class: "s-desc" }, "Archive current config.yaml, .env keys, and custom providers to a timestamped backup file.")),
      el("button", { class: "primary", onclick: async () => {
        const r = await api("/api/backup", { body: {} });
        if (r.ok) toast("Backup created ✓ " + (r.stdout ? "\n" + r.stdout.split("\n")[0] : ""), "ok", 7000);
        else toast("Backup failed: " + r.message, "err", 7000);
      } }, "💾 Save Full Backup")),
    el("div", { class: "setting-row" },
      el("div", {},
        el("div", { class: "s-label" }, "Failover & Fallback Models"),
        el("div", { class: "s-desc" }, (STATE.fallback_chain || []).length
          ? `${STATE.fallback_chain.length} fallback model(s) armed if primary model rate-limits.`
          : "No backup models configured — Hermes will stop if rate limited.")),
      el("button", { onclick: () => showPage("fallback") }, "Configure Fallbacks →")),
    el("div", { class: "setting-row" },
      el("div", {},
        el("div", { class: "s-label" }, "Credential Storage (.env)"),
        el("div", { class: "s-desc" }, `${(STATE.env_entries || []).filter(e => e.set && /KEY|TOKEN|SECRET|PASSWORD/i.test(e.key)).length} secret key(s) safely stored.`)),
      el("button", { onclick: () => showPage("keys") }, "Manage Credentials →"))
  );

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "Main AI"),
    el("p", { class: "pagesub" }, "Configure your primary agent model, verify provider connectivity, manage model aliases, and run diagnostics."),
    heroCard,
    modelCard,
    keyCardContainer,
    alCard,
    diagCard
  );
};

/* ---------------- API KEYS ---------------- */
const COMMON_KEYS = [
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
  "GEMINI_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY", "GLM_API_KEY", "KIMI_API_KEY",
  "DASHSCOPE_API_KEY", "MINIMAX_API_KEY", "HF_TOKEN", "MISTRAL_API_KEY", "NVIDIA_API_KEY",
  "FIREWORKS_API_KEY", "DEEPINFRA_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY",
  "TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN", "SLACK_BOT_TOKEN", "GITHUB_TOKEN",
];

PAGES.keys = async function (page) {
  await loadState();
  const entries = (STATE.env_entries || []).slice();

  const listCard = card("Your Saved Keys", "Keys are stored locally in your .env file. Use Change or Set to update values.");
  
  // Search filter bar
  const searchInput = el("input", {
    type: "text",
    placeholder: "🔍 Filter keys by name…",
    style: "margin-bottom:14px;"
  });

  const tbl = el("table", { class: "rows" });
  
  function renderKeyRows() {
    tbl.replaceChildren();
    tbl.append(el("tr", {}, el("th", {}, "Key Name"), el("th", {}, "Status & Value"), el("th", { style: "text-align:right" }, "Actions")));
    
    const q = searchInput.value.trim().toLowerCase();
    const filtered = entries
      .filter(e => !q || e.key.toLowerCase().includes(q))
      .sort((a, b) => a.key.localeCompare(b.key));

    for (const e of filtered) {
      const isSecret = /KEY|TOKEN|SECRET|PASSWORD/i.test(e.key);
      const valBadge = e.set
        ? (isSecret ? el("span", { class: "badge info" }, e.masked) : el("span", { class: "dim mono small" }, e.masked))
        : el("span", { class: "badge miss" }, "not set");

      tbl.append(el("tr", {},
        el("td", { class: "mono", style: "font-weight:600" }, e.key),
        el("td", {}, valBadge),
        el("td", { class: "actions" },
          e.set ? el("button", { onclick: () => revealEnvValue(e.key) }, "👁️ Reveal") : null,
          " ",
          el("button", { onclick: () => askEnvValue(e.key) }, e.set ? "Edit" : "Set key"),
          " ",
          el("button", { class: "danger", onclick: async () => {
            if (!confirm("Delete " + e.key + " from your .env file?")) return;
            const r = await api("/api/env/delete", { body: { key: e.key } });
            if (r.ok) { toast(e.key + " deleted ✓", "ok"); showPage("keys"); }
            else toast("Could not delete: " + r.message, "err");
          } }, "Delete"),
        ),
      ));
    }
    if (!filtered.length) {
      tbl.append(el("tr", {}, el("td", { colspan: "3", class: "dim", style: "text-align:center;padding:20px;" },
        entries.length ? "No keys match “" + searchInput.value + "”." : "No keys saved yet.")));
    }
  }

  searchInput.oninput = renderKeyRows;
  renderKeyRows();
  listCard.append(searchInput, tbl);

  /* add new key card */
  const kName = el("input", { type: "text", placeholder: "e.g. OPENROUTER_API_KEY", list: "dl-keynames" });
  kName.setAttribute("list", "dl-keynames");
  const dlKeys = el("datalist", { id: "dl-keynames" }, COMMON_KEYS.map(k => el("option", { value: k })));
  
  const kVal = el("input", { type: "password", placeholder: "Paste secret value here" });
  const eyeBtn = el("button", {
    type: "button",
    class: "ghost",
    style: "position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:4px 8px;font-size:14px;",
    onclick: () => {
      const isPwd = kVal.type === "password";
      kVal.type = isPwd ? "text" : "password";
      eyeBtn.textContent = isPwd ? "🙈" : "👁️";
    }
  }, "👁️");
  const valWrapper = el("div", { style: "position:relative;" }, kVal, eyeBtn);

  // Quick suggestions chips
  const chipsWrap = el("div", { style: "margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;" },
    el("span", { class: "dim small", style: "margin-right:4px;" }, "Quick add:"),
    ...COMMON_KEYS.slice(0, 9).map(k => {
      return el("button", {
        type: "button",
        class: "ghost",
        style: "padding:3px 8px;font-size:11.5px;font-family:var(--font-mono);border:1px solid var(--line);border-radius:6px;",
        onclick: () => {
          kName.value = k;
          kVal.focus();
        }
      }, "+ " + k);
    })
  );

  const addCard = card("Add or Update a Key", "Choose a key name or click a quick suggestion below.",
    dlKeys,
    chipsWrap,
    el("div", { class: "row2" },
      field("Key Name", kName, "Standard uppercase format (e.g. OPENROUTER_API_KEY)."),
      field("Secret Value", valWrapper, "Stored directly into your local .env file.")),
    el("div", { class: "btnrow" },
      el("button", { class: "primary", onclick: async () => {
        const key = kName.value.trim().toUpperCase();
        const val = kVal.value;
        if (!/^[A-Z][A-Z0-9_]*$/.test(key)) { toast("Name must be CAPITAL letters, numbers and underscores", "err"); return; }
        if (!val) { toast("Paste the value first", "err"); return; }
        const r = await api("/api/env/set", { body: { key, value: val } });
        if (r.ok) { toast(key + " saved ✓", "ok"); showPage("keys"); }
        else toast("Could not save: " + r.message, "err");
      } }, "Save key to .env")));

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "API Keys & Credentials"),
    el("p", { class: "pagesub" }, "Authentication credentials for AI providers and services. Stored in " + (STATE.paths ? STATE.paths.env : "~/.hermes/.env") + "."),
    listCard, addCard,
  );
};

/* Reveal env value in a modal */
async function revealEnvValue(key) {
  const r = await api("/api/env/reveal?key=" + encodeURIComponent(key));
  if (!r.value) {
    toast("Could not read key: " + (r.error || "empty"), "err");
    return;
  }
  openModal("Key: " + key, (body, actions) => {
    const valInp = el("input", { type: "text", value: r.value, readonly: true, style: "font-family:var(--font-mono);font-size:13px;" });
    const copyBtn = el("button", { class: "primary", onclick: () => {
      navigator.clipboard?.writeText(r.value).then(() => toast("Copied " + key + " ✓", "ok"));
    } }, "📋 Copy Value");
    
    body.append(
      el("p", { class: "dim small" }, "Value retrieved from .env file:"),
      valInp,
    );
    actions.append(copyBtn, el("button", { onclick: closeModal }, "Close"));
  });
}

/* prompt for an env value (modal) */
async function askEnvValue(key, candidateKeys = []) {
  const keysToTry = [key, ...(Array.isArray(candidateKeys) ? candidateKeys : [candidateKeys])].filter(Boolean);
  let activeKey = key || keysToTry[0] || "";
  let currentVal = "";

  for (const k of keysToTry) {
    try {
      const r = await api("/api/env/reveal?key=" + encodeURIComponent(k));
      if (r && r.value) {
        currentVal = r.value;
        activeKey = k;
        break;
      }
    } catch {}
  }

  // Fallback check against STATE.env_entries if still empty
  if (!currentVal && STATE.env_entries) {
    for (const k of keysToTry) {
      const ent = STATE.env_entries.find(e => e.key === k && e.set);
      if (ent) {
        activeKey = k;
        try {
          const r = await api("/api/env/reveal?key=" + encodeURIComponent(k));
          if (r && r.value) {
            currentVal = r.value;
            break;
          }
        } catch {}
      }
    }
  }

  const isSet = !!currentVal;

  openModal(`🔑 API Key: ${activeKey}`, (body, actions) => {
    const inp = el("input", {
      type: "password",
      value: currentVal,
      placeholder: "Paste API key secret here",
      style: "width:100%;font-family:var(--font-mono);font-size:13px;padding-right:45px;"
    });

    const eye = el("button", {
      type: "button",
      class: "ghost",
      title: "Toggle key visibility",
      style: "position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:4px 8px;font-size:14px;",
      onclick: () => {
        const isPwd = inp.type === "password";
        inp.type = isPwd ? "text" : "password";
        eye.textContent = isPwd ? "🙈" : "👁️";
      }
    }, "👁️");

    const wrap = el("div", { style: "position:relative;margin:8px 0 12px;" }, inp, eye);

    const copyBtn = isSet ? el("button", {
      type: "button",
      class: "primary",
      style: "padding:5px 12px;font-size:12px;display:inline-flex;align-items:center;gap:5px;",
      onclick: () => {
        if (inp.value) {
          navigator.clipboard?.writeText(inp.value).then(() => toast("API Key copied to clipboard ✓", "ok", 3000));
        } else {
          toast("No key value to copy", "err");
        }
      }
    }, "📋 Copy Value") : null;

    const topNote = isSet
      ? el("div", { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap;" },
          el("span", { class: "badge ok", style: "font-size:12px;padding:3px 8px;" }, `✓ Stored in .env (${activeKey})`),
          copyBtn
        )
      : el("p", { class: "dim small", style: "margin-bottom:8px;" }, `Value will be safely stored in your .env file as ${activeKey}.`);

    body.append(topNote, wrap);

    const save = el("button", {
      class: isSet ? "" : "primary",
      onclick: async () => {
        if (!inp.value.trim()) { toast("Paste or enter value first", "err"); return; }
        const r = await api("/api/env/set", { body: { key: activeKey, value: inp.value.trim() } });
        if (r.ok) {
          toast(activeKey + " saved ✓", "ok");
          closeModal();
          await loadState();
          showPage(currentPage);
        } else {
          toast("Could not save: " + r.message, "err");
        }
      }
    }, "Save Changes");

    actions.append(el("button", { onclick: closeModal }, "Close"), save);
    setTimeout(() => inp.focus(), 50);
  });
}

/* ---------------- PROVIDERS REGISTRY & PAGE ---------------- */
const BUILTIN_PROVIDERS_INFO = [
  { name: "openrouter", label: "OpenRouter", icon: "🌐", base_url: "https://openrouter.ai/api/v1", keys: ["OPENROUTER_API_KEY", "HERMES_CUSTOM_OPENROUTER_AI_API_KEY"], desc: "Unified API gateway offering 200+ frontier & open-source models (OpenAI, Anthropic, Meta, Mistral, and more)." },
  { name: "openai", label: "OpenAI", icon: "🟢", base_url: "https://api.openai.com/v1", keys: ["OPENAI_API_KEY"], desc: "Official OpenAI models including GPT-4o, GPT-4o-mini, o1, and o3-mini." },
  { name: "anthropic", label: "Anthropic", icon: "🟤", base_url: "https://api.anthropic.com/v1", keys: ["ANTHROPIC_API_KEY"], desc: "Claude 3.7 Sonnet (hybrid reasoning), Claude 3.5 Sonnet, and Claude 3 Opus." },
  { name: "gemini", label: "Google Gemini", icon: "🔵", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", keys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"], desc: "Google Gemini 2.0 Flash, 1.5 Pro, and Thinking models via OpenAI-compatible endpoint." },
  { name: "deepseek", label: "DeepSeek", icon: "🐋", base_url: "https://api.deepseek.com/v1", keys: ["DEEPSEEK_API_KEY"], desc: "DeepSeek-V3 general model and DeepSeek-R1 open reasoning model." },
  { name: "groq", label: "Groq", icon: "⚡", base_url: "https://api.groq.com/openai/v1", keys: ["GROQ_API_KEY", "HERMES_CUSTOM_API_GROQ_COM_API_KEY"], desc: "Ultra-fast LPU inference engine for Llama 3.3, Qwen 2.5, and Gemma." },
  { name: "xai", label: "xAI (Grok)", icon: "✖️", base_url: "https://api.x.ai/v1", keys: ["XAI_API_KEY"], desc: "Grok-2, Grok-2-vision, and Grok-beta models from xAI." },
  { name: "mistral", label: "Mistral AI", icon: "🌪️", base_url: "https://api.mistral.ai/v1", keys: ["MISTRAL_API_KEY"], desc: "Mistral Large, Codestral (code generation), Pixtral, and Ministral." },
  { name: "ollama", label: "Ollama (Local)", icon: "🦙", base_url: "http://localhost:11434/v1", keys: ["OLLAMA_API_KEY"], desc: "Local offline LLM runner on your own machine. No API key required." },
  { name: "ollama-cloud", label: "Ollama Cloud", icon: "☁️", base_url: "https://ollama.com/v1", keys: ["OLLAMA_CLOUD_API_KEY"], desc: "Cloud-hosted Ollama managed endpoints." },
  { name: "zai", label: "Z.AI (GLM)", icon: "🇨🇳", base_url: "https://api.z.ai/api/paas/v4", keys: ["GLM_API_KEY", "ZAI_API_KEY"], desc: "Zhipu AI flagship GLM-4 and GLM coding models." },
  { name: "together", label: "Together AI", icon: "🤝", base_url: "https://api.together.xyz/v1", keys: ["TOGETHER_API_KEY"], desc: "Fast open source AI model cloud with extensive open-weights catalog." },
  { name: "fireworks", label: "Fireworks AI", icon: "🎆", base_url: "https://api.fireworks.ai/inference/v1", keys: ["FIREWORKS_API_KEY"], desc: "Ultra-low latency serverless open-source model inference." },
  { name: "novita", label: "Novita AI", icon: "🚀", base_url: "https://api.novita.ai/v3/openai", keys: ["NOVITA_API_KEY"], desc: "Serverless LLM APIs with high throughput and competitive pricing." },
  { name: "nvidia", label: "NVIDIA NIM", icon: "🟩", base_url: "https://integrate.api.nvidia.com/v1", keys: ["NVIDIA_API_KEY"], desc: "Enterprise AI microservices optimized on NVIDIA architecture." },
  { name: "deepinfra", label: "DeepInfra", icon: "📦", base_url: "https://api.deepinfra.com/v1/openai", keys: ["DEEPINFRA_API_KEY"], desc: "Scalable machine learning inference with pay-per-token pricing." },
  { name: "huggingface", label: "Hugging Face", icon: "🤗", base_url: "https://router.huggingface.co/v1", keys: ["HF_TOKEN"], desc: "Hugging Face Serverless Inference Router for community models." },
  { name: "minimax", label: "MiniMax", icon: "🤖", base_url: "https://api.minimaxi.com/v1", keys: ["MINIMAX_API_KEY"], desc: "MiniMax text-01 and abab series models." },
  { name: "minimax-cn", label: "MiniMax (China)", icon: "🇨🇳", base_url: "https://api.minimaxi.cn/v1", keys: ["MINIMAX_CN_API_KEY"], desc: "MiniMax mainland China API endpoint." },
  { name: "kimi-coding", label: "Moonshot / Kimi", icon: "🌙", base_url: "https://api.moonshot.ai/v1", keys: ["KIMI_API_KEY"], desc: "Moonshot Kimi long-context and code reasoning models." },
  { name: "kimi-coding-cn", label: "Moonshot / Kimi (China)", icon: "🇨🇳", base_url: "https://api.moonshot.cn/v1", keys: ["KIMI_CN_API_KEY"], desc: "Moonshot China regional API endpoint." },
  { name: "alibaba", label: "Alibaba DashScope", icon: "☁️", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", keys: ["DASHSCOPE_API_KEY"], desc: "Qwen 2.5 and Tongyi Qianwen models via compatible mode." },
  { name: "stepfun", label: "StepFun", icon: "🪜", base_url: "https://api.stepfun.com/v1", keys: ["STEPFUN_API_KEY"], desc: "Step-1 and Step-2 large multimodal foundation models." },
  { name: "upstage", label: "Upstage (Solar)", icon: "☀️", base_url: "https://api.upstage.ai/v1", keys: ["UPSTAGE_API_KEY"], desc: "Solar-10.7B and document intelligence models." },
  { name: "nous", label: "Nous Research", icon: "🔮", base_url: "https://inference-api.nousresearch.com/v1", keys: ["NOUS_API_KEY"], desc: "Nous Research Hermetic reasoning and fine-tuned models." },
  { name: "copilot", label: "GitHub Copilot", icon: "🐙", base_url: "OAuth", keys: [], desc: "GitHub Copilot chat models authenticated via CLI: hermes auth add copilot", oauth: true },
  { name: "openai-codex", label: "OpenAI Codex", icon: "🔑", base_url: "OAuth", keys: [], desc: "OpenAI Codex OAuth login authenticated via CLI: hermes auth add openai-codex", oauth: true },
];

function resolveProviderKeyStatus(p) {
  if (p.custom) {
    return {
      keyEnv: p.key_env || "",
      keySet: !!p.key_set,
      keyMasked: p.key_masked || "",
      keyNeeded: true,
      oauth: false
    };
  }
  if (p.oauth) {
    return { keyEnv: null, keySet: true, keyMasked: "OAuth", keyNeeded: false, oauth: true };
  }
  if (!p.keys || !p.keys.length) {
    return { keyEnv: null, keySet: true, keyMasked: "None needed (Local)", keyNeeded: false, oauth: false };
  }
  // Check against STATE.env_entries
  let found = null;
  for (const k of p.keys) {
    const entry = (STATE.env_entries || []).find(e => e.key === k);
    if (entry && entry.set) {
      found = entry;
      break;
    }
  }
  const primaryKey = p.keys[0];
  if (found) {
    return { keyEnv: found.key, keySet: true, keyMasked: found.masked, keyNeeded: true, oauth: false };
  }
  return { keyEnv: primaryKey, keySet: false, keyMasked: "", keyNeeded: true, oauth: false };
}

function openEditCustomModal(p) {
  openModal(`Edit Custom Provider: ${p.name}`, (body, actions) => {
    const nameIn = el("input", { type: "text", value: p.name || "", style: "width:100%" });
    const urlIn = el("input", { type: "text", value: p.base_url || "", style: "width:100%" });
    const picker = modelPicker({
      value: p.model || "",
      placeholder: "default model — type or press Find models",
      initialModels: p.models || [],
      getProvider: () => ({ provider: nameIn.value.trim() || p.name, base_url: urlIn.value.trim() || p.base_url, keyEnv: p.key_env }),
      keyEnv: p.key_env,
      onApiKey: () => askEnvValue(p.key_env),
    });

    body.append(
      field("Display name", nameIn),
      field("Server address (base URL)", urlIn, "Must start with http:// or https://"),
      field("Default model", picker.root, "Used when this custom provider is selected in Main AI.")
    );

    const saveBtn = el("button", { class: "primary", onclick: async () => {
      const provs = JSON.parse(JSON.stringify(STATE.config.custom_providers || []));
      const me = provs.find(x => x.name === p.name);
      if (!me) return;
      const oldHost = (me.base_url || "").replace(/^https?:\/\//, "").split("/")[0];
      me.name = nameIn.value.trim();
      me.base_url = urlIn.value.trim();
      if (picker.input.value.trim()) me.model = picker.input.value.trim();
      const newHost = me.base_url.replace(/^https?:\/\//, "").split("/")[0];
      if (newHost && newHost !== oldHost) {
        me.key_env = "HERMES_CUSTOM_" + newHost.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_API_KEY";
      }
      const r = await api("/api/providers", { body: { providers: provs } });
      if (r.ok) {
        toast("Custom provider saved ✓", "ok");
        closeModal();
        showPage("providers");
      } else {
        toast("Could not save: " + r.message, "err");
      }
    } }, "Save Changes");

    actions.append(el("button", { onclick: closeModal }, "Close"), saveBtn);
  });
}

function openProviderModelsModal(p) {
  openModal(`${p.icon || "🤖"} ${p.label || p.name} — Models & Speed`, (body, actions) => {
    const isMainAi = STATE.model && (STATE.model.provider === p.name);
    const keyInfo = resolveProviderKeyStatus(p);

    const picker = modelPicker({
      value: isMainAi ? (STATE.model?.default || "") : "",
      placeholder: "Model id — type or press Find models",
      initialModels: modelsFor(p.name),
      getProvider: () => ({ provider: p.name, base_url: p.base_url, keyEnv: keyInfo.keyEnv }),
      keyEnv: (keyInfo.keyNeeded && keyInfo.keyEnv) ? keyInfo.keyEnv : null,
      onApiKey: (keyInfo.keyNeeded && keyInfo.keyEnv) ? () => askEnvValue(keyInfo.keyEnv, p.keys) : null,
    });

    body.append(
      el("p", { class: "dim small", style: "margin-bottom:14px" }, p.desc || ""),
      field("Explore models", picker.root, "Find models retrieves live catalog. Test model sends a ping message, and Benchmark speed measures tokens/sec.")
    );

    const saveBtn = el("button", {
      class: "primary",
      onclick: async () => {
        const modelVal = picker.input.value.trim();
        saveBtn.disabled = true;
        let r = await api("/api/set", { body: { key: "model.provider", value: p.name } });
        if (r.ok !== false && modelVal) {
          r = await api("/api/set", { body: { key: "model.default", value: modelVal } });
        }
        if (r.ok) {
          toast(`Main AI provider set to ${p.label || p.name} ✓`, "ok");
          closeModal();
          await loadState();
          showPage("providers");
        } else {
          saveBtn.disabled = false;
          toast("Could not set provider: " + (r.message || "error saving provider"), "err");
        }
      }
    }, "Save Changes");

    actions.append(
      el("button", { onclick: closeModal }, "Close"),
      saveBtn
    );
  });
}

PAGES.providers = async function (page) {
  await loadState();

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "Providers"),
    el("p", { class: "pagesub" }, "All AI platforms and custom integrations presented as interactive cards. Configure credentials, explore models, and test speed."),
  );

  // Compile unified list of providers: Custom providers first, then Built-in providers
  const customItems = (STATE.custom_providers || []).map(p => ({
    ...p,
    custom: true,
    icon: "🔌",
    label: p.name || "Custom Provider",
    desc: "Custom OpenAI-compatible provider endpoint.",
    keys: p.key_env ? [p.key_env] : []
  }));

  const builtinItems = BUILTIN_PROVIDERS_INFO.map(p => ({
    ...p,
    custom: false
  }));

  const allProviders = [...customItems, ...builtinItems];

  // Active filter state
  let currentFilter = "all";
  let searchQuery = "";

  // Search & Filter Bar
  const searchInput = el("input", {
    type: "text",
    placeholder: "🔍 Filter providers by name, base URL, or API key…",
    style: "margin-bottom:12px;width:100%;"
  });

  const filterContainer = el("div", { class: "prov-filters" });
  const gridContainer = el("div", { class: "prov-grid" });

  function renderFilterButtons() {
    filterContainer.replaceChildren();

    const counts = {
      all: allProviders.length,
      custom: customItems.length,
      builtin: builtinItems.length,
      configured: allProviders.filter(p => resolveProviderKeyStatus(p).keySet).length
    };

    const filters = [
      { id: "all", label: `All (${counts.all})` },
      { id: "custom", label: `Custom (${counts.custom})` },
      { id: "builtin", label: `Built-in (${counts.builtin})` },
      { id: "configured", label: `Key Configured (${counts.configured})` }
    ];

    filters.forEach(f => {
      const btn = el("button", {
        type: "button",
        class: "prov-filter-btn" + (currentFilter === f.id ? " active" : ""),
        onclick: () => {
          currentFilter = f.id;
          renderFilterButtons();
          renderProviders();
        }
      }, f.label);
      filterContainer.append(btn);
    });
  }

  function renderProviders() {
    gridContainer.replaceChildren();

    const q = searchQuery.trim().toLowerCase();
    const filtered = allProviders.filter(p => {
      const keyInfo = resolveProviderKeyStatus(p);
      if (currentFilter === "custom" && !p.custom) return false;
      if (currentFilter === "builtin" && p.custom) return false;
      if (currentFilter === "configured" && !keyInfo.keySet) return false;

      if (!q) return true;
      const haystack = [
        p.name,
        p.label,
        p.base_url,
        p.desc,
        keyInfo.keyEnv || "",
        ...(p.keys || [])
      ].join(" ").toLowerCase();

      return haystack.includes(q);
    });

    if (!filtered.length) {
      gridContainer.append(
        el("div", { class: "card", style: "grid-column: 1 / -1; text-align:center;padding:32px 20px;" },
          el("p", { class: "dim", style: "margin:0;" },
            searchQuery ? `No providers matching “${searchQuery}”.` : "No providers found in this category.")
        )
      );
      return;
    }

    filtered.forEach(p => {
      const keyInfo = resolveProviderKeyStatus(p);
      const isMainAi = STATE.model && (STATE.model.provider === p.name);

      // Badge elements
      const badgeType = p.custom
        ? el("span", { class: "badge custom" }, "Custom")
        : el("span", { class: "badge standard" }, "Built-in");

      const badgeMain = isMainAi
        ? el("span", { class: "badge info" }, "Active Main AI")
        : null;

      let badgeKey;
      if (keyInfo.oauth) {
        badgeKey = el("span", { class: "badge info" }, "OAuth");
      } else if (!keyInfo.keyNeeded) {
        badgeKey = el("span", { class: "badge ok" }, "✓ Local / Free");
      } else if (keyInfo.keySet) {
        badgeKey = el("span", { class: "badge ok" }, "✓ Key Set");
      } else {
        badgeKey = el("span", { class: "badge miss" }, "✗ No Key");
      }

      const topRow = el("div", { class: "prov-card-top" },
        el("div", { class: "prov-card-title" },
          el("span", { style: "font-size:20px;" }, p.icon || "🤖"),
          el("span", {}, p.label || p.name)
        ),
        el("div", { class: "prov-card-badges" }, badgeType, badgeMain, badgeKey)
      );

      const desc = el("div", { class: "prov-card-desc" }, p.desc || "");

      // Endpoint pill with copy button
      const copyBtn = p.base_url ? el("button", {
        type: "button",
        class: "ghost",
        title: "Copy server endpoint",
        onclick: (e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(p.base_url).then(() => toast("Endpoint copied ✓", "ok", 2000));
        }
      }, "📋") : null;

      const endpointBox = el("div", { class: "prov-card-endpoint" },
        el("span", { title: p.base_url }, p.base_url || "OAuth"),
        copyBtn
      );

      // Card action footer
      const foot = el("div", { class: "prov-card-foot" });

      if (p.custom) {
        if (p.key_env) {
          foot.append(
            el("button", {
              type: "button",
              onclick: (e) => { e.stopPropagation(); askEnvValue(p.key_env); }
            }, "🔑 API Key")
          );
        }
        foot.append(
          el("button", {
            type: "button",
            class: "danger",
            title: "Delete custom provider",
            onclick: async (e) => {
              e.stopPropagation();
              if (!confirm(`Remove "${p.name}" from custom providers? (Its API key stays saved in .env)`)) return;
              const provs = (STATE.config.custom_providers || []).filter(x => x.name !== p.name);
              const r = await api("/api/providers", { body: { providers: provs } });
              if (r.ok) { toast("Provider removed ✓", "ok"); showPage("providers"); }
              else toast("Could not remove: " + r.message, "err");
            }
          }, "🗑️"),
          el("span", {
            class: "prov-open-hint",
            style: "margin-left:auto;font-size:12px;font-weight:600;color:var(--gold-text);display:flex;align-items:center;gap:3px;"
          }, "Edit Provider →")
        );
      } else {
        if (keyInfo.keyNeeded && keyInfo.keyEnv) {
          foot.append(
            el("button", {
              type: "button",
              class: keyInfo.keySet ? "" : "primary",
              onclick: (e) => { e.stopPropagation(); askEnvValue(keyInfo.keyEnv, p.keys); }
            }, "🔑 API Key")
          );
        }
        foot.append(
          el("button", {
            type: "button",
            class: isMainAi ? "ghost" : "primary",
            disabled: isMainAi,
            onclick: async (e) => {
              e.stopPropagation();
              const r = await api("/api/set", { body: { key: "model.provider", value: p.name } });
              if (r.ok) {
                toast(`Main AI provider set to ${p.label || p.name} ✓`, "ok");
                await loadState();
                showPage("providers");
              } else {
                toast("Could not switch provider: " + (r.message || "error switching provider"), "err");
              }
            }
          }, isMainAi ? "✓ Active" : "Use as Main AI"),
          el("span", {
            class: "prov-open-hint",
            style: "margin-left:auto;font-size:12px;font-weight:600;color:var(--gold-text);display:flex;align-items:center;gap:3px;"
          }, "Models & Speed →")
        );
      }

      const card = el("div", {
        class: "prov-card" + (isMainAi ? " is-active" : ""),
        onclick: () => {
          if (p.custom) openEditCustomModal(p);
          else openProviderModelsModal(p);
        }
      },
        topRow,
        desc,
        endpointBox,
        foot
      );
      gridContainer.append(card);
    });
  }

  // Setup search input handler
  searchInput.oninput = () => {
    searchQuery = searchInput.value;
    renderProviders();
  };

  renderFilterButtons();
  renderProviders();

  page.append(searchInput, filterContainer, gridContainer);

  /* Add Custom Provider Card */
  const aName = el("input", { type: "text", placeholder: "e.g. My-Ollama or TokenRouter" });
  const aUrl = el("input", { type: "text", placeholder: "http://localhost:11434/v1" });
  const aKey = el("input", { type: "password", placeholder: "leave empty if none needed" });
  page.append(card("Add a custom provider", "Connect any OpenAI-compatible server, vLLM, LM Studio, or custom proxy",
    el("div", { class: "row2" },
      field("Display name", aName),
      field("Server address (base URL)", aUrl, "Must start with http:// or https://")),
    field("API key (optional)", aKey, "Skip this for local servers like Ollama."),
    el("div", { class: "btnrow" },
      el("button", { class: "primary", onclick: async () => {
        const name = aName.value.trim(), url = aUrl.value.trim();
        if (!name) { toast("Give it a display name", "err"); return; }
        if (!/^https?:\/\//.test(url)) { toast("Server address must start with http:// or https://", "err"); return; }
        const provs = JSON.parse(JSON.stringify(STATE.config.custom_providers || []));
        const host = url.replace(/^https?:\/\//, "").split("/")[0];
        const keyEnv = "HERMES_CUSTOM_" + host.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_API_KEY";
        provs.push({ name, base_url: url, key_env: keyEnv, model: "", models: {}, models_discovered: false });
        if (aKey.value) await api("/api/env/set", { body: { key: keyEnv, value: aKey.value } });
        const r = await api("/api/providers", { body: { providers: provs } });
        if (r.ok) { toast("Custom provider added with [Custom] badge ✓", "ok", 6000); showPage("providers"); }
        else toast("Could not add: " + r.message, "err");
      } }, "+ Add Custom Provider")),
  ));
};

/* ---------------- BACKUP MODELS (FALLBACK) ---------------- */
PAGES.fallback = async function (page) {
  await loadState();
  
  // Parse rows defensively to avoid any empty provider or model issues
  const rows = (STATE.fallback_chain || []).map(e => {
    let p = e.provider || "";
    let m = e.model || "";
    if (!p && m && m.includes("/")) {
      const parts = m.split("/");
      p = parts[0];
      m = parts.slice(1).join("/");
    }
    return { provider: p || "openrouter", model: m };
  });

  const pickers = [];
  const listDiv = el("div");

  function draw() {
    listDiv.replaceChildren();
    pickers.length = 0;
    if (!rows.length) {
      listDiv.append(el("p", { class: "fb-empty" },
        "No backup models configured. If your main model fails (rate limit, server downtime), Hermes will stop. Add one or more backup models below."));
    }
    rows.forEach((r, i) => {
      // Ensure r.provider is guaranteed to be in the option list
      const allNames = providerNames(r.provider);
      const provSel = el("select", { style: "min-width:180px;" });
      
      allNames.forEach(p => {
        const bi = (typeof BUILTIN_PROVIDERS_INFO !== "undefined" ? BUILTIN_PROVIDERS_INFO : []).find(x => x.name === p);
        const icon = bi ? bi.icon : "🔌";
        const label = bi ? `${icon} ${bi.label || p}` : `${icon} ${p}`;
        provSel.append(el("option", { value: p }, label));
      });
      
      provSel.value = r.provider || "openrouter";
      if (!provSel.value && allNames.length) {
        provSel.selectedIndex = 0;
        r.provider = provSel.value;
      }

      provSel.onchange = () => {
        r.provider = provSel.value;
        const pk = pickers[i];
        if (pk) pk.setSuggestions(modelsFor(r.provider));
      };

      function resolveProvUrl(pName) {
        const cp = (STATE.custom_providers || []).find(p => p.name === pName);
        if (cp && cp.base_url) return cp.base_url;
        const bi = (typeof BUILTIN_PROVIDERS_INFO !== "undefined" ? BUILTIN_PROVIDERS_INFO : []).find(p => p.name === pName);
        return bi?.base_url || "";
      }

      const pk = modelPicker({
        value: r.model || "",
        placeholder: "model id — type or press Find models",
        initialModels: modelsFor(r.provider),
        getProvider: () => ({ provider: r.provider, base_url: resolveProvUrl(r.provider) }),
      });
      pk.input.onchange = () => { r.model = pk.input.value.trim(); };
      pickers[i] = pk;

      listDiv.append(el("div", { class: "fb-item" },
        el("span", { class: "num" }, String(i + 1) + "."),
        el("div", { class: "fb-line" },
          el("div", { class: "fb-prov" }, provSel),
          pk.root
        ),
        el("div", { class: "btnrow", style: "margin:0" },
          el("button", { class: "ghost", title: "Move up", onclick: () => { if (i > 0) { const t = rows[i - 1]; rows[i - 1] = rows[i]; rows[i] = t; draw(); } } }, "↑"),
          el("button", { class: "ghost", title: "Move down", onclick: () => { if (i < rows.length - 1) { const t = rows[i + 1]; rows[i + 1] = rows[i]; rows[i] = t; draw(); } } }, "↓"),
          el("button", { class: "danger", onclick: () => { rows.splice(i, 1); draw(); } }, "Remove")
        ),
      ));
    });
  }
  draw();

  const sb = saveBtn(null, async () => {
    const entries = rows.filter(r => r.provider && r.model).map(r => ({ provider: r.provider, model: r.model }));
    const r = await api("/api/fallback", { body: { entries } });
    if (r.ok) await loadState();
    return r;
  });

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "Backup Models"),
    el("p", { class: "pagesub" }, "If your main AI fails or hits rate limits, Hermes automatically falls back to these models in order, top to bottom."),
    card("Backup Order & Priority", "Models are attempted sequentially. You can change order or add alternative providers.",
      listDiv,
      el("div", { class: "btnrow" },
        el("button", { onclick: () => { rows.push({ provider: "openrouter", model: "" }); draw(); } }, "+ Add a backup model"),
        el("span", { style: "flex:1" }),
        sb.btn, sb.status),
    ),
  );
};

/* ---------------- TOOLS ---------------- */
let toolsPlatform = "cli";
let toolsCache = {};
let toolsFilter = "all"; // all, enabled, disabled

PAGES.tools = async function (page) {
  const platSel = el("select", {},
    ["cli", "telegram", "discord", "whatsapp", "slack", "signal", "teams", "google_chat"].map(p => el("option", { value: p }, p)));
  platSel.value = toolsPlatform;
  platSel.onchange = () => { toolsPlatform = platSel.value; toolsCache = {}; showPage("tools"); };

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "Agent Tools & Capabilities"),
    el("p", { class: "pagesub" }, "Control which tools Hermes can execute. Toggle switches save immediately and apply to your next session."),
    field("Show tools for platform", platSel, "cli = Terminal / Web UI. Others = Connected messaging bots."),
  );

  const box = el("div");
  page.append(box);
  if (!toolsCache[toolsPlatform]) {
    box.append(el("div", { class: "loading" }, "Loading tools…"));
    const r = await api("/api/tools?platform=" + toolsPlatform);
    toolsCache[toolsPlatform] = r;
  }
  const data = toolsCache[toolsPlatform];
  box.replaceChildren();
  if (!data.ok) {
    box.append(card("Could not load tools", "", el("p", { class: "red" }, data.message || "unknown error")));
    return;
  }

  const allTools = (data.tools || []).slice();
  
  // Search and Filter controls
  const searchInput = el("input", {
    type: "text",
    placeholder: "🔍 Search tools (e.g. bash, web, file, memory)…",
    style: "flex:1;min-width:200px;"
  });

  const tabAll = el("button", { class: "speed-preset-btn active" }, "All (" + allTools.length + ")");
  const tabEnabled = el("button", { class: "speed-preset-btn" }, "Enabled (" + allTools.filter(t => t.enabled).length + ")");
  const tabDisabled = el("button", { class: "speed-preset-btn" }, "Disabled (" + allTools.filter(t => !t.enabled).length + ")");

  const tabs = [tabAll, tabEnabled, tabDisabled];
  function setTab(tab, mode) {
    toolsFilter = mode;
    tabs.forEach(t => t.classList.toggle("active", t === tab));
    renderToolList();
  }
  tabAll.onclick = () => setTab(tabAll, "all");
  tabEnabled.onclick = () => setTab(tabEnabled, "enabled");
  tabDisabled.onclick = () => setTab(tabDisabled, "disabled");

  const filterRow = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;" },
    searchInput,
    el("div", { style: "display:flex;gap:6px;" }, tabAll, tabEnabled, tabDisabled)
  );

  const toolsListContainer = el("div");

  function renderToolList() {
    toolsListContainer.replaceChildren();
    const q = searchInput.value.trim().toLowerCase();
    
    const visible = allTools.filter(t => {
      if (toolsFilter === "enabled" && !t.enabled) return false;
      if (toolsFilter === "disabled" && t.enabled) return false;
      if (q && !t.name.toLowerCase().includes(q) && !(t.desc || "").toLowerCase().includes(q)) return false;
      return true;
    });

    // Update tab counts
    tabAll.textContent = "All (" + allTools.length + ")";
    tabEnabled.textContent = "Enabled (" + allTools.filter(t => t.enabled).length + ")";
    tabDisabled.textContent = "Disabled (" + allTools.filter(t => !t.enabled).length + ")";

    if (!visible.length) {
      toolsListContainer.append(el("div", { class: "dim", style: "padding:24px 10px;text-align:center;" },
        allTools.length ? "No tools match your filter." : "No tools found for this platform."));
      return;
    }

    visible.forEach(t => {
      const tgl = el("label", { class: "tgl" });
      const inp = el("input", { type: "checkbox", checked: t.enabled });
      inp.onchange = async () => {
        const action = inp.checked ? "enable" : "disable";
        const r = await api("/api/tools", { body: { action, name: t.name, platform: toolsPlatform } });
        if (r.ok) {
          t.enabled = inp.checked;
          toast((inp.checked ? "Enabled " : "Disabled ") + t.name + " ✓", "ok");
          toolsCache = {};
          renderToolList();
        } else {
          toast("Could not save: " + r.message, "err", 7000);
          inp.checked = !inp.checked;
        }
      };
      tgl.append(inp, el("span", { class: "knob" }));

      toolsListContainer.append(
        el("div", { class: "toolrow" },
          el("span", { class: "t-emoji" }, t.icon || "🔧"),
          el("div", {},
            el("div", { class: "t-name" }, t.name),
            el("div", { class: "t-desc" }, t.desc || "")),
          tgl
        )
      );
    });
  }

  searchInput.oninput = renderToolList;
  renderToolList();

  // Bulk actions
  const bulkBar = el("div", { class: "btnrow", style: "margin-top:14px;padding-top:12px;border-top:1px solid var(--line-subtle);" },
    el("button", { onclick: async () => {
      const targets = allTools.filter(t => !t.enabled);
      if (!targets.length) { toast("All tools are already enabled ✓", "ok"); return; }
      for (const t of targets) {
        await api("/api/tools", { body: { action: "enable", name: t.name, platform: toolsPlatform } });
        t.enabled = true;
      }
      toolsCache = {};
      toast("Enabled all " + targets.length + " tools ✓", "ok");
      renderToolList();
    } }, "Enable All"),
    el("button", { onclick: async () => {
      const targets = allTools.filter(t => t.enabled);
      if (!targets.length) { toast("All tools are already disabled ✓", "ok"); return; }
      if (!confirm("Disable all " + targets.length + " tools for " + toolsPlatform + "?")) return;
      for (const t of targets) {
        await api("/api/tools", { body: { action: "disable", name: t.name, platform: toolsPlatform } });
        t.enabled = false;
      }
      toolsCache = {};
      toast("Disabled all tools ✓", "ok");
      renderToolList();
    } }, "Disable All"),
  );

  const c = card("Available Tools", "Toggle switches to enable or disable tools for Hermes.",
    filterRow,
    toolsListContainer,
    bulkBar
  );
  box.append(c);
};

/* ---------------- AGENT ---------------- */
PAGES.agent = async function (page) {
  await loadState();
  const cfg = STATE.config || {};
  const agent = cfg.agent || {};
  const mem = cfg.memory || {};
  const comp = cfg.compression || {};

  const maxTurns = el("input", { type: "number", value: agent.max_turns ?? 90, min: 1, max: 500 });
  const effortSel = el("select", {},
    ["minimal", "low", "medium", "high"].map(x => el("option", { value: x }, x)));
  effortSel.value = agent.reasoning_effort || "medium";

  const sb1 = saveBtn(null, async () => {
    const r = await api("/api/set", { body: { key: "agent.max_turns", value: String(maxTurns.value) } });
    if (r.ok !== false && effortSel.value !== (agent.reasoning_effort || "medium")) {
      return api("/api/set", { body: { key: "agent.reasoning_effort", value: effortSel.value } });
    }
    return r;
  });

  const memLimit = el("input", { type: "number", value: mem.memory_char_limit ?? 2200, min: 200, max: 20000 });
  const sb2 = saveBtn(null, async () =>
    api("/api/set", { body: { key: "memory.memory_char_limit", value: String(memLimit.value) } }));

  const compTh = el("input", { type: "number", value: comp.threshold ?? 0.5, min: 0.1, max: 0.95, step: 0.05 });
  const compTr = el("input", { type: "number", value: comp.target_ratio ?? 0.2, min: 0.05, max: 0.9, step: 0.05 });
  const sb3 = saveBtn(null, async () => {
    let r = await api("/api/set", { body: { key: "compression.threshold", value: String(compTh.value) } });
    if (r.ok !== false) r = await api("/api/set", { body: { key: "compression.target_ratio", value: String(compTr.value) } });
    return r;
  });

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "Agent Behavior"),
    el("p", { class: "pagesub" }, "Control how much thinking Hermes does and what it remembers."),

    card("Thinking", "How hard Hermes works on each answer.",
      field("Maximum steps per task (max_turns)", maxTurns,
        "How many tool actions Hermes may take in one task. Higher = can do longer jobs, but can also spend more."),
      field("Reasoning effort", effortSel,
        "low = fast and cheap, high = slow and thorough."),
      el("div", { class: "savebar" }, sb1.btn, sb1.status)),

    card("Memory", "What Hermes remembers between conversations.",
      settingToggle("Remember things about me", "Hermes saves useful facts to memory and recalls them later.",
        mem.memory_enabled !== false, async on => {
          const r = await api("/api/set", { body: { key: "memory.memory_enabled", value: on } });
          toast(r.ok ? "Saved ✓" : "Could not save: " + r.message, r.ok ? "ok" : "err");
        }),
      settingToggle("Keep a profile about me", "Stores your name, preferences and how you like replies.",
        !!mem.user_profile_enabled, async on => {
          const r = await api("/api/set", { body: { key: "memory.user_profile_enabled", value: on } });
          toast(r.ok ? "Saved ✓" : "Could not save: " + r.message, r.ok ? "ok" : "err");
        }),
      el("div", { style: "margin-top:14px" },
        field("Memory size limit (characters)", memLimit, "Bigger = remembers more, uses more space in each chat."),
        el("div", { class: "savebar" }, sb2.btn, sb2.status))),

    card("Long-chat handling", "When a conversation gets very long, Hermes summarizes it to stay within the AI's memory.",
      settingToggle("Auto-summarize long chats", "Recommended: on.",
        comp.enabled !== false, async on => {
          const r = await api("/api/set", { body: { key: "compression.enabled", value: on } });
          toast(r.ok ? "Saved ✓" : "Could not save: " + r.message, r.ok ? "ok" : "err");
        }),
      el("div", { style: "margin-top:14px" },
        el("div", { class: "row2" },
          field("Start summarizing when chat is this full", compTh, "0.5 = when 50% of memory is used."),
          field("Shrink down to", compTr, "0.2 = summarize to 20% of memory.")),
        el("div", { class: "savebar" }, sb3.btn, sb3.status))),
  );
};

/* ---------------- DISPLAY & VOICE ---------------- */
PAGES.display = async function (page) {
  await loadState();
  const d = STATE.config?.display || {};
  const stt = STATE.config?.stt || {};
  const tts = STATE.config?.tts || {};

  const iface = el("select", {},
    el("option", { value: "cli" }, "Normal terminal (cli)"),
    el("option", { value: "tui" }, "Full-screen terminal app (tui)"));
  iface.value = d.interface || "cli";
  const skinIn = el("input", { type: "text", value: d.skin || "default" });
  const langIn = el("input", { type: "text", value: d.language || "", placeholder: "leave empty for English" });
  const sb1 = saveBtn(null, async () => {
    let r = await api("/api/set", { body: { key: "display.interface", value: iface.value } });
    if (r.ok !== false) r = await api("/api/set", { body: { key: "display.skin", value: skinIn.value.trim() || "default" } });
    if (r.ok !== false) {
      if (langIn.value.trim()) r = await api("/api/set", { body: { key: "display.language", value: langIn.value.trim() } });
      else r = await api("/api/unset", { body: { key: "display.language" } });
    }
    return r;
  });

  const sttProv = el("select", {},
    el("option", { value: "local" }, "On my computer (free)"),
    el("option", { value: "groq" }, "Groq (needs API key)"),
    el("option", { value: "openai" }, "OpenAI (needs API key)"),
    el("option", { value: "mistral" }, "Mistral (needs API key)"));
  sttProv.value = stt.provider || "local";
  const sb2 = saveBtn(null, async () => {
    let r = await api("/api/set", { body: { key: "stt.provider", value: sttProv.value } });
    if (r.ok !== false) r = await api("/api/set", { body: { key: "stt.enabled", value: sttEnabledCheck.checked } });
    return r;
  });
  const sttEnabledCheck = el("input", { type: "checkbox", checked: stt.enabled !== false });

  const ttsProv = el("select", {},
    el("option", { value: "edge" }, "Edge voices (free, built-in)"),
    el("option", { value: "openai" }, "OpenAI (needs API key)"),
    el("option", { value: "elevenlabs" }, "ElevenLabs (needs API key)"),
    el("option", { value: "gemini" }, "Google Gemini (needs API key)"),
    el("option", { value: "neutts" }, "NeuTTS (free, on my computer)"),
    el("option", { value: "piper" }, "Piper (free, on my computer)"));
  ttsProv.value = tts.provider || "edge";
  const sb3 = saveBtn(null, async () =>
    api("/api/set", { body: { key: "tts.provider", value: ttsProv.value } }));

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "Display & Voice"),
    el("p", { class: "pagesub" }, "How Hermes looks in your terminal, and how it speaks and listens."),

    card("Look & feel", "",
      field("How Hermes opens", iface),
      field("Theme (skin)", skinIn, "Type a theme name. 'default' is the normal one."),
      field("Language", langIn, "Example: ms for Malay, id for Indonesian, zh for Chinese."),
      settingToggle("Show thinking steps", "Display the AI's reasoning as it works.",
        !!d.show_reasoning, async on => {
          const r = await api("/api/set", { body: { key: "display.show_reasoning", value: on } });
          toast(r.ok ? "Saved ✓" : "Could not save: " + r.message, r.ok ? "ok" : "err");
        }),
      settingToggle("Stream text as it's written", "Words appear one by one instead of waiting for the full answer.",
        d.streaming !== false, async on => {
          const r = await api("/api/set", { body: { key: "display.streaming", value: on } });
          toast(r.ok ? "Saved ✓" : "Could not save: " + r.message, r.ok ? "ok" : "err");
        }),
      el("div", { class: "savebar" }, sb1.btn, sb1.status)),

    card("Voice messages → text (STT)", "When you send a voice note, Hermes writes it out before answering.",
      el("div", { class: "setting-row" },
        el("div", {},
          el("div", { class: "s-label" }, "Turn on voice transcription"),
          el("div", { class: "s-desc" }, "Needed on chat apps like Telegram/WhatsApp.")),
        (() => { const t = el("label", { class: "tgl" }); t.append(sttEnabledCheck, el("span", { class: "knob" })); return t; })()),
      field("Speech recognition by", sttProv),
      el("div", { class: "savebar" }, sb2.btn, sb2.status)),

    card("Text → voice (TTS)", "Make Hermes answer out loud with /voice commands.",
      field("Voice service", ttsProv),
      el("div", { class: "savebar" }, sb3.btn, sb3.status)),
  );
};

/* ---------------- TERMINAL ---------------- */
PAGES.terminal = async function (page) {
  await loadState();
  const t = STATE.config?.terminal || {};
  const g = STATE.config?.tool_loop_guardrails || {};

  const cwdIn = el("input", { type: "text", value: t.cwd ?? ".", placeholder: "." });
  const toIn = el("input", { type: "number", value: t.timeout ?? 180, min: 5, max: 3600 });
  const sb = saveBtn(null, async () => {
    let r = await api("/api/set", { body: { key: "terminal.cwd", value: cwdIn.value.trim() || "." } });
    if (r.ok !== false) r = await api("/api/set", { body: { key: "terminal.timeout", value: String(toIn.value) } });
    return r;
  });

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "Terminal"),
    el("p", { class: "pagesub" }, "Settings for when Hermes runs commands on your computer."),

    card("Command settings", "",
      field("Folder where commands start", cwdIn, "'.' means: wherever you opened Hermes from."),
      field("Stop commands after (seconds)", toIn, "Commands that take longer get cut off."),
      el("div", { class: "savebar" }, sb.btn, sb.status)),

    card("Safety guards", "Stop Hermes if it gets stuck repeating the same failing action.",
      settingToggle("Warn when actions keep failing", "Hermes tells you it seems stuck.",
        g.warnings_enabled !== false, async on => {
          const r = await api("/api/set", { body: { key: "tool_loop_guardrails.warnings_enabled", value: on } });
          toast(r.ok ? "Saved ✓" : "Could not save: " + r.message, r.ok ? "ok" : "err");
        }),
      settingToggle("Force-stop after too many failures", "Hard limit — Hermes stops completely.",
        !!g.hard_stop_enabled, async on => {
          const r = await api("/api/set", { body: { key: "tool_loop_guardrails.hard_stop_enabled", value: on } });
          toast(r.ok ? "Saved ✓" : "Could not save: " + r.message, r.ok ? "ok" : "err");
        })),
  );
};

/* ================================================================
   TELEGRAM BOT
================================================================ */
PAGES.telegram = async function (page) {
  const st = await api("/api/telegram/status");

  const wrap = el("div");
  wrap.append(
    el("h1", { class: "pagetitle" }, "Telegram Bot"),
    el("p", { class: "pagesub" }, "Chat with Hermes from your phone. This page walks you through everything — no terminal needed."),
  );

  /* ---- status strip ---- */
  const gw = st.gateway_running;
  const statCard = el("div", { class: "card" },
    el("h2", {}, "Status"),
    el("div", { class: "setting-row" },
      el("div", {},
        el("div", { class: "s-label" }, "Bot token"),
        el("div", { class: "s-desc" }, st.token_set ? "Saved (" + st.token_masked + ")" : "Not set yet — step 1 below")),
      st.token_set
        ? el("span", { class: "badge ok" }, "saved")
        : el("span", { class: "badge miss" }, "missing")),
    el("div", { class: "setting-row" },
      el("div", {},
        el("div", { class: "s-label" }, "Allowed users"),
        el("div", { class: "s-desc" }, st.allowed_users.length
          ? st.allowed_users.join(", ")
          : "Nobody yet — without this, anyone who finds your bot can use it")),
      st.allowed_users.length
        ? el("span", { class: "badge ok" }, st.allowed_users.length + " user(s)")
        : el("span", { class: "badge miss" }, "none")),
    el("div", { class: "setting-row" },
      el("div", {},
        el("div", { class: "s-label" }, "Gateway (the background runner that connects Telegram)"),
        el("div", { class: "s-desc" }, gw ? "Running — your bot should answer messages" : "Not running — start it below after saving your token")),
      gw
        ? el("span", { class: "badge ok" }, "running")
        : el("span", { class: "badge miss" }, "stopped")),
  );
  wrap.append(statCard);

  /* ---- guided setup card ---- */
  const stepNote = (n, text) => el("li", {},
    el("b", {}, n + ". "), text);
  wrap.append(card("How to get your bot token (5 minutes, one time only)", "Do this in the Telegram app itself — this page can't do it for you.",
    el("ol", { style: "margin:0;padding-left:22px;line-height:1.9" },
      stepNote("open", "In Telegram, open a chat with ", el("b", {}, "@BotFather"), " (t.me/BotFather) — the official bot maker."),
      stepNote("create", "Send ", el("span", { class: "mono" }, "/newbot"), ". Pick any display name, then a username ending in ", el("span", { class: "mono" }, "bot"), " (e.g. ", el("span", { class: "mono" }, "my_hermes_bot"), ")."),
      stepNote("copy", "BotFather replies with a token like ", el("span", { class: "mono" }, "123456789:ABCdefGHI…"), " — copy it."),
      stepNote("id", "Message ", el("b", {}, "@userinfobot"), " — it replies with your numeric user ID (like 123456789). Copy that too — you'll paste both below."),
    ),
    el("p", { class: "small dim", style: "margin:10px 0 0" },
      "Tip: also send ", el("span", { class: "mono" }, "/setcommands"), " to BotFather to give your bot a tidy / menu (help, new, sethome)."),
  ));

  /* ---- token + users form ---- */
  const tokenIn = el("input", { type: "password", placeholder: st.token_set ? "(saved — paste a new one to replace)" : "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" });
  const usersIn = el("input", { type: "text", value: st.allowed_users.join(", "), placeholder: "123456789, 987654321 (comma-separated numbers)" });
  const homeIn = el("input", { type: "text", value: st.home_channel || "", placeholder: "leave empty — your private chat is used automatically" });

  const verifyOut = el("div", { class: "mp-status", hidden: true });
  const verifyBtn = el("button", { onclick: async () => {
    verifyBtn.disabled = true;
    verifyOut.hidden = false;
    verifyOut.className = "mp-status dim";
    verifyOut.textContent = "Asking Telegram if this token is real…";
    const r = await api("/api/telegram/verify", { body: { token: tokenIn.value.trim() } });
    if (r.ok) {
      verifyOut.className = "mp-status ok";
      verifyOut.textContent = "✓ This is a real bot: @" + r.bot_username + " (" + (r.bot_name || "unnamed") + ")";
    } else {
      verifyOut.className = "mp-status err";
      verifyOut.textContent = "✗ " + (r.message || "Telegram did not accept this token");
    }
    verifyBtn.disabled = false;
  } }, "✅ Check token with Telegram");

  const sb = saveBtn(null, async () => {
    if (!tokenIn.value.trim() && !usersIn.value.trim() && !homeIn.value.trim()) {
      return { ok: true, message: "nothing to save" };
    }
    return api("/api/telegram/save", { body: {
      token: tokenIn.value.trim(),
      allowed_users: usersIn.value.trim(),
      home_channel: homeIn.value.trim(),
    } });
  });

  wrap.append(card("Connect your bot", "Paste the token and your user ID from the steps above.",
    field("Bot token (from @BotFather)", tokenIn,
      "Anyone with this token controls your bot — it's stored in .env, never shown in full."),
    field("Allowed user IDs", usersIn,
      "Only these people can talk to your bot. Get each person's ID from @userinfobot. Leave empty = anyone can use it (not recommended)."),
    field("Home channel (optional)", homeIn,
      "Where Hermes sends scheduled-task results. Empty = your private chat with the bot."),
    el("div", { class: "btnrow" }, verifyBtn),
    verifyOut,
    el("div", { class: "savebar" }, sb.btn, sb.status),
  ));

  /* ---- gateway control ---- */
  const instCount = st.gateway_instance_count ?? (st.gateway_pids || []).length;
  const gwOut = el("pre", { class: "codeblock", hidden: true });
  const gwBtnRow = el("div", { class: "btnrow" },
    el("button", { class: "primary", onclick: async (ev) => {
      const btn = ev.target.closest("button");
      btn.disabled = true;
      btn.textContent = "Starting… (up to 30s)";
      const r = await api("/api/gateway/start", { body: {} });
      btn.disabled = false;
      btn.textContent = "▶ Start gateway (brings the bot online)";
      toast(r.ok ? "Gateway started — give it ~10 seconds, then message your bot on Telegram." : "Could not start: " + r.message,
            r.ok ? "ok" : "err", 10000);
      showPage("telegram");
    } }, "▶ Start gateway (brings the bot online)"),
    el("button", { class: "danger", onclick: async (ev) => {
      const btn = ev.target.closest("button");
      btn.disabled = true;
      const r = await api("/api/gateway/stop", { body: {} });
      btn.disabled = false;
      toast(r.ok ? "Gateway stopped." : "Could not stop: " + r.message, r.ok ? "ok" : "err");
      showPage("telegram");
    } }, "■ Stop gateway"),
    el("button", { onclick: async () => {
      gwOut.hidden = false;
      gwOut.textContent = "Loading log…";
      const r = await api("/api/gateway/logs");
      gwOut.textContent = r.tail || r.text || r.message || "(empty)";
    } }, "📄 View gateway log"),
  );
  const dupWarning = instCount > 1
    ? el("div", { class: "note", style: "border-color:#d48989;background:#fdeeee;color:#7c2d2d" },
        el("b", {}, "⚠ " + instCount + " gateway instances are running. "),
        "Two gateways fight over your bot and Telegram silently drops messages. ",
        el("button", { style: "margin-left:6px", onclick: async (ev) => {
          ev.target.disabled = true;
          const r = await api("/api/gateway/killdupes", { body: {} });
          toast(r.message || "done", r.ok ? "ok" : "err", 10000);
          showPage("telegram");
        } }, "Stop all duplicates"),
        " then press Start gateway.")
    : null;
  wrap.append(card("Gateway control", "The gateway is the background program that keeps your bot connected to Telegram.",
    gw ? el("p", { class: "small green", style: "margin:0 0 10px" }, "✓ Gateway is running" + (instCount === 1 ? " (one instance — healthy)." : " (" + instCount + " instances — see warning below)."))
       : el("p", { class: "small red", style: "margin:0 0 10px" }, "Gateway is not running. Save your token first, then press Start."),
    dupWarning || "",
    gwBtnRow, gwOut));

  /* ---- usage tips ---- */
  wrap.append(card("Once it's running", "things you can do in Telegram",
    el("ul", { style: "margin:0;padding-left:20px;line-height:1.9" },
      el("li", {}, "Send any message to your bot — Hermes replies, with all its tools."),
      el("li", {}, "Voice messages are auto-transcribed (works best with ", el("b", {}, "Display & Voice → Speech to text"), " enabled)."),
      el("li", {}, el("span", { class: "mono" }, "/new"), " starts a fresh chat · ", el("span", { class: "mono" }, "/model"), " switches AI · ", el("span", { class: "mono" }, "/personality"), " changes style."),
      el("li", {}, "Add it to a group and @mention it — tell us if you want group settings and we'll wire them here."),
      el("li", {}, "Windows note: the gateway runs as a background window. To auto-start on login, run ", el("span", { class: "mono" }, "hermes gateway install"), " once in a terminal."),
    )));

  page.replaceChildren(...wrap.children);
};

/* ================================================================
   MCP SERVERS
================================================================ */
PAGES.mcp = async function (page) {
  const st = await api("/api/mcp/state");
  const servers = {};  // name -> {transport, url, command, args, env}
  for (const s of st.servers || []) {
    servers[s.name] = {
      transport: s.transport,
      url: s.url || "",
      command: s.command || "",
      args: (s.args || []).join(" "),
      env: {},
    };
  }

  const wrap = el("div");
  wrap.append(
    el("h1", { class: "pagetitle" }, "MCP Servers"),
    el("p", { class: "pagesub" }, "Plug extra tools into Hermes — GitHub, Notion, Airtable, databases, anything built on the Model Context Protocol. Changes apply after restarting Hermes or the gateway."),
  );

  const listDiv = el("div");

  function serverCard(name, cfg, isNew) {
    const body = el("div", { class: "prov-body", hidden: !isNew });
    const nameIn = el("input", { type: "text", value: isNew ? "" : name, placeholder: "short-name (letters, numbers, - and _)" });
    const transportSel = el("select", {},
      el("option", { value: "stdio" }, "Local program (stdio) — runs a command on this computer"),
      el("option", { value: "http" }, "Online server (HTTP) — connect to a URL"));
    transportSel.value = cfg.transport || "stdio";
    const urlIn = el("input", { type: "text", value: cfg.url, placeholder: "https://example.com/mcp" });
    const cmdIn = el("input", { type: "text", value: cfg.command, placeholder: "npx" });
    const argsIn = el("input", { type: "text", value: cfg.args, placeholder: "-y @modelcontextprotocol/server-github" });
    const envIn = el("textarea", { placeholder: "One KEY=VALUE per line — e.g. GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…  (leave empty if not needed)" });

    const syncTrans = () => {
      const isHttp = transportSel.value === "http";
      urlIn.parentElement.hidden = !isHttp;
      cmdIn.parentElement.hidden = isHttp;
      argsIn.parentElement.hidden = isHttp;
      envIn.parentElement.hidden = isHttp;
    };
    transportSel.onchange = syncTrans;

    const testOut = el("div", { class: "mp-status", hidden: true });
    body.append(
      isNew
        ? field("Server name", nameIn, "Used as the tool prefix — e.g. github → tools named mcp_github_*")
        : el("div", { class: "row2" },
            field("Server name", el("input", { type: "text", value: name, disabled: true })),
            el("div")),
      field("How does it connect?", transportSel),
      field("Server URL", urlIn, "The address ending in /mcp that the provider gives you."),
      field("Command", cmdIn, "The program that runs the server — usually npx (Node) or uvx (Python)."),
      field("Arguments", argsIn, "Copied from the server's install instructions. -y means auto-install."),
      field("Secret keys for this server (env)", envIn,
        "Keys stay inside the server's own config — Hermes does NOT hand it your other API keys."),
      el("div", { class: "btnrow" },
        el("button", { class: "primary", onclick: async () => {
          const nm = isNew ? nameIn.value.trim() : name;
          if (!/^[A-Za-z0-9_\-]+$/.test(nm)) { toast("Name: letters, numbers, - and _ only", "err"); return; }
          const entry = {};
          if (transportSel.value === "http") {
            if (!/^https?:\/\//.test(urlIn.value.trim())) { toast("URL must start with http:// or https://", "err"); return; }
            entry.url = urlIn.value.trim();
          } else {
            if (!cmdIn.value.trim()) { toast("Command is required for local servers", "err"); return; }
            entry.command = cmdIn.value.trim();
            entry.args = argsIn.value.trim() ? argsIn.value.trim().split(/\s+/) : [];
            const envLines = envIn.value.trim();
            if (envLines) {
              const env = {};
              for (const line of envLines.split("\n")) {
                const i = line.indexOf("=");
                if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
              }
              if (Object.keys(env).length) entry.env = env;
            }
          }
          const payload = JSON.parse(JSON.stringify(servers));
          delete payload[name];  // in case of rename
          payload[nm] = entry;
          const r = await api("/api/mcp/save", { body: { servers: payload } });
          if (r.ok) { toast("Saved " + nm + " ✓ Restart Hermes or the gateway to load its tools.", "ok", 8000); showPage("mcp"); }
          else toast("Could not save: " + r.message, "err", 8000);
        } }, isNew ? "Add server" : "Save changes"),
        !isNew ? el("button", { onclick: async () => {
          testOut.hidden = false;
          testOut.className = "mp-status dim";
          testOut.textContent = "Connecting to '" + name + "'…";
          const r = await api("/api/mcp/test", { body: { name } });
          testOut.className = r.ok ? "mp-status ok" : "mp-status err";
          testOut.textContent = (r.stdout || r.stderr || r.message || "").trim().split("\n").slice(0, 8).join("\n");
        } }, "🔌 Test connection") : null,
        !isNew ? el("button", { class: "danger", onclick: async () => {
          if (!confirm("Remove server '" + name + "'?")) return;
          const payload = JSON.parse(JSON.stringify(servers));
          delete payload[name];
          const r = await api("/api/mcp/save", { body: { servers: payload } });
          if (r.ok) { toast("Removed " + name + " ✓", "ok"); showPage("mcp"); }
          else toast("Could not remove: " + r.message, "err");
        } }, "Delete") : null,
      ),
      testOut,
    );
    syncTrans();

    const head = el("div", { class: "prov-head", onclick: () => { body.hidden = !body.hidden; } },
      el("span", { class: "p-name" }, name),
      el("span", { class: "p-url" }, cfg.transport === "http" ? cfg.url : (cfg.command + " " + cfg.args).trim()),
      cfg.transport === "http" ? el("span", { class: "badge info" }, "online") : el("span", { class: "badge info" }, "local"),
      el("span", { class: "chev" }, "▾"));
    return el("div", { class: "prov-item" }, head, body);
  }

  for (const [name, cfg] of Object.entries(servers)) {
    listDiv.append(serverCard(name, cfg, false));
  }
  if (!Object.keys(servers).length) {
    listDiv.append(el("p", { class: "dim", style: "margin:0 0 4px" },
      "No MCP servers yet. Pick one from the catalog below (one click), or add your own at the bottom."));
  }

  /* catalog */
  const cat = st.catalog || [];
  if (cat.length) {
    const catList = el("div", { class: "mpd-list", style: "max-height:220px" });
    for (const c of cat) {
      const btn = el("button", { }, "Install");
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "installing…";
        const r = await api("/api/mcp/install", { body: { name: c.name } });
        btn.disabled = false;
        btn.textContent = "Install";
        if (r.ok) { toast("Installed " + c.name + " ✓ Restart Hermes or the gateway to load its tools.", "ok", 8000); showPage("mcp"); }
        else toast("Could not install: " + (r.message || r.stderr || "unknown"), "err", 9000);
      };
      catList.append(el("div", { class: "toolrow" },
        el("span", { class: "t-name" }, c.name),
        el("span", { class: "t-desc" }, c.desc),
        btn));
    }
    wrap.append(card("One-click catalog (Nous-approved servers)", "Click Install — Hermes connects and adds it for you.",
      catList));
  }

  /* add-your-own */
  listDiv.append(el("h3", { style: "margin:18px 0 8px;font-size:14px" }, "Add your own server"));
  listDiv.append(serverCard(null, { transport: "stdio" }, true));

  wrap.append(card("Your servers", "Saved in config.yaml → mcp_servers. Tools appear as mcp_<name>_<tool> after restart.",
    listDiv));

  page.replaceChildren(...wrap.children);
};


PAGES.advanced = async function (page) {
  await loadState();

  /* set any key */
  const kIn = el("input", { type: "text", placeholder: "e.g. approvals.mode" });
  const vIn = el("textarea", { placeholder: "value — text, or a JSON list/object" });

  const rawPre = el("pre", { class: "codeblock" }, "Press the button to load your config file.");

  page.replaceChildren(
    el("h1", { class: "pagetitle" }, "Advanced"),
    el("p", { class: "pagesub" }, "For power users. Everything else on this panel already covers the common settings — be careful here."),

    card("Change any setting by name", "Works exactly like typing: hermes config set <name> <value>",
      field("Setting name", kIn, "Dotted path, like agent.max_turns or approvals.mode"),
      field("New value", vIn, "Empty box = remove the setting. true/false and numbers are understood automatically."),
      el("div", { class: "btnrow" },
        el("button", { class: "primary", onclick: async () => {
          if (!kIn.value.trim()) { toast("Type a setting name first", "err"); return; }
          let val = vIn.value;
          const tr = val.trim();
          if (tr && (tr.startsWith("[") || tr.startsWith("{"))) {
            try { val = JSON.parse(tr); } catch {}
          }
          const r = await api("/api/set", { body: { key: kIn.value.trim(), value: val } });
          if (r.ok) { toast("Saved ✓ " + (r.stdout || "").split("\n")[0], "ok"); await loadState(); }
          else toast("Could not save: " + r.message, "err", 8000);
        } }, "Save"),
        el("button", { class: "danger", onclick: async () => {
          if (!kIn.value.trim()) { toast("Type a setting name first", "err"); return; }
          if (!confirm("Remove setting " + kIn.value.trim() + "?")) return;
          const r = await api("/api/unset", { body: { key: kIn.value.trim() } });
          if (r.ok) { toast("Removed ✓", "ok"); await loadState(); }
          else toast("Could not remove: " + r.message, "err");
        } }, "Remove setting"))),

    card("View config file", "Read-only. Your settings as Hermes sees them.",
      el("div", { class: "btnrow", style: "margin-bottom:12px" },
        el("button", { onclick: async () => {
          const r = await api("/api/raw");
          rawPre.textContent = r.text || r.error || "";
        } }, "Load config.yaml"),
        el("button", { onclick: () => {
          navigator.clipboard?.writeText(rawPre.textContent).then(() => toast("Copied ✓", "ok"));
        } }, "Copy")),
      rawPre),

    card("Fixes & backups", "",
      el("div", { class: "btnrow" },
        el("button", { onclick: async () => {
          toast("Running hermes doctor — this takes a minute…");
          const r = await api("/api/doctor");
          openModal("hermes doctor report", r.stdout || r.stderr || "(no output)");
        } }, "Health check (doctor)"),
        el("button", { onclick: async () => {
          const r = await api("/api/backup", { body: {} });
          if (r.ok) toast("Backup saved ✓ " + (r.stdout || "").split("\n")[0], "ok", 8000);
          else toast("Backup failed: " + r.message, "err");
        } }, "Create backup"),
      )),
  );
};

/* ================================================================
   CHAT — talk to the real Hermes agent from the browser.
   Each send runs `hermes chat` as a subprocess with session resume,
   so the full agent (tools, memory, skills) is behind every reply.
================================================================ */
const CHAT = {
  session_id: null,       // active chat session (null = fresh start)
  messages: [],          // [{role, content, t?}]
  busy: false,
  loaded_from: null,      // sidebar session id currently displayed
};

/* ---------------- chat markdown parser ---------------- */
function renderChatMarkdown(raw) {
  if (!raw) return el("div", { class: "bubble-text" });
  const container = el("div", { class: "bubble-text" });

  // 1. Extract triple-backtick code blocks and replace with placeholders
  const codeBlocks = [];
  const textWithPlaceholders = String(raw).replace(/```([a-zA-Z0-9_\-\.\+]*)[ \t]*\r?\n([\s\S]*?)\r?\n\s*```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim() || "code", code: code.replace(/\r?\n$/, "") });
    return `\n%%CODEBLOCK_${idx}%%\n`;
  });

  // 2. Helper to apply inline formatting with HTML escaping
  function inlineFormat(str) {
    let s = esc(str);
    // Bold: **text** or __text__
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__(.*?)__/g, "<strong>$1</strong>");
    // Strikethrough: ~~text~~
    s = s.replace(/~~(.*?)~~/g, "<del>$1</del>");
    // Italic: *text* or _text_
    s = s.replace(/\*([^\*]+)\*/g, "<em>$1</em>");
    s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
    // Inline code: `code`
    s = s.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    // Links: [label](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }

  // 3. Process lines
  const lines = textWithPlaceholders.split(/\r?\n/);
  let currentList = null;
  let currentBlockquote = null;
  let currentP = null;

  function flushBlock() {
    if (currentList) { container.append(currentList.el); currentList = null; }
    if (currentBlockquote) { container.append(currentBlockquote); currentBlockquote = null; }
    if (currentP) {
      if (currentP.childNodes.length > 0) container.append(currentP);
      currentP = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for code block placeholder
    const codeMatch = trimmed.match(/^%%CODEBLOCK_(\d+)%%$/);
    if (codeMatch) {
      flushBlock();
      const item = codeBlocks[parseInt(codeMatch[1], 10)];
      if (item) {
        const card = el("div", { class: "chat-code-card" });
        const copyBtn = el("button", {
          class: "chat-code-copy-btn",
          title: "Copy code to clipboard",
          onclick: (e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(item.code).then(() => {
              copyBtn.textContent = "✓ Copied";
              setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 2000);
            });
          }
        }, "📋 Copy");

        const header = el("div", { class: "chat-code-header" },
          el("span", { class: "chat-code-lang" }, item.lang),
          copyBtn
        );
        const pre = el("pre", { class: "chat-code-pre" }, el("code", {}, item.code));
        card.append(header, pre);
        container.append(card);
      }
      continue;
    }

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      flushBlock();
      container.append(el("hr", { class: "chat-hr" }));
      continue;
    }

    // Headings
    const h3Match = trimmed.match(/^###\s+(.*)$/);
    if (h3Match) {
      flushBlock();
      const h = el("h5", {});
      h.innerHTML = inlineFormat(h3Match[1]);
      container.append(h);
      continue;
    }
    const h2Match = trimmed.match(/^##\s+(.*)$/);
    if (h2Match) {
      flushBlock();
      const h = el("h4", {});
      h.innerHTML = inlineFormat(h2Match[1]);
      container.append(h);
      continue;
    }
    const h1Match = trimmed.match(/^#\s+(.*)$/);
    if (h1Match) {
      flushBlock();
      const h = el("h3", {});
      h.innerHTML = inlineFormat(h1Match[1]);
      container.append(h);
      continue;
    }

    // Blockquote
    const bqMatch = trimmed.match(/^>\s?(.*)$/);
    if (bqMatch) {
      if (!currentBlockquote) {
        flushBlock();
        currentBlockquote = el("blockquote", {});
      } else {
        currentBlockquote.append(document.createElement("br"));
      }
      const span = el("span", {});
      span.innerHTML = inlineFormat(bqMatch[1]);
      currentBlockquote.append(span);
      continue;
    } else if (currentBlockquote) {
      container.append(currentBlockquote);
      currentBlockquote = null;
    }

    // Unordered list: - or *
    const ulMatch = line.match(/^(\s*)[-\*]\s+(.*)$/);
    if (ulMatch) {
      if (!currentList || currentList.type !== "ul") {
        flushBlock();
        currentList = { type: "ul", el: el("ul", {}) };
      }
      const li = el("li", {});
      li.innerHTML = inlineFormat(ulMatch[2]);
      currentList.el.append(li);
      continue;
    }

    // Ordered list: 1. 2.
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olMatch) {
      if (!currentList || currentList.type !== "ol") {
        flushBlock();
        currentList = { type: "ol", el: el("ol", {}) };
      }
      const li = el("li", {});
      li.innerHTML = inlineFormat(olMatch[2]);
      currentList.el.append(li);
      continue;
    }

    // Table: lines starting and ending with |
    if (/^\|(.+)\|\s*$/.test(trimmed)) {
      // Collect all contiguous table lines
      const tableLines = [];
      let ti = i;
      while (ti < lines.length) {
        const tl = lines[ti].trim();
        if (/^\|(.+)\|\s*$/.test(tl)) {
          tableLines.push(tl);
          ti++;
        } else break;
      }
      if (tableLines.length >= 2) {
        flushBlock();
        const table = el("table", { class: "chat-table" });
        // Determine if row 2 is a separator (|---|---|)
        const isSep = /^\|[\s\-:|]+\|$/.test(tableLines[1]);
        const startRow = isSep ? 2 : 0;
        // Build header from first row
        const thead = el("thead", {});
        const headerCells = tableLines[0].split("|").filter((_, ci, arr) => ci > 0 && ci < arr.length - 1);
        const headTr = el("tr", {});
        headerCells.forEach(cell => {
          const th = el("th", {});
          th.innerHTML = inlineFormat(cell.trim());
          headTr.append(th);
        });
        thead.append(headTr);
        table.append(thead);
        // Build body
        if (startRow < tableLines.length) {
          const tbody = el("tbody", {});
          for (let ri = startRow; ri < tableLines.length; ri++) {
            const cells = tableLines[ri].split("|").filter((_, ci, arr) => ci > 0 && ci < arr.length - 1);
            const tr = el("tr", {});
            cells.forEach(cell => {
              const td = el("td", {});
              td.innerHTML = inlineFormat(cell.trim());
              tr.append(td);
            });
            tbody.append(tr);
          }
          table.append(tbody);
        }
        const tableWrap = el("div", { class: "chat-table-wrap" });
        tableWrap.append(table);
        container.append(tableWrap);
        i = ti - 1; // skip processed lines
        continue;
      }
    }

    // Empty line
    if (!trimmed) {
      flushBlock();
      continue;
    }

    // Normal paragraph text
    if (currentList) {
      flushBlock();
    }
    if (!currentP) {
      currentP = el("p", {});
    } else {
      currentP.append(document.createElement("br"));
    }
    const textSpan = el("span", {});
    textSpan.innerHTML = inlineFormat(line);
    currentP.append(textSpan);
  }

  flushBlock();
  return container;
}

PAGES.chat = async function (page) {
  const wrap = el("div", { class: "chat-wrap" });

  /* ---- stats HUD (model · context bar · folder · timings) ---- */
  const hud = el("div", { class: "chat-hud" });
  let hudTimer = null;          // live "generating…" stopwatch
  let hudData = { model: null, context_length: null, provider: null };

  function shortPath(p) {
    if (!p) return "—";
    p = String(p).replace(/\\/g, "/");
    const parts = p.split("/").filter(Boolean);
    if (parts.length <= 3) return p;
    return "…" + parts.slice(-2).join("/");
  }
  function fmtTok(n) {
    if (n == null) return "—";
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
    return String(n);
  }
  function fmtDur(s) {
    if (s == null) return "—";
    if (s < 60) return s.toFixed(1) + "s";
    const tot = Math.round(s);
    if (tot < 3600) {
      const m = Math.floor(tot / 60), r = tot % 60;
      return m + "m" + String(r).padStart(2, "0") + "s";
    }
    if (tot < 86400) {
      const h = Math.floor(tot / 3600), rem = tot % 3600;
      const m = Math.floor(rem / 60);
      return h + "h " + String(m).padStart(2, "0") + "m";
    }
    const d = Math.floor(tot / 86400), rem = tot % 86400;
    const h = Math.floor(rem / 3600);
    return d + "d" + (h > 0 ? " " + h + "h" : "");
  }
  function hudModel() { return hudData.model || CHAT.stats?.model || "—"; }
  function hudCtx() { return hudData.context_length || CHAT.stats?.context_length; }

  function renderHud(gen) {
    const st = CHAT.stats || {};
    const ctx = hudCtx();
    let used = st.context_tokens != null ? st.context_tokens : null;
    if (used == null && CHAT.messages && CHAT.messages.length) {
      const chars = CHAT.messages.reduce((acc, m) => acc + (m.content ? m.content.length : 0) + 60, 0);
      used = Math.round((chars + 3) / 4);
    }
    const pct = used != null && ctx ? Math.min(100, Math.round((used / ctx) * 100)) : null;

    // Top Bar Left: Model chip + provider tag + CWD
    const model = hudModel();
    const modelChip = el("div", { class: "hud-chip hud-model-chip", title: model },
      el("span", {}, "🤖"),
      el("span", { class: "hud-model-name" }, model)
    );
    const provName = (st.provider !== undefined ? st.provider : hudData.provider) || "";
    const providerTag = provName ? el("span", { class: "hud-provider-tag", title: "Active Provider: " + provName }, "via " + provName) : null;
    const cwdChip = st.cwd ? el("div", { class: "hud-chip hud-cwd-chip", title: "Workspace: " + st.cwd },
      el("span", {}, "📁"),
      el("span", {}, shortPath(st.cwd))
    ) : null;

    const identityCluster = el("div", { class: "hud-identity" }, modelChip, providerTag, cwdChip);

    // Top Bar Right: Stats or live timer + action buttons
    let statusPills;
    if (hudTimer) { clearInterval(hudTimer); hudTimer = null; }
    if (gen) {
      const liveText = el("span", {}, "Generating… 0.0s");
      const t0 = performance.now();
      hudTimer = setInterval(() => {
        liveText.textContent = "Generating… " + ((performance.now() - t0) / 1000).toFixed(1) + "s";
      }, 100);
      statusPills = el("div", { class: "hud-live-pill" },
        el("span", { class: "hud-pulse-dot" }),
        liveText
      );
    } else {
      const turns = CHAT.messages.filter(m => m.role === "assistant" && m.dur != null).map(m => m.dur);
      const lastDur = turns.length ? turns[turns.length - 1] : null;
      const sessDur = st.session_started_at ? (st.session_ended_at || Date.now() / 1000) - st.session_started_at : null;

      const group = el("div", { class: "hud-stat-group" });
      if (lastDur != null) group.append(el("span", { class: "hud-stat-pill", title: "Last reply duration" }, "⚡ " + fmtDur(lastDur)));
      if (sessDur != null) group.append(el("span", { class: "hud-stat-pill", title: "Total session elapsed time" }, "⏱️ " + fmtDur(sessDur)));
      if (st.tool_calls != null && st.tool_calls > 0) group.append(el("span", { class: "hud-stat-pill", title: "Tool calls executed in this session" }, "🛠️ " + st.tool_calls));
      if (st.message_count != null && st.message_count > 0) group.append(el("span", { class: "hud-stat-pill", title: "Messages in conversation" }, "💬 " + st.message_count));
      statusPills = group;
    }

    const newChatBtn = el("button", {
      class: "hud-btn",
      title: "Start a fresh conversation",
      onclick: () => startFreshChat()
    }, "➕ New");

    function updateToggleBtn() {
      const isMobile = window.innerWidth <= 768;
      const isCol = isMobile ? !side.classList.contains("open") : side.classList.contains("collapsed");
      toggleBtn.title = isCol ? "Open Chats sidebar" : "Close Chats sidebar";
      toggleBtn.replaceChildren(
        el("span", { class: "hud-toggle-label" }, "Chats"),
        el("span", { class: "hud-toggle-icon" }, isCol ? "◀" : "▶")
      );
    }

    const toggleBtn = el("button", {
      class: "hud-btn hud-toggle-btn",
      onclick: () => {
        if (window.innerWidth <= 768) {
          side.classList.toggle("open");
        } else {
          side.classList.toggle("collapsed");
        }
        updateToggleBtn();
      }
    });
    updateToggleBtn();

    const actionsCluster = el("div", { class: "hud-actions" }, statusPills, newChatBtn, toggleBtn);
    const topBar = el("div", { class: "hud-bar-top" }, identityCluster, actionsCluster);

    // Bottom Row: Context Gauge
    let ctxRow = null;
    if (ctx) {
      let badgeClass = "badge-safe";
      let badgeText = "Safe";
      let meterClass = "meter-safe";
      if (pct >= 90) {
        badgeClass = "badge-alert";
        badgeText = pct >= 100 ? "Limit Reached" : "Almost Full";
        meterClass = "meter-alert";
      } else if (pct >= 70) {
        badgeClass = "badge-warn";
        badgeText = "High Usage";
        meterClass = "meter-warn";
      }

      ctxRow = el("div", { class: "hud-ctx-row" },
        el("div", { class: "hud-ctx-info" },
          el("span", { class: "hud-ctx-label" }, "Context:"),
          el("span", { class: "hud-ctx-badge " + badgeClass }, badgeText)
        ),
        el("div", { class: "hud-meter-wrap", title: "Session tokens: " + (used != null ? fmtTok(used) : "—") + " / " + fmtTok(ctx) + " (" + (pct || 0) + "%)" },
          el("div", { class: "hud-meter-track" },
            el("div", { class: "hud-meter-fill " + meterClass, style: "width:" + Math.min(100, pct || 0) + "%" })
          )
        ),
        el("div", { class: "hud-ctx-nums" },
          el("strong", {}, used != null ? fmtTok(used) : "—"),
          el("span", {}, "/ " + fmtTok(ctx)),
          el("span", {}, "· " + (pct != null ? pct + "%" : "0%"))
        ),
        el("button", {
          class: "hud-compress-btn" + ((pct || 0) >= 50 ? " high-pressure" : ""),
          title: "Summarize earlier messages to reclaim context (Hermes /compress)",
          onclick: () => openCompressModal()
        }, "🗜️ Compress")
      );
    }

    hud.replaceChildren(topBar);
    if (ctxRow) hud.append(ctxRow);
  }

  async function refreshHud() {
    try {
      const r = await api("/api/chat/stats" + (CHAT.session_id ? "?session=" + encodeURIComponent(CHAT.session_id) : ""));
      if (r.ok) {
        CHAT.stats = r;
        hudData.model = r.model; hudData.context_length = r.context_length; hudData.provider = r.provider;
      }
    } catch {}
    renderHud(CHAT.busy);
  }

  /* ---- message pane ---- */
  const msgs = el("div", { class: "chat-msgs" });
  const typing = el("div", { class: "chat-typing", hidden: true },
    el("span", { class: "dots" }, el("span", {}, "●"), el("span", {}, "●"), el("span", {}, "●")),
    " ✨ Hermes is thinking & executing tools…"
  );

  function createPromptCard(title, promptText) {
    const card = el("div", { class: "chat-prompt-card" },
      el("b", {}, title),
      el("span", {}, promptText)
    );
    card.onclick = () => {
      ta.value = promptText;
      ta.focus();
      ta.dispatchEvent(new Event("input"));
    };
    return card;
  }

  function renderMsgs() {
    msgs.replaceChildren();
    if (!CHAT.messages.length) {
      const hero = el("div", { class: "chat-empty-hero" },
        el("img", { class: "chat-empty-avatar", src: "/hermes_icon.ico", alt: "Hermes" }),
        el("div", { class: "chat-empty-title" }, "Chat with Hermes Agent"),
        el("div", { class: "chat-empty-sub" }, "Direct access to the Hermes CLI engine with full tools, terminal execution, memory, and skills right in your browser."),
        el("div", { class: "chat-prompts-grid" },
          createPromptCard("🔍 Inspect Workspace", "What files and services are currently active in this workspace?"),
          createPromptCard("⚡ Model Diagnostics", "Which model and provider are currently active in Main AI?"),
          createPromptCard("🛠️ Test Tools", "Run a diagnostic check on available tools and terminal permissions."),
          createPromptCard("💡 Hermes Capabilities", "Summarize your agent capabilities and recent workflows.")
        )
      );
      msgs.append(hero);
      return;
    }

    for (const m of CHAT.messages) {
      if (m.role === "error") {
        msgs.append(el("div", { class: "bubble err" }, "⚠️ " + m.content));
        continue;
      }
      const meta = [];
      if (m.t) meta.push(new Date(m.t * 1000).toLocaleTimeString());
      if (m.dur != null) meta.push("⚡ " + fmtDur(m.dur));

      const copyAction = el("button", {
        class: "ghost",
        style: "padding:2px 7px;font-size:11px;margin-left:auto;border:none;cursor:pointer;",
        onclick: (e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(m.content).then(() => toast("Message copied ✓", "ok", 2000));
        }
      }, "📋 Copy");

      const metaRow = el("div", { class: "meta", style: "display:flex;align-items:center;gap:6px;" },
        el("span", {}, meta.join(" · ")),
        copyAction
      );

      if (m.role === "assistant") {
        const avatar = el("img", {
          class: "assistant-avatar",
          src: "/hermes_icon.ico",
          alt: "Hermes",
          title: "Hermes Agent"
        });
        const parsedBody = renderChatMarkdown(m.content);
        const contentBox = el("div", { class: "bubble-content" },
          parsedBody,
          metaRow
        );
        const b = el("div", { class: "bubble assistant" }, avatar, contentBox);
        msgs.append(b);
      } else {
        const textDiv = el("div", { class: "bubble-text", style: "white-space:pre-wrap;" }, m.content);
        const b = el("div", { class: "bubble user" },
          textDiv,
          metaRow
        );
        msgs.append(b);
      }
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  /* ---- input composer ---- */
  const ta = el("textarea", { placeholder: "Message Hermes… (Enter to send · Shift+Enter for new line)" });
  ta.rows = 1;
  ta.oninput = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(180, Math.max(44, ta.scrollHeight)) + "px";
  };
  const sendBtn = el("button", { class: "composer-btn-send", title: "Send message (Enter)" }, "Send ➤");
  const newBtn = el("button", { class: "composer-btn-new", title: "Start a fresh chat" }, "＋ New Chat");

  async function loadSessionById(sid) {
    if (!sid) return;
    try {
      const h = await api("/api/chat/history?session=" + encodeURIComponent(sid));
      if (!h.ok) return;
      CHAT.session_id = sid;
      CHAT.messages = h.messages.map(m => ({ role: m.role, content: m.content, t: m.t }));
      for (let i = 1; i < CHAT.messages.length; i++) {
        const m = CHAT.messages[i];
        if (m.role === "assistant" && m.t != null) {
          let u = i - 1;
          while (u >= 0 && CHAT.messages[u].role !== "user") u--;
          const um = u >= 0 ? CHAT.messages[u] : null;
          if (um && um.t != null && m.t >= um.t) m.dur = Math.round((m.t - um.t) * 10) / 10;
        }
      }
      CHAT.loaded_from = sid;
      try { await refreshHud(); } catch {}
      renderMsgs();
      renderSessionList();
    } catch {}
  }

  function openCompressModal() {
    if (CHAT.busy) { toast("Agent is currently busy. Please wait.", "warn"); return; }
    if (!CHAT.session_id) { toast("Select or start a conversation first.", "warn"); return; }

    const st = CHAT.stats || {};
    const count = st.message_count || (CHAT.messages ? CHAT.messages.length : 0);
    const ctxUsed = st.context_tokens != null ? fmtTok(st.context_tokens) : (CHAT.messages ? fmtTok(Math.round(CHAT.messages.reduce((a, m) => a + (m.content ? m.content.length : 0) + 60, 0) / 4)) : "—");
    const ctxLimit = fmtTok(hudCtx() || 0);

    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal-card compress-modal" });

    const titleRow = el("div", { class: "modal-title-row" },
      el("div", { class: "modal-title" }, "🗜️ Compress Conversation Context"),
      el("button", { class: "modal-close-btn", title: "Close modal", onclick: () => backdrop.remove() }, "✕")
    );

    const infoCard = el("div", { class: "compress-info-card" },
      el("div", { class: "compress-stat-row" },
        el("span", {}, "Active Messages"),
        el("strong", {}, count + " msgs")
      ),
      el("div", { class: "compress-stat-row" },
        el("span", {}, "Context Pressure"),
        el("strong", {}, ctxUsed + " / " + ctxLimit + " tokens")
      )
    );

    let warningNotice = null;
    if (count <= 10) {
      warningNotice = el("div", { class: "compress-notice-box" },
        "ℹ️ This conversation is short (" + count + " msgs). Hermes protects recent messages by default. Choose 'Aggressive (Keep last 2 only)' below if you want to force summarizing."
      );
    }

    const descText = el("p", { class: "compress-desc" },
      "Hermes summarizes earlier messages and tool results into a structured handoff note, freeing up context window while keeping your recent exchanges intact."
    );

    const modeSelect = el("select", { class: "compress-select" },
      el("option", { value: "" }, "Standard Compression (keeps recent ~20 exchanges)"),
      el("option", { value: "here 2" }, "Aggressive Compression (keeps only last 2 exchanges)")
    );

    const focusInput = el("input", {
      type: "text",
      class: "compress-focus-input",
      placeholder: "Focus topic (optional, e.g. 'bug fix' or 'auth')"
    });

    const statusArea = el("div", { class: "compress-status-area", hidden: true });

    const cancelBtn = el("button", { class: "hud-btn", onclick: () => backdrop.remove() }, "Cancel");
    const runBtn = el("button", { class: "compress-submit-btn" }, "Compress Now");

    runBtn.onclick = async () => {
      let args = modeSelect.value;
      const focus = focusInput.value.trim();
      if (focus) {
        args = (args ? args + " " : "") + focus;
      }

      runBtn.disabled = true;
      cancelBtn.disabled = true;
      modeSelect.disabled = true;
      focusInput.disabled = true;

      statusArea.hidden = false;
      statusArea.className = "compress-status-area";
      statusArea.replaceChildren(
        el("span", { class: "compress-spinner" }),
        el("span", {}, " Hermes is summarizing conversation history…")
      );

      try {
        const r = await api("/api/chat/compress", {
          body: { session_id: CHAT.session_id, args: args }
        });

        if (r.ok) {
          const out = r.output || "Compression complete.";
          statusArea.className = "compress-status-area success";
          statusArea.innerHTML = "<b>✓ Completed</b><pre class='compress-pre'></pre>";
          statusArea.querySelector("pre").textContent = out;

          if (r.session_id) {
            CHAT.session_id = r.session_id;
          }
          await loadSessionById(CHAT.session_id);
          refreshSidebar();
          toast("Context compressed successfully!", "ok");

          runBtn.textContent = "Done";
          runBtn.disabled = false;
          runBtn.onclick = () => backdrop.remove();
          cancelBtn.remove();
        } else {
          statusArea.className = "compress-status-area error";
          statusArea.textContent = "✕ " + (r.message || "Compression failed.");
          runBtn.disabled = false;
          cancelBtn.disabled = false;
          modeSelect.disabled = false;
          focusInput.disabled = false;
        }
      } catch (err) {
        statusArea.className = "compress-status-area error";
        statusArea.textContent = "✕ Error: " + err.message;
        runBtn.disabled = false;
        cancelBtn.disabled = false;
        modeSelect.disabled = false;
        focusInput.disabled = false;
      }
    };

    const actionsRow = el("div", { class: "modal-actions-row" }, cancelBtn, runBtn);

    modal.append(
      titleRow,
      infoCard,
      warningNotice || "",
      descText,
      el("label", { class: "compress-field-label" }, "Compression Strategy:"),
      modeSelect,
      el("label", { class: "compress-field-label" }, "Topic Focus (optional):"),
      focusInput,
      statusArea,
      actionsRow
    );

    backdrop.append(modal);
    document.body.append(backdrop);
    backdrop.onclick = (e) => { if (e.target === backdrop && !runBtn.disabled) backdrop.remove(); };
  }

  async function runCompression(rawArgs = "") {
    if (CHAT.busy) return;
    if (!CHAT.session_id) {
      toast("Select or start a conversation first before compressing.", "warn");
      return;
    }
    CHAT.busy = true;
    sendBtn.disabled = true;
    typing.hidden = false;
    typing.innerHTML = '<span class="compress-spinner"></span> 🗜️ Summarizing & compressing conversation to reclaim context…';
    msgs.scrollTop = msgs.scrollHeight;
    try {
      const r = await api("/api/chat/compress", { body: {
        session_id: CHAT.session_id, args: rawArgs } });
      typing.hidden = true;
      if (r.ok) {
        if (r.session_id) {
          CHAT.session_id = r.session_id;
        }
        await loadSessionById(CHAT.session_id);
        toast("Context compressed successfully!", "ok");
      } else {
        CHAT.messages.push({ role: "error", content: "Compression failed: " + (r.message || "unknown error") });
        toast(r.message || "Compression failed", "err");
      }
    } catch (e) {
      CHAT.messages.push({ role: "error", content: "Compression error: " + e.message });
      toast(e.message, "err");
    } finally {
      typing.hidden = true;
      typing.innerHTML = '<span class="dots"><span>●</span><span>●</span><span>●</span></span> ✨ Hermes is thinking & executing tools…';
      if (hudTimer) { clearInterval(hudTimer); hudTimer = null; }
      CHAT.busy = false;
      sendBtn.disabled = false;
      renderMsgs();
      refreshSidebar();
      refreshHud();
    }
  }

  async function send() {
    const text = ta.value.trim();
    if (!text || CHAT.busy) return;
    ta.value = "";
    ta.style.height = "auto";

    // Slash command interception for /compact and /compress
    if (/^\/(compact|compress)(\s|$)/i.test(text)) {
      const subArgs = text.replace(/^\/(compact|compress)\s*/i, "");
      CHAT.messages.push({ role: "user", content: text });
      renderMsgs();
      msgs.scrollTop = msgs.scrollHeight;
      await runCompression(subArgs);
      return;
    }

    CHAT.busy = true;
    sendBtn.disabled = true;
    CHAT.messages.push({ role: "user", content: text });
    renderMsgs();
    typing.hidden = false;
    renderHud(true);
    msgs.scrollTop = msgs.scrollHeight;
    try {
      const r = await api("/api/chat/send", { body: {
        message: text, session_id: CHAT.session_id || "" } });
      typing.hidden = true;
      if (r.ok) {
        if (r.session_id) CHAT.session_id = r.session_id;
        const last = { role: "assistant", content: r.reply || "(empty reply)", t: Date.now() / 1000 };
        if (typeof r.duration_s === "number") last.dur = r.duration_s;
        if (typeof r.reply_s === "number") last.dur = r.reply_s;   // authoritative from db
        CHAT.messages.push(last);
        CHAT.loaded_from = CHAT.session_id;
        if (r.session_id && r.reply_s === undefined) {
          // db rows may lag a moment; pull authoritative stats once
          try {
            const st = await api("/api/chat/stats?session=" + encodeURIComponent(r.session_id));
            if (st.ok && typeof st.reply_s === "number") last.dur = st.reply_s;
          } catch {}
        }
        refreshSidebar();
        refreshHud();
      } else {
        CHAT.messages.push({ role: "error", content: r.message || "unknown error" });
      }
    } catch (e) {
      typing.hidden = true;
      CHAT.messages.push({ role: "error", content: e.message });
    } finally {
      typing.hidden = true;
      if (hudTimer) { clearInterval(hudTimer); hudTimer = null; }
      CHAT.busy = false;
      sendBtn.disabled = false;
      renderMsgs();
      refreshHud();
      ta.focus();
    }
  }

  sendBtn.onclick = send;
  ta.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  async function startFreshChat() {
    if (CHAT.busy) return;
    await api("/api/chat/new", { body: {} });
    CHAT.session_id = null;
    CHAT.messages = [];
    CHAT.loaded_from = null;
    CHAT.stats = null;
    refreshHud();
    renderMsgs();
    refreshSidebar();
    toast("Started a fresh chat ✓", "ok");
    ta.focus();
  }
  newBtn.onclick = startFreshChat;

  const composerBox = el("div", { class: "composer-box" }, ta);
  const sideToggleBtn = el("button", { class: "composer-btn-side-toggle", title: "Recent chats" }, "💬");
  sideToggleBtn.onclick = () => {
    side.classList.toggle("open");
  };
  const composerToolbar = el("div", { class: "composer-toolbar" },
    el("div", { class: "composer-hints" },
      el("span", { class: "composer-hint-chip" }, "↵ Send"),
      el("span", { class: "composer-hint-chip" }, "Shift+↵ New line")
    ),
    el("div", { class: "composer-actions" }, sideToggleBtn, newBtn, sendBtn)
  );
  const inputbar = el("div", { class: "chat-composer" }, composerBox, composerToolbar);

  /* ---- sidebar: recent sessions with search filter ---- */
  const side = el("div", { class: "chat-side" });
  let sessionHistoryData = [];
  let currentSearchQuery = "";

  const sideCount = el("span", { class: "chat-side-count" }, "0");
  const sideCloseBtn = el("button", {
    class: "chat-side-close-btn",
    title: "Close",
    onclick: () => {
      if (window.innerWidth <= 768) {
        side.classList.remove("open");
      } else {
        side.classList.add("collapsed");
        updateToggleBtn();
      }
    }
  }, "✕");
  const sideNewChatBtn = el("button", {
    class: "chat-side-new-btn",
    title: "New Chat",
    onclick: () => {
      startFreshChat();
      if (window.innerWidth <= 768) side.classList.remove("open");
    }
  }, "＋");
  const sideHeader = el("div", { class: "chat-side-header" },
    el("div", { class: "chat-side-title" },
      el("span", {}, "💬"),
      el("span", {}, "Recent Chats"),
      sideCount
    ),
    el("div", { class: "chat-side-actions" }, sideNewChatBtn, sideCloseBtn)
  );
  const searchInput = el("input", {
    type: "search",
    class: "chat-search-input",
    placeholder: "Search chats…"
  });
  searchInput.oninput = () => {
    currentSearchQuery = searchInput.value.trim().toLowerCase();
    renderSessionList();
  };
  const searchWrap = el("div", { class: "chat-search-wrap" },
    el("span", { class: "chat-search-icon" }, "🔍"),
    searchInput
  );
  const sessListContainer = el("div", { id: "sess-list" });
  const sideCard = el("div", { class: "card" }, sideHeader, searchWrap, sessListContainer);
  side.append(sideCard);

  function renderSessionList() {
    sessListContainer.replaceChildren();
    let filtered = sessionHistoryData;
    if (currentSearchQuery) {
      filtered = sessionHistoryData.filter(s =>
        (s.title && s.title.toLowerCase().includes(currentSearchQuery)) ||
        (s.source && s.source.toLowerCase().includes(currentSearchQuery))
      );
    }
    sideCount.textContent = String(filtered.length);

    if (!filtered.length) {
      sessListContainer.append(el("div", { style: "padding:16px 8px;font-size:12px;color:var(--muted);text-align:center;" },
        currentSearchQuery ? "No chats match query" : "No recent chats found"
      ));
      return;
    }

    for (const s of filtered) {
      const btn = el("button", { class: "sess-item" + (s.id === CHAT.session_id ? " active" : "") },
        el("div", { class: "s-title", title: s.title }, s.title),
        el("div", { class: "s-sub" },
          el("span", {}, `${s.messages} msgs · ${ago(s.last)}`),
          el("span", { class: "sess-item-tag" }, s.source)
        )
      );
      btn.onclick = async () => {
        if (CHAT.busy) { toast("Wait for current reply first", "err"); return; }
        const h = await api("/api/chat/history?session=" + encodeURIComponent(s.id));
        if (!h.ok) { toast("Could not load: " + h.message, "err"); return; }
        CHAT.session_id = s.id;
        CHAT.messages = h.messages.map(m => ({ role: m.role, content: m.content, t: m.t }));
        for (let i = 1; i < CHAT.messages.length; i++) {
          const m = CHAT.messages[i];
          if (m.role === "assistant" && m.t != null) {
            let u = i - 1;
            while (u >= 0 && CHAT.messages[u].role !== "user") u--;
            const um = u >= 0 ? CHAT.messages[u] : null;
            if (um && um.t != null && m.t >= um.t) m.dur = Math.round((m.t - um.t) * 10) / 10;
          }
        }
        CHAT.loaded_from = s.id;
        try { await refreshHud(); } catch {}
        renderMsgs();
        renderSessionList();
        // Auto-close sidebar on mobile after selecting a chat
        if (window.innerWidth <= 768) side.classList.remove("open");
      };
      sessListContainer.append(btn);
    }
  }

  async function refreshSidebar() {
    try {
      const r = await api("/api/chat/history");
      if (!r.ok) { sessListContainer.textContent = r.message; return; }
      sessionHistoryData = r.sessions || [];
      renderSessionList();
    } catch (e) { sessListContainer.textContent = "error: " + e.message; }
  }

  function ago(ts) {
    const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  wrap.append(el("div", { class: "chat-main" }, hud, msgs, typing, inputbar), side);
  page.replaceChildren(wrap);
  await refreshSidebar();
  if (CHAT.session_id) {
    await loadSessionById(CHAT.session_id);
  }
  await refreshHud();
  renderMsgs();
  ta.focus();
};

/* ---------------- speed benchmark modal ---------------- */
function openSpeedBenchmarkModal(provider, baseUrl, model, initialTestType = "standard") {
  let currentType = initialTestType || "standard";
  let running = false;

  openModal("⚡ Speed Benchmark — " + model, (body, actions) => {
    const wrap = el("div", { class: "speed-wrap" });

    // Preset selector buttons
    const presetsBar = el("div", { class: "speed-presets" });
    presetsBar.append(el("span", { class: "speed-presets-label" }, "Test Length:"));

    const presetDefs = [
      { id: "quick", label: "⚡ Quick (~80 tok)", desc: "Fast responsive test" },
      { id: "standard", label: "⚡ Standard (~180 tok)", desc: "Standard benchmark" },
      { id: "heavy", label: "⚡ Heavy (~350 tok)", desc: "Sustained throughput" },
    ];

    const presetBtns = [];
    presetDefs.forEach(p => {
      const b = el("button", {
        type: "button",
        class: "speed-preset-btn" + (p.id === currentType ? " active" : ""),
        onclick: () => {
          if (running) return;
          currentType = p.id;
          presetBtns.forEach(pb => pb.classList.toggle("active", pb.dataset.type === p.id));
          runBenchmark();
        }
      }, p.label);
      b.dataset.type = p.id;
      presetBtns.push(b);
      presetsBar.append(b);
    });

    const contentArea = el("div", { class: "speed-content" });
    wrap.append(presetsBar, contentArea);
    body.append(wrap);

    const runAgainBtn = el("button", {
      class: "primary",
      onclick: () => runBenchmark()
    }, "⚡ Run Again");
    const closeBtn = el("button", { onclick: closeModal }, "Close");
    actions.append(runAgainBtn, closeBtn);

    async function runBenchmark() {
      if (running) return;
      running = true;
      runAgainBtn.disabled = true;
      presetBtns.forEach(b => b.disabled = true);

      contentArea.replaceChildren(
        el("div", { class: "speed-loading" },
          el("div", { class: "speed-spinner" }),
          el("div", { style: "font-weight:600;font-size:14px;color:var(--ink)" }, "Benchmarking " + model + "…"),
          el("div", { class: "dim small" }, "Measuring TTFT latency, streaming tokens per second (TPS), and rate-limit headers…")
        )
      );

      try {
        const r = await api("/api/probe/speed", {
          body: {
            provider: provider || "",
            base_url: baseUrl || "",
            model: model,
            test_type: currentType
          }
        });

        if (!r.ok) {
          contentArea.replaceChildren(
            el("div", { class: "speed-diag err" },
              el("span", { style: "font-size:18px" }, "✗"),
              el("div", {},
                el("b", {}, "Benchmark Failed"),
                el("div", { style: "margin-top:4px" }, r.message || "Unknown error occurred.")
              )
            )
          );
          return;
        }

        // Render Benchmark Results
        const tierClass = "tier-" + (r.tier || "standard");
        const hero = el("div", { class: "speed-hero" },
          el("div", { class: "speed-hero-main" },
            el("span", { class: "speed-hero-label" }, "Generation Speed (TPS)"),
            el("div", { class: "speed-hero-val" },
              el("span", { class: "speed-tps-num" }, String(r.tps)),
              el("span", { class: "speed-tps-unit" }, "tokens/sec")
            ),
            el("span", { class: "speed-hero-sub" }, model + (provider ? " · " + provider : ""))
          ),
          el("div", { class: "speed-badge " + tierClass }, r.tier_label || "Standard 🟢")
        );

        // Diagnostics Alert
        const diagList = [];
        if (r.throttling_note) {
          const isSlow = r.tps < 12;
          diagList.push(
            el("div", { class: "speed-diag " + (isSlow ? "warn" : "info") },
              el("span", { style: "font-size:16px" }, isSlow ? "⚠️" : "ℹ️"),
              el("div", {},
                el("b", {}, isSlow ? "Throttling / Capped Speed Detected" : "Latency Note"),
                el("div", { style: "margin-top:2px" }, r.throttling_note)
              )
            )
          );
        }

        // Rate limit tags
        const rateLimitEntries = Object.entries(r.rate_limits || {});
        if (rateLimitEntries.length) {
          const tagRow = el("div", { class: "speed-tags" });
          rateLimitEntries.forEach(([k, v]) => {
            const shortKey = k.replace(/^x-ratelimit-/, "").replace(/-/g, " ");
            tagRow.append(el("span", { class: "speed-tag", title: k }, shortKey + ": " + v));
          });
          diagList.push(
            el("div", { style: "margin-bottom:12px" },
              el("div", { style: "font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em" }, "Provider Rate Limit Info"),
              tagRow
            )
          );
        }

        // Metrics Grid (4 cards)
        const grid = el("div", { class: "speed-grid" },
          el("div", { class: "speed-card" },
            el("div", { class: "speed-card-title" }, "⏱️ Time To First Token"),
            el("div", { class: "speed-card-val" }, r.ttft_ms + " ms"),
            el("div", { class: "speed-card-sub" }, "Initial latency (network + queue)")
          ),
          el("div", { class: "speed-card" },
            el("div", { class: "speed-card-title" }, "⏳ Generation Duration"),
            el("div", { class: "speed-card-val" }, r.gen_time_s + " s"),
            el("div", { class: "speed-card-sub" }, "Total round-trip: " + r.total_time_s + "s")
          ),
          el("div", { class: "speed-card" },
            el("div", { class: "speed-card-title" }, "📊 Output Tokens"),
            el("div", { class: "speed-card-val" }, r.completion_tokens + " tok"),
            el("div", { class: "speed-card-sub" }, "Prompt: " + r.prompt_tokens + " tok · Total: " + r.total_tokens)
          ),
          el("div", { class: "speed-card" },
            el("div", { class: "speed-card-title" }, "📈 Character Throughput"),
            el("div", { class: "speed-card-val" }, r.chars_per_sec + " ch/s"),
            el("div", { class: "speed-card-sub" }, "~" + r.words_per_sec + " words/s · " + r.chunk_count + " chunks")
          )
        );

        // Sample text preview
        const sampleWrap = el("div", { class: "speed-sample-wrap" },
          el("div", { class: "speed-sample-head" },
            el("span", {}, "Sample Generated Output (" + (r.words_count || 0) + " words)"),
            el("span", { class: "dim small" }, (r.total_tps || r.tps) + " total TPS")
          ),
          el("div", { class: "speed-sample-box" }, r.sample_text || "(empty response)")
        );

        contentArea.replaceChildren(hero, ...diagList, grid, sampleWrap);
      } catch (e) {
        contentArea.replaceChildren(
          el("div", { class: "speed-diag err" },
            el("span", { style: "font-size:18px" }, "✗"),
            el("div", {},
              el("b", {}, "Connection Error"),
              el("div", { style: "margin-top:4px" }, e.message || "Failed to reach server.")
            )
          )
        );
      } finally {
        running = false;
        runAgainBtn.disabled = false;
        presetBtns.forEach(b => b.disabled = false);
      }
    }

    // Auto-run on open
    runBenchmark();
  }, "modal-lg");
}

/* ---------------- modal ---------------- */
function openModal(title, build, extraClass = "") {
  closeModal();
  const veil = el("div", { class: "modal-veil" });
  const box = el("div", { class: "modal" + (extraClass ? " " + extraClass : "") });
  const closeBtn = el("button", {
    class: "ghost",
    style: "padding:4px 8px;font-size:16px;line-height:1;min-width:auto;border-radius:6px;",
    onclick: closeModal,
    "aria-label": "Close modal"
  }, "✕");
  const tEl = el("div", { class: "modal-title" },
    el("span", {}, title),
    closeBtn
  );
  const body = el("div", { class: "modal-body" });
  const actions = el("div", { class: "modal-actions" });
  box.append(tEl, body, actions);
  veil.append(box);
  veil.onclick = (e) => { if (e.target === veil) closeModal(); };
  document.body.append(veil);
  if (typeof build === "function") {
    build(body, actions);
  } else if (typeof build === "string") {
    body.append(el("pre", { class: "codeblock" }, build));
  } else if (build && build.nodeType) {
    body.append(build);
  }
  if (!actions.children.length) actions.append(el("button", { class: "primary", onclick: closeModal }, "Close"));
}
function closeModal() { document.querySelectorAll(".modal-veil").forEach(x => x.remove()); }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

function initTheme() {
  const current = localStorage.getItem("hermes-theme") || "light";
  document.documentElement.setAttribute("data-theme", current);
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === current);
    btn.onclick = () => {
      const t = btn.dataset.theme;
      localStorage.setItem("hermes-theme", t);
      document.documentElement.setAttribute("data-theme", t);
      document.querySelectorAll(".theme-btn").forEach(b => b.classList.toggle("active", b.dataset.theme === t));
      toast("Theme set to " + t + " ✓", "ok", 2000);
    };
  });
}

function initMobileMenu() {
  const btn = document.getElementById("mobile-menu-btn");
  const menu = document.getElementById("menu");
  const backdrop = document.getElementById("menu-backdrop");
  if (btn && menu && backdrop) {
    btn.onclick = () => {
      const isOpen = menu.classList.contains("open");
      menu.classList.toggle("open", !isOpen);
      backdrop.classList.toggle("open", !isOpen);
    };
    backdrop.onclick = closeMobileMenu;
  }
}

function initMenuCollapse() {
  const menu = document.getElementById("menu");
  const btn = document.getElementById("menu-collapse-btn");
  if (!menu || !btn) return;

  // Set title on each menu item for tooltip in mini mode
  document.querySelectorAll(".menu-item").forEach(item => {
    const txt = item.querySelector(".mi-text");
    if (txt) item.title = txt.textContent;
  });

  // Restore saved state
  if (localStorage.getItem("hermes-menu-collapsed") === "1") {
    menu.classList.add("mini");
  }

  function updateBtn() {
    const isMini = menu.classList.contains("mini");
    btn.title = isMini ? "Expand sidebar" : "Collapse sidebar";
    btn.querySelector(".mi-emoji").textContent = isMini ? "»" : "«";
    btn.querySelector(".mi-text").textContent = isMini ? "Expand" : "Collapse";
  }
  updateBtn();

  btn.onclick = () => {
    menu.classList.toggle("mini");
    localStorage.setItem("hermes-menu-collapsed", menu.classList.contains("mini") ? "1" : "0");
    updateBtn();
  };
}

/* ---------------- update checker ---------------- */
let CURRENT_UPDATE_INFO = null;

function openUpdateModal(info) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const modal = el("div", { class: "modal-card update-modal" });

  const titleRow = el("div", { class: "modal-title-row" },
    el("div", { class: "modal-title" }, "🚀 Software Update Available"),
    el("button", { class: "modal-close-btn", title: "Close", onclick: () => backdrop.remove() }, "✕")
  );

  const infoCard = el("div", { class: "update-info-card" },
    el("div", { class: "update-ver-row" },
      el("span", {}, "Current Version:"),
      el("span", { class: "update-ver-tag current" }, `v${info.current_version || "1.0.0"} (${info.current_commit || "local"})`)
    ),
    el("div", { class: "update-ver-row" },
      el("span", {}, "Latest on GitHub:"),
      el("span", { class: "update-ver-tag latest" }, `${info.latest_version || "latest"} (${info.latest_commit || "remote"})`)
    )
  );

  let commitBox = null;
  if (info.commit_message) {
    commitBox = el("div", { class: "update-commit-box" },
      el("span", { class: "update-commit-sha" }, info.latest_commit ? `[${info.latest_commit}]` : ""),
      el("span", {}, info.commit_message)
    );
  }

  const desc = el("p", { class: "compress-desc" },
    "Updates will be pulled directly from your GitHub repository (sufi96/hermes-settings-gui). The server will automatically apply changes and refresh."
  );

  const statusArea = el("div", { class: "update-status-area", hidden: true });

  const cancelBtn = el("button", { class: "hud-btn", onclick: () => backdrop.remove() }, "Cancel");
  const applyBtn = el("button", { class: "compress-submit-btn" }, "Update Now");

  applyBtn.onclick = async () => {
    applyBtn.disabled = true;
    cancelBtn.disabled = true;

    statusArea.hidden = false;
    statusArea.className = "update-status-area";
    statusArea.replaceChildren(
      el("span", { class: "compress-spinner" }),
      el("span", {}, " Pulling update from GitHub (git pull origin main)…")
    );

    try {
      const r = await api("/api/update/apply", { body: {} });
      if (r.ok) {
        statusArea.className = "update-status-area success";
        statusArea.innerHTML = "<b>✓ Update applied successfully!</b><p style='margin:4px 0 0;font-size:12px;'>Restarting server and reloading in 2 seconds…</p>";
        cancelBtn.remove();
        applyBtn.remove();
        setTimeout(() => {
          window.location.reload();
        }, 2200);
      } else {
        statusArea.className = "update-status-area error";
        statusArea.textContent = "✕ Update failed: " + (r.message || "Unknown error");
        applyBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    } catch (err) {
      statusArea.className = "update-status-area error";
      statusArea.textContent = "✕ Error: " + err.message;
      applyBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  };

  const actions = el("div", { class: "modal-actions-row" }, cancelBtn, applyBtn);

  modal.append(titleRow, infoCard, commitBox || "", desc, statusArea, actions);
  backdrop.append(modal);
  document.body.append(backdrop);
}

async function initUpdateChecker() {
  const container = document.getElementById("update-notification");
  if (!container) return;

  try {
    const r = await api("/api/update/check");
    if (r.ok && r.has_update) {
      CURRENT_UPDATE_INFO = r;
      const banner = el("div", {
        class: "update-alert-banner",
        title: "Click to view and install update",
        onclick: () => openUpdateModal(r)
      },
        el("span", { class: "update-pulse-dot" }),
        el("span", { class: "update-msg" }, `Update: ${r.latest_version || "available"}`),
        el("button", { class: "update-pill-btn" }, "Update")
      );
      container.replaceChildren(banner);
      container.hidden = false;
    } else {
      container.hidden = true;
    }
  } catch {}
}

/* ---------------- boot ---------------- */
(async function boot() {
  if (!TOKEN) {
    showFatal("This page needs an access token. Run start.bat — it opens the correct address in your browser automatically.");
    return;
  }
  initTheme();
  initMobileMenu();
  initMenuCollapse();
  document.querySelectorAll(".menu-item").forEach(b => {
    b.onclick = () => showPage(b.dataset.page);
  });
  await loadState();
  showPage("home");
  initUpdateChecker();
})();
