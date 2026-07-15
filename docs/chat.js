/**
 * TungDevAI Chat — user-facing only (no admin UI).
 * Admin page is separate: /j-panel.html (secret URL).
 */
(() => {
  const LS_API = "jarvis_api_base_v2";
  const LS_USER_TOKEN = "jarvis_user_token_v2";
  const LS_GOOGLE = "jarvis_google_session_v1";
  const LS_GOOGLE_USER = "jarvis_google_user_v1";
  const LS_CHATS = "jarvis_chats_v3"; // stable key — survives tab close
  const LS_ACTIVE = "jarvis_active_chat_v3";
  const LS_SID = "jarvis_sid_v3";
  const MAX_IMAGES = 4;
  const MAX_EDGE = 1280;
  const JPEG_Q = 0.82;

  const $ = (id) => document.getElementById(id);

  /**
   * Inject "Gói của bạn" rows even if HTML is old (GitHub Pages cache / old deploy).
   * Call before reading plan elements.
   */
  function ensurePlanDom() {
    function inject(menuId, planId, nameId, metaId, vipId, logoutId) {
      const menu = $(menuId);
      if (!menu) return;
      let plan = $(planId);
      if (!plan) {
        plan = document.createElement("div");
        plan.className = "account-menu-plan";
        plan.id = planId;
        plan.innerHTML =
          'Gói của bạn: <strong id="' +
          nameId +
          '">…</strong>' +
          '<span class="account-menu-plan-meta" id="' +
          metaId +
          '"></span>';
        const email = menu.querySelector(".account-menu-email") || menu.firstChild;
        if (email && email.nextSibling) {
          menu.insertBefore(plan, email.nextSibling);
        } else if (email) {
          email.insertAdjacentElement("afterend", plan);
        } else {
          menu.insertBefore(plan, menu.firstChild);
        }
      }
      // Fix Vietnamese labels on old HTML
      const vip = $(vipId);
      if (vip && /Mua goi/i.test(vip.textContent || "")) {
        vip.textContent = "Mua gói VIP";
      }
      const lo = $(logoutId);
      if (lo) lo.textContent = "Đăng xuất";
    }
    inject(
      "accountMenu",
      "accountMenuPlan",
      "accountMenuPlanName",
      "accountMenuPlanMeta",
      "btnVipMenu",
      "btnLogout"
    );
    inject(
      "accountMenuTop",
      "accountMenuPlanTop",
      "accountMenuPlanNameTop",
      "accountMenuPlanMetaTop",
      "btnVipMenuTop",
      "btnLogoutTop"
    );
  }

  ensurePlanDom();

  const els = {
    app: $("app"),
    sidebar: $("sidebar"),
    backdrop: $("backdrop"),
    history: $("history"),
    messages: $("messages"),
    welcome: $("welcome"),
    form: $("form"),
    input: $("input"),
    send: $("btnSend"),
    btnNew: $("btnNew"),
    btnLogout: $("btnLogout"),
    btnLogoutTop: $("btnLogoutTop"),
    btnOpenSidebar: $("btnOpenSidebar"),
    btnCloseSidebar: $("btnCloseSidebar"),
    btnPlus: $("btnPlus"),
    fileImage: $("fileImage"),
    attachPreview: $("attachPreview"),
    modelChip: $("modelChip"),
    appNameLabel: $("appNameLabel"),
    chatTitle: $("chatTitle"),
    statusDot: $("statusDot"),
    tgLink: $("tgLink"),
    userAvatar: $("userAvatar"),
    userChipBtn: $("userChipBtn"),
    userPill: $("userPill"),
    userPillImg: $("userPillImg"),
    userPillName: $("userPillName"),
    welcomeName: $("welcomeName"),
    accountMenu: $("accountMenu"),
    accountMenuTop: $("accountMenuTop"),
    accountMenuEmail: $("accountMenuEmail"),
    accountMenuEmailTop: $("accountMenuEmailTop"),
    accountMenuPlan: $("accountMenuPlan"),
    accountMenuPlanTop: $("accountMenuPlanTop"),
    accountMenuPlanName: $("accountMenuPlanName"),
    accountMenuPlanNameTop: $("accountMenuPlanNameTop"),
    accountMenuPlanMeta: $("accountMenuPlanMeta"),
    accountMenuPlanMetaTop: $("accountMenuPlanMetaTop"),
    btnVipMenu: $("btnVipMenu"),
    btnVipMenuTop: $("btnVipMenuTop"),
  };

  function refreshElsPlan() {
    ensurePlanDom();
    els.accountMenuPlan = $("accountMenuPlan");
    els.accountMenuPlanTop = $("accountMenuPlanTop");
    els.accountMenuPlanName = $("accountMenuPlanName");
    els.accountMenuPlanNameTop = $("accountMenuPlanNameTop");
    els.accountMenuPlanMeta = $("accountMenuPlanMeta");
    els.accountMenuPlanMetaTop = $("accountMenuPlanMetaTop");
    els.btnVipMenu = $("btnVipMenu");
    els.btnVipMenuTop = $("btnVipMenuTop");
    els.accountMenuEmail = $("accountMenuEmail");
    els.accountMenuEmailTop = $("accountMenuEmailTop");
  }

  let googleUser = null;
  let googleSession = localStorage.getItem(LS_GOOGLE) || "";
  let serverOnline = false;
  let lastModel = "";
  let serverConfig = {
    google_client_id: "",
    google_auth_required: false,
    auth_required: false,
    email_auth: true,
  };

  let cfgPublic = { apiBase: "", telegramBot: "https://t.me/grokapiai_bot" };
  let pendingImages = [];
  let chats = [];
  let activeId = null;
  let busy = false;
  let sessionId = localStorage.getItem(LS_SID) || localStorage.getItem("jarvis_sid_v2") || "";

  /**
   * Same domain as the web UI by default (empty apiBase => location.origin).
   * On GitHub Pages (static only) there is no API — force local server URL.
   */
  function apiBase() {
    const host = (location.hostname || "").toLowerCase();
    // Static GitHub Pages cannot run Python API
    if (host.indexOf("github.io") !== -1) {
      const fromLs = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
      return fromLs || "http://127.0.0.1:7860";
    }
    const fromLs = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
    if (fromLs) return fromLs;
    const fromCfg = (cfgPublic.apiBase || "").trim().replace(/\/$/, "");
    if (fromCfg) return fromCfg;
    // Same origin (http://127.0.0.1:7860 or VPS domain)
    return (location.origin || "").replace(/\/$/, "");
  }

  function userToken() {
    return (localStorage.getItem(LS_USER_TOKEN) || "").trim();
  }

  function userHeaders(extra) {
    const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    const t = userToken();
    if (t) h["X-Web-Token"] = t;
    if (googleSession) h["X-User-Session"] = googleSession;
    return h;
  }

  function showApp() {
    if (els.app) els.app.classList.remove("hidden");
  }

  /** Separate pages: login.html / register.html */
  function redirectToLogin() {
    const next = encodeURIComponent("chat.html");
    location.href = "login.html?next=" + next;
  }

  function redirectToRegister() {
    const next = encodeURIComponent("chat.html");
    location.href = "register.html?next=" + next;
  }

  function isLoggedIn() {
    return !!(googleSession && googleUser);
  }

  function refreshUserChip() {
    if (!els.modelChip) return;
    if (!isLoggedIn()) {
      if (els.appNameLabel) els.appNameLabel.textContent = cfgPublic.appName || "TungDevAI";
      els.modelChip.textContent = "Đăng nhập";
      els.modelChip.classList.add("login-cta");
      if (els.userPillName) els.userPillName.textContent = "Đăng nhập";
      if (els.userAvatar) els.userAvatar.src = "assets/bot-avatar.jpg";
      if (els.userPillImg) els.userPillImg.src = "assets/bot-avatar.jpg";
      return;
    }
    els.modelChip.classList.remove("login-cta");
    const u = googleUser || {};
    const plan = planLabel(u);
    if (plan) {
      els.modelChip.textContent = plan;
    } else if (serverOnline && lastModel) {
      els.modelChip.textContent = lastModel;
    } else if (serverOnline) {
      els.modelChip.textContent = u.email || "online";
    } else {
      els.modelChip.textContent = u.email || "offline";
    }
  }

  function planDisplayName(user) {
    // Always resolve a visible plan name (default Trial)
    const raw = (
      (user && (user.plan_name || user.plan_id)) ||
      "trial"
    )
      .toString()
      .trim();
    const map = {
      trial: "Trial",
      basic: "Basic",
      pro: "Pro",
      business: "Business",
      owner: "Owner",
    };
    const key = raw.toLowerCase();
    if (map[key]) return map[key];
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function planQuotaText(user) {
    if (!user) return "";
    const rem = user.remaining_today;
    const lim = user.daily_limit;
    if (lim === -1) return "Không giới hạn tin / ngày";
    if (lim != null && lim >= 0 && rem != null) {
      return "Còn " + rem + "/" + lim + " tin hôm nay";
    }
    if (user.plan_expires_at) {
      try {
        const d = new Date(user.plan_expires_at);
        if (!isNaN(d.getTime())) {
          return "Hết hạn: " + d.toLocaleDateString("vi-VN");
        }
      } catch (e) {}
    }
    return "";
  }

  function planLabel(user) {
    if (!user) return "";
    const name = planDisplayName(user);
    const tier = (user.ai_tier || "").toLowerCase();
    const pid = (user.plan_id || "").toLowerCase();
    let ai = "";
    if (tier === "pro" || pid === "pro" || pid === "business" || pid === "owner") {
      ai = "DeepSeek VIP";
    } else if (tier === "basic" || pid === "basic") {
      ai = "GPT";
    } else if (tier === "paid") {
      ai = "VIP";
    } else {
      ai = "Groq";
    }
    let base = "Gói " + name;
    if (ai) base += " · " + ai;
    if (user.daily_limit === -1) return base + " · ∞";
    if (user.remaining_today != null && user.daily_limit != null && user.daily_limit >= 0) {
      return base + " · " + user.remaining_today + "/" + user.daily_limit;
    }
    return base;
  }

  function setPlanMenu(user) {
    refreshElsPlan();
    // Always show plan row when logged in
    const name = user ? planDisplayName(user) : "";
    const meta = user ? planQuotaText(user) : "";
    const expired = !!(user && user.plan_expired);
    const blocks = [
      {
        wrap: els.accountMenuPlan,
        nameEl: els.accountMenuPlanName,
        metaEl: els.accountMenuPlanMeta,
      },
      {
        wrap: els.accountMenuPlanTop,
        nameEl: els.accountMenuPlanNameTop,
        metaEl: els.accountMenuPlanMetaTop,
      },
    ];
    blocks.forEach(function (b) {
      if (!b.wrap) return;
      if (!user || !name) {
        b.wrap.hidden = true;
        b.wrap.style.display = "none";
        return;
      }
      b.wrap.hidden = false;
      b.wrap.removeAttribute("hidden");
      b.wrap.style.display = "block";
      b.wrap.style.visibility = "visible";
      if (b.nameEl) b.nameEl.textContent = name + (expired ? " (hết hạn)" : "");
      let metaFull = meta || "";
      if (user) {
        const t = (user.ai_tier || "").toLowerCase();
        const p = (user.plan_id || "").toLowerCase();
        let aiBit = "Model: Groq (free)";
        if (t === "pro" || p === "pro" || p === "business" || p === "owner") {
          aiBit = "Model: DeepSeek-V4-Pro (Pro+)";
        } else if (t === "basic" || p === "basic") {
          aiBit = "Model: GPT-OSS-120B (Basic)";
        } else if (t === "paid") {
          aiBit = "Model: VIP";
        }
        metaFull = metaFull ? metaFull + " · " + aiBit : aiBit;
      }
      if (b.metaEl) b.metaEl.textContent = metaFull;
    });
    const pid = ((user && user.plan_id) || "trial").toLowerCase();
    const vipText =
      !user || pid === "trial" || expired
        ? "Mua gói VIP"
        : pid === "business"
          ? "Gia hạn / liên hệ"
          : "Nâng cấp gói";
    if (els.btnVipMenu) els.btnVipMenu.textContent = vipText;
    if (els.btnVipMenuTop) els.btnVipMenuTop.textContent = vipText;
    // Sidebar chip: always show Gói Pro / Basic / …
    if (els.modelChip && user) {
      els.modelChip.classList.remove("login-cta");
      els.modelChip.textContent = planLabel(user) || "Gói " + planDisplayName(user);
    }
  }

  async function refreshPlanFromServer() {
    if (!googleSession) return false;
    try {
      const r = await fetch(apiBase() + "/api/auth/me", {
        headers: { "X-User-Session": googleSession },
        cache: "no-store",
      });
      if (!r.ok) return false;
      const j = await r.json();
      if (j && j.user) {
        applyUserUi(j.user);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function applyUserUi(user) {
    googleUser = user || null;
    if (user) {
      try {
        localStorage.setItem(LS_GOOGLE_USER, JSON.stringify(user));
      } catch (e) {}
    }
    if (!user) {
      if (els.accountMenuEmail) els.accountMenuEmail.textContent = "";
      if (els.accountMenuEmailTop) els.accountMenuEmailTop.textContent = "";
      setPlanMenu(null);
      refreshUserChip();
      return;
    }
    const name = user.name || user.email || "User";
    if (els.userPillName) els.userPillName.textContent = name;
    if (els.welcomeName) els.welcomeName.textContent = name.split(" ")[0] || name;
    if (els.appNameLabel) els.appNameLabel.textContent = name;
    if (user.picture) {
      if (els.userPillImg) els.userPillImg.src = user.picture;
      if (els.userAvatar) els.userAvatar.src = user.picture;
    } else {
      if (els.userPillImg) els.userPillImg.src = "assets/bot-avatar.jpg";
      if (els.userAvatar) els.userAvatar.src = "assets/bot-avatar.jpg";
    }
    const emailLine = user.email || name;
    // Menu: email riêng, gói riêng
    if (els.accountMenuEmail) els.accountMenuEmail.textContent = emailLine;
    if (els.accountMenuEmailTop) els.accountMenuEmailTop.textContent = emailLine;
    setPlanMenu(user);
    const plan = planLabel(user);
    if (els.userPill) els.userPill.title = plan ? emailLine + " · " + plan : emailLine;
    if (els.modelChip && isLoggedIn()) {
      els.modelChip.classList.remove("login-cta");
      els.modelChip.textContent = plan || user.email || lastModel || "online";
    }
    refreshUserChip();
  }

  async function activateCode(code) {
    if (!googleSession) {
      redirectToLogin();
      return { ok: false, message: "Cần đăng nhập trước." };
    }
    const r = await fetch(apiBase() + "/api/auth/activate", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, userHeaders()),
      body: JSON.stringify({ code: code }),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
    if (!r.ok) {
      const d = data.detail;
      let msg = text;
      if (typeof d === "string") msg = d;
      else if (d && d.message) msg = d.message;
      throw new Error(msg || "Kích hoạt thất bại");
    }
    if (data.user) applyUserUi(data.user);
    return data;
  }

  function logoutGoogle() {
    closeAccountMenus();
    if (googleSession) {
      fetch(apiBase() + "/api/auth/logout", {
        method: "POST",
        headers: { "X-User-Session": googleSession },
      }).catch(function () {});
    }
    googleSession = "";
    googleUser = null;
    localStorage.removeItem(LS_GOOGLE);
    localStorage.removeItem(LS_GOOGLE_USER);
    applyUserUi(null);
    redirectToLogin();
  }

  async function restoreGoogleSession() {
    if (!googleSession) return false;
    try {
      const r = await fetch(apiBase() + "/api/auth/me", {
        headers: { "X-User-Session": googleSession },
        cache: "no-store",
      });
      if (!r.ok) {
        // Session chết (server restart) — xóa cache cũ không có plan
        googleSession = "";
        googleUser = null;
        localStorage.removeItem(LS_GOOGLE);
        localStorage.removeItem(LS_GOOGLE_USER);
        return false;
      }
      const j = await r.json();
      applyUserUi(j.user);
      showApp();
      return true;
    } catch (e) {
      // Offline: only use cache if it already has plan_id
      try {
        const cached = JSON.parse(localStorage.getItem(LS_GOOGLE_USER) || "null");
        if (cached && (cached.plan_id || cached.plan_name)) {
          applyUserUi(cached);
          showApp();
          return true;
        }
      } catch (e2) {
        /* ignore */
      }
      return false;
    }
  }

  function closeAccountMenus() {
    if (els.accountMenu) els.accountMenu.classList.add("hidden");
    if (els.accountMenuTop) els.accountMenuTop.classList.add("hidden");
    if (els.userChipBtn) els.userChipBtn.setAttribute("aria-expanded", "false");
    if (els.userPill) els.userPill.setAttribute("aria-expanded", "false");
  }

  function openAccountMenu(which) {
    closeAccountMenus();
    const email =
      (googleUser && (googleUser.email || googleUser.name)) || "Tài khoản";
    // Paint plan from memory immediately, then refresh from server
    if (els.accountMenuEmail) els.accountMenuEmail.textContent = email;
    if (els.accountMenuEmailTop) els.accountMenuEmailTop.textContent = email;
    setPlanMenu(googleUser);
    if (which === "side" && els.accountMenu) {
      els.accountMenu.classList.remove("hidden");
      if (els.userChipBtn) els.userChipBtn.setAttribute("aria-expanded", "true");
    }
    if (which === "top" && els.accountMenuTop) {
      els.accountMenuTop.classList.remove("hidden");
      if (els.userPill) els.userPill.setAttribute("aria-expanded", "true");
    }
    // Always re-fetch plan (Pro/Basic/…) from DB
    refreshPlanFromServer().then(function (ok) {
      if (!ok) return;
      const email2 =
        (googleUser && (googleUser.email || googleUser.name)) || email;
      if (els.accountMenuEmail) els.accountMenuEmail.textContent = email2;
      if (els.accountMenuEmailTop) els.accountMenuEmailTop.textContent = email2;
      setPlanMenu(googleUser);
    });
  }

  function onAccountClick(which, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!isLoggedIn()) {
      redirectToLogin();
      return;
    }
    const menu = which === "top" ? els.accountMenuTop : els.accountMenu;
    const open = menu && !menu.classList.contains("hidden");
    if (open) closeAccountMenus();
    else openAccountMenu(which);
  }

  function openLoginFromChip() {
    onAccountClick("side");
  }

  async function loadPublicConfig() {
    try {
      const r = await fetch("config.json?v=6", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        cfgPublic = Object.assign(cfgPublic, j);
      }
    } catch (e) {
      /* use defaults */
    }
    if (els.tgLink && cfgPublic.telegramBot) els.tgLink.href = cfgPublic.telegramBot;
    if (els.appNameLabel && cfgPublic.appName) els.appNameLabel.textContent = cfgPublic.appName;
  }

  function _slimChats(list) {
    // Drop big base64 images so localStorage never blows quota
    return list.map(function (c) {
      return {
        id: c.id,
        title: c.title,
        updated: c.updated,
        sessionId: c.sessionId || "",
        messages: (c.messages || []).map(function (m) {
          return {
            role: m.role,
            content: m.content || "",
            // keep at most 1 small image marker, not full data url if huge
            images: (m.images || []).length
              ? m.images.filter(function (img) {
                  return typeof img === "string" && img.length < 200000;
                }).slice(0, 2)
              : [],
          };
        }),
      };
    });
  }

  function loadChats() {
    try {
      // migrate old keys if present
      var raw =
        localStorage.getItem(LS_CHATS) ||
        localStorage.getItem("jarvis_pages_chats_v2") ||
        localStorage.getItem("jarvis_pages_chats_v1") ||
        "[]";
      chats = JSON.parse(raw);
    } catch (e) {
      chats = [];
    }
    if (!Array.isArray(chats)) chats = [];
  }

  function persistChats() {
    try {
      localStorage.setItem(LS_CHATS, JSON.stringify(_slimChats(chats)));
      if (activeId) localStorage.setItem(LS_ACTIVE, activeId);
      if (sessionId) localStorage.setItem(LS_SID, sessionId);
    } catch (e) {
      // Quota: strip all images and retry
      try {
        chats.forEach(function (c) {
          (c.messages || []).forEach(function (m) {
            m.images = [];
          });
        });
        localStorage.setItem(LS_CHATS, JSON.stringify(_slimChats(chats)));
      } catch (e2) {
        console.warn("persistChats failed", e2);
      }
    }
  }

  // Save when closing tab / switching away
  window.addEventListener("beforeunload", function () {
    persistChats();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") persistChats();
  });

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function setStatus(ok) {
    els.statusDot.classList.toggle("ok", ok);
    els.statusDot.classList.toggle("err", !ok);
  }

  async function pingServer() {
    try {
      const r = await fetch(apiBase() + "/api/health", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      lastModel = j.model || "";
      serverOnline = true;
      setStatus(true);
      refreshUserChip();
      return j;
    } catch (e) {
      serverOnline = false;
      setStatus(false);
      refreshUserChip();
      return null;
    }
  }

  function activeChat() {
    return chats.find((c) => c.id === activeId) || null;
  }

  function renderHistory() {
    els.history.innerHTML = "";
    const sorted = chats.slice().sort((a, b) => b.updated - a.updated);
    sorted.forEach((c) => {
      const row = document.createElement("div");
      row.className = "hist-item" + (c.id === activeId ? " active" : "");
      row.innerHTML =
        '<span class="title"></span><button type="button" class="del" title="Xoa">X</button>';
      row.querySelector(".title").textContent = c.title || "Chat mới";
      row.addEventListener("click", (e) => {
        if (e.target.closest(".del")) return;
        selectChat(c.id);
      });
      row.querySelector(".del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(c.id);
      });
      els.history.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildCodeBlockHtml(lang, code) {
    const langLabel = String(lang || "code")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_+#-]/gi, "") || "code";
    const body = String(code || "").replace(/\r\n/g, "\n").replace(/\n$/, "");
    return (
      '<div class="code-block">' +
      '<div class="code-block-bar">' +
      '<span class="code-lang">' +
      langLabel +
      "</span>" +
      '<button type="button" class="code-copy" title="Sao chép code">Sao chép</button>' +
      "</div>" +
      '<pre><code class="lang-' +
      langLabel +
      '">' +
      body +
      "</code></pre>" +
      "</div>"
    );
  }

  function formatMarkdown(text) {
    if (!text) return "";
    // Normalize newlines (Windows / model output)
    let s = escapeHtml(String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
    const codeBlocks = [];

    function pushBlock(lang, code) {
      codeBlocks.push(buildCodeBlockHtml(lang, code));
      return "\n\n@@CODEBLOCK" + (codeBlocks.length - 1) + "@@\n\n";
    }

    // Closed fences: ```lang\n...\n```  or  ```\n...\n```
    s = s.replace(/```([^\n`]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      return pushBlock(lang, code);
    });
    // Unclosed fence at end (streaming)
    s = s.replace(/```([^\n`]*)\n([\s\S]*)$/g, function (_, lang, code) {
      return pushBlock(lang, code);
    });

    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|\n)[*-] (.+)/g, "$1• $2");

    s = s
      .split(/\n{2,}/)
      .map(function (p) {
        const t = p.trim();
        if (!t) return "";
        if (/^@@CODEBLOCK\d+@@$/.test(t)) return t;
        // Keep code placeholders out of <p>
        if (t.indexOf("@@CODEBLOCK") !== -1) {
          return t.replace(/(@@CODEBLOCK\d+@@)/g, "\n$1\n");
        }
        return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
      })
      .join("");

    // Flatten any leftover wrapper newlines around markers
    s = s.replace(/(?:<p>)?\s*(@@CODEBLOCK\d+@@)\s*(?:<\/p>)?/g, "$1");
    s = s.replace(/@@CODEBLOCK(\d+)@@/g, function (_, i) {
      return codeBlocks[Number(i)] || "";
    });
    return s;
  }

  function copyCodeText(text, btn) {
    const done = function (ok) {
      if (!btn) return;
      btn.textContent = ok ? "Đã sao chép!" : "Lỗi";
      btn.classList.toggle("copied", !!ok);
      setTimeout(function () {
        btn.textContent = "Sao chép";
        btn.classList.remove("copied");
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { fallbackCopy(text, done); }
      );
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      done(ok);
    } catch (err) {
      done(false);
    }
  }

  /** Wrap bare <pre> and ensure every code block has Copy bar */
  function enhanceCodeBlocks(root) {
    if (!root) return;
    root.querySelectorAll("pre").forEach(function (pre) {
      if (pre.closest(".code-block")) return;
      const wrap = document.createElement("div");
      wrap.className = "code-block";
      const bar = document.createElement("div");
      bar.className = "code-block-bar";
      bar.innerHTML =
        '<span class="code-lang">code</span>' +
        '<button type="button" class="code-copy" title="Sao chép code">Sao chép</button>';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(bar);
      wrap.appendChild(pre);
    });
  }

  function setAssistantHtml(el, text) {
    if (!el) return;
    el.innerHTML = formatMarkdown(text || "");
    enhanceCodeBlocks(el);
  }

  function renderMessages() {
    const chat = activeChat();
    els.messages.innerHTML = "";
    if (!chat || !chat.messages.length) {
      els.messages.appendChild(els.welcome);
      els.welcome.style.display = "";
      bindSuggestions();
      els.chatTitle.textContent = "TungDevAI";
      return;
    }
    els.chatTitle.textContent = chat.title || "Chat";
    chat.messages.forEach((m) => appendMsg(m.role, m.content, m.images || [], false));
    scrollBottom();
  }

  function appendMsg(role, content, images, scroll) {
    if (!images) images = [];
    if (scroll === undefined) scroll = true;
    if (els.welcome && els.welcome.parentElement) els.welcome.remove();
    const row = document.createElement("div");
    row.className = "msg " + role;
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = role === "user" ? "U" : "T";
    const body = document.createElement("div");
    body.className = "body";
    const roleEl = document.createElement("div");
    roleEl.className = "role";
    roleEl.textContent = role === "user" ? "Bạn" : "TungDevAI";
    body.appendChild(roleEl);
    if (images.length) {
      const wrap = document.createElement("div");
      wrap.className = "msg-images";
      images.forEach((src) => {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Anh";
        wrap.appendChild(img);
      });
      body.appendChild(wrap);
    }
    const contentEl = document.createElement("div");
    contentEl.className = "content";
    if (role === "assistant") setAssistantHtml(contentEl, content || "");
    else contentEl.textContent = content || "";
    body.appendChild(contentEl);
    row.appendChild(av);
    row.appendChild(body);
    els.messages.appendChild(row);
    if (scroll) scrollBottom();
    return contentEl;
  }

  function scrollBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function newChat() {
    const c = {
      id: uid(),
      title: "Chat mới",
      messages: [],
      updated: Date.now(),
      sessionId: "",
    };
    chats.unshift(c);
    activeId = c.id;
    sessionId = "";
    localStorage.removeItem(LS_SID);
    localStorage.removeItem("jarvis_sid_v2");
    clearPendingImages();
    persistChats();
    renderHistory();
    renderMessages();
    closeSidebar();
    els.input.focus();
  }

  function selectChat(id) {
    activeId = id;
    clearPendingImages();
    renderHistory();
    renderMessages();
    closeSidebar();
  }

  function deleteChat(id) {
    chats = chats.filter((c) => c.id !== id);
    if (activeId === id) activeId = chats[0] ? chats[0].id : null;
    persistChats();
    renderHistory();
    renderMessages();
  }

  function ensureChat() {
    if (!activeChat()) newChat();
    return activeChat();
  }

  function setBusy(v) {
    busy = v;
    els.send.disabled = v;
    els.input.disabled = v;
    if (els.btnPlus) els.btnPlus.disabled = v;
  }

  function clearPendingImages() {
    pendingImages = [];
    renderAttachPreview();
  }

  function renderAttachPreview() {
    if (!els.attachPreview) return;
    if (!pendingImages.length) {
      els.attachPreview.hidden = true;
      els.attachPreview.innerHTML = "";
      return;
    }
    els.attachPreview.hidden = false;
    els.attachPreview.innerHTML = "";
    pendingImages.forEach((src, i) => {
      const chip = document.createElement("div");
      chip.className = "attach-chip";
      chip.innerHTML = '<img alt="p" /><button type="button" class="rm">X</button>';
      chip.querySelector("img").src = src;
      chip.querySelector(".rm").onclick = () => {
        pendingImages.splice(i, 1);
        renderAttachPreview();
      };
      els.attachPreview.appendChild(chip);
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("read fail"));
      r.readAsDataURL(file);
    });
  }

  function compressImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > MAX_EDGE || h > MAX_EDGE) {
          const r = Math.min(MAX_EDGE / w, MAX_EDGE / h);
          w = Math.round(w * r);
          h = Math.round(h * r);
        }
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", JPEG_Q));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function addFiles(fileList) {
    const files = Array.prototype.filter.call(fileList, (f) => f.type.indexOf("image/") === 0);
    for (let i = 0; i < files.length && pendingImages.length < MAX_IMAGES; i++) {
      try {
        let d = await fileToDataUrl(files[i]);
        d = await compressImage(d);
        pendingImages.push(d);
      } catch (e) {
        console.warn(e);
      }
    }
    renderAttachPreview();
  }

  function parseApiError(status, errText) {
    let msg = errText || ("Lỗi " + status);
    try {
      const j = JSON.parse(errText);
      const d = j.detail;
      if (typeof d === "string") msg = d;
      else if (d && typeof d === "object") {
        msg = d.message || JSON.stringify(d);
        if (d.upgrade_url) {
          msg += "\n\n→ [Mua gói VIP](" + d.upgrade_url + ")";
        }
      } else if (j.message) msg = j.message;
    } catch (e) {}
    return msg;
  }

  /** Chat via backend — API keys stay on server */
  async function sendMessage(text) {
    text = (text || "").trim();
    const images = pendingImages.slice();
    if ((!text && !images.length) || busy) return;

    const needAuth = !!(
      serverConfig.auth_required ||
      serverConfig.google_auth_required
    );
    if (needAuth && !isLoggedIn()) {
      redirectToLogin();
      return;
    }

    // /activate CODE — redeem plan on web
    const act = text.match(/^\/activate\s+(\S+)/i);
    if (act) {
      const chat = ensureChat();
      chat.messages.push({ role: "user", content: text });
      chat.updated = Date.now();
      persistChats();
      renderHistory();
      els.input.value = "";
      autoResize();
      appendMsg("user", text);
      const contentEl = appendMsg("assistant", "", [], true);
      contentEl.parentElement.parentElement.classList.add("typing");
      setBusy(true);
      try {
        const data = await activateCode(act[1]);
        const msg =
          "✅ " +
          (data.message || "Đã kích hoạt gói.") +
          (data.user
            ? "\n\nGói: **" +
              (data.user.plan_name || data.user.plan_id) +
              "** · còn " +
              (data.user.remaining_today == null
                ? "∞"
                : data.user.remaining_today + "/" + data.user.daily_limit) +
              " tin hôm nay."
            : "");
        contentEl.parentElement.parentElement.classList.remove("typing");
        setAssistantHtml(contentEl, msg);
        chat.messages.push({ role: "assistant", content: msg });
        chat.updated = Date.now();
        persistChats();
      } catch (err) {
        contentEl.parentElement.parentElement.classList.remove("typing");
        const msg =
          "**Không kích hoạt được**\n\n" +
          String(err.message || err) +
          "\n\nMua gói: [pricing.html](pricing.html) · Bot: https://t.me/grokapiai_bot";
        setAssistantHtml(contentEl, msg);
        chat.messages.push({ role: "assistant", content: msg });
        persistChats();
      } finally {
        setBusy(false);
        scrollBottom();
      }
      return;
    }

    // Images: note for now backend is text; attach as context note
    let payloadText = text;
    if (images.length) {
      payloadText =
        (text || "Toi gui kem anh (base64 rut gon).") +
        "\n\n[User attached " +
        images.length +
        " image(s) in browser UI — backend text path: mo ta/yeu cau xu ly anh neu model vision server ho tro sau.]";
    }

    const chat = ensureChat();
    chat.messages.push({ role: "user", content: text, images: images });
    if (chat.title === "Chat mới") {
      const t = text || "Anh";
      chat.title = t.slice(0, 40) + (t.length > 40 ? "..." : "");
    }
    chat.updated = Date.now();
    persistChats();
    renderHistory();

    els.input.value = "";
    autoResize();
    clearPendingImages();
    appendMsg("user", text, images);
    const contentEl = appendMsg("assistant", "", [], true);
    contentEl.parentElement.parentElement.classList.add("typing");
    contentEl.textContent = "";
    setBusy(true);

    try {
      const res = await fetch(apiBase() + "/api/chat", {
        method: "POST",
        headers: userHeaders(),
        body: JSON.stringify({
          message: payloadText,
          session_id: sessionId,
          stream: true,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(parseApiError(res.status, errText.slice(0, 800)));
      }

      const ctype = res.headers.get("content-type") || "";
      let full = "";
      if (ctype.indexOf("text/event-stream") !== -1 && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buf += decoder.decode(chunk.value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.indexOf("data:") !== 0) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const j = JSON.parse(data);
              if (j.type === "meta" && j.session_id) {
                sessionId = j.session_id;
                localStorage.setItem(LS_SID, sessionId);
                var ac = activeChat();
                if (ac) ac.sessionId = sessionId;
                persistChats();
              }
              if (j.type === "delta" && j.text) {
                full += j.text;
                setAssistantHtml(contentEl, full);
                scrollBottom();
              }
              if (j.type === "error") throw new Error(j.message || "stream error");
            } catch (e) {
              if (e.message && e.message !== "stream error" && !(e instanceof SyntaxError)) throw e;
            }
          }
        }
      } else {
        const j = await res.json();
        full = j.reply || "";
        if (j.session_id) {
          sessionId = j.session_id;
          localStorage.setItem(LS_SID, sessionId);
          var ac2 = activeChat();
          if (ac2) ac2.sessionId = sessionId;
        }
      }

      contentEl.parentElement.parentElement.classList.remove("typing");
      if (!full) throw new Error("Server tra ve rong. Kiem tra webapp dang chay?");
      setAssistantHtml(contentEl, full);
      chat.messages.push({ role: "assistant", content: full });
      chat.updated = Date.now();
      persistChats();
      renderHistory();
      setStatus(true);
      // Refresh quota / plan chip after each message
      if (googleSession) {
        fetch(apiBase() + "/api/auth/me", {
          headers: { "X-User-Session": googleSession },
          cache: "no-store",
        })
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (j) {
            if (j && j.user) applyUserUi(j.user);
          })
          .catch(function () {});
      }
    } catch (err) {
      contentEl.parentElement.parentElement.classList.remove("typing");
      setAssistantHtml(
        contentEl,
        "**Lỗi**\n\n" +
          String(err.message || err) +
          "\n\nGợi ý:\n" +
          "1. Chạy server: `python -m webapp.server` (port 7860)\n" +
          "2. Mở: http://127.0.0.1:7860/chat.html\n" +
          "3. Hết quota? [Mua gói VIP](pricing.html) rồi gõ `/activate MÃ`\n" +
          "4. Bot: https://t.me/grokapiai_bot"
      );
      setStatus(false);
    } finally {
      setBusy(false);
      scrollBottom();
    }
  }

  function bindSuggestions() {
    els.messages.querySelectorAll("[data-q]").forEach((b) => {
      b.onclick = () => {
        els.input.value = b.getAttribute("data-q") || "";
        els.form.requestSubmit();
      };
    });
  }

  function autoResize() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 180) + "px";
  }

  function openSidebar() {
    els.sidebar.classList.add("open");
    els.backdrop.hidden = false;
  }
  function closeSidebar() {
    els.sidebar.classList.remove("open");
    els.backdrop.hidden = true;
  }

  // Events
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(els.input.value);
  });
  els.input.addEventListener("input", autoResize);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.btnPlus.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) els.fileImage.click();
  });
  els.fileImage.addEventListener("change", () => {
    if (els.fileImage.files && els.fileImage.files.length) addFiles(els.fileImage.files);
    els.fileImage.value = "";
  });

  // Event delegation: Copy tren moi code block (ke ca sau stream)
  if (els.messages) {
    els.messages.addEventListener("click", function (e) {
      const btn = e.target && e.target.closest && e.target.closest(".code-copy");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const block = btn.closest(".code-block");
      const codeEl = block && block.querySelector("pre code, pre");
      const text = codeEl ? codeEl.textContent || "" : "";
      copyCodeText(text, btn);
    });
  }

  els.btnNew.addEventListener("click", newChat);
  if (els.btnLogout) {
    els.btnLogout.addEventListener("click", function (e) {
      e.stopPropagation();
      logoutGoogle();
    });
  }
  if (els.btnLogoutTop) {
    els.btnLogoutTop.addEventListener("click", function (e) {
      e.stopPropagation();
      logoutGoogle();
    });
  }
  if (els.btnOpenSidebar) els.btnOpenSidebar.addEventListener("click", openSidebar);
  if (els.btnCloseSidebar) els.btnCloseSidebar.addEventListener("click", closeSidebar);
  if (els.backdrop) els.backdrop.addEventListener("click", closeSidebar);

  // Bam vao tai khoan → menu (Dang xuat nam trong menu, khong o ngoai)
  if (els.userChipBtn) {
    els.userChipBtn.addEventListener("click", function (e) {
      onAccountClick("side", e);
    });
  }
  if (els.userPill) {
    els.userPill.addEventListener("click", function (e) {
      onAccountClick("top", e);
    });
  }
  document.addEventListener("click", function () {
    closeAccountMenus();
  });
  if (els.accountMenu) {
    els.accountMenu.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }
  if (els.accountMenuTop) {
    els.accountMenuTop.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }

  // Boot chat UI. KHONG tu nhay login khi mo trang (tranh loop / cache index cu).
  // Chi bat login khi user gui tin ma server yeu cau auth.
  (async function boot() {
    const path = (location.pathname || "").toLowerCase();
    // Chi chay full boot tren chat.html — khong bao gio tren landing/root
    if (path.indexOf("chat.html") === -1 && path.indexOf("/chat") === -1) {
      console.warn("chat.js: skip boot (not chat.html)");
      return;
    }

    await loadPublicConfig();
    try {
      const r = await fetch(apiBase() + "/api/config", { cache: "no-store" });
      if (r.ok) {
        serverConfig = Object.assign(serverConfig, await r.json());
      }
    } catch (e) {
      /* server offline — restore may use cache */
    }

    let ok = await restoreGoogleSession();
    if (!ok) {
      // Soft gate: hien chat UI + chip "Dang nhap" — KHONG location.href login
      applyUserUi(null);
      showApp();
      ok = true;
    }

    loadChats();
    activeId =
      localStorage.getItem(LS_ACTIVE) ||
      (chats[0] ? chats[0].id : null);
    if (activeId && !chats.find(function (c) { return c.id === activeId; })) {
      activeId = chats[0] ? chats[0].id : null;
    }
    var cur = activeChat();
    if (cur && cur.sessionId) {
      sessionId = cur.sessionId;
      localStorage.setItem(LS_SID, sessionId);
    }
    if (ok) {
      renderHistory();
      renderMessages();
      bindSuggestions();
      await pingServer();
      if (sessionId && isLoggedIn()) {
        try {
          const r = await fetch(
            apiBase() +
              "/api/chat/history?session_id=" +
              encodeURIComponent(sessionId),
            { headers: userHeaders(), cache: "no-store" }
          );
          if (r.ok) {
            const j = await r.json();
            if (
              j.messages &&
              j.messages.length &&
              cur &&
              (!cur.messages || !cur.messages.length)
            ) {
              cur.messages = j.messages.map(function (m) {
                return { role: m.role, content: m.content, images: [] };
              });
              persistChats();
              renderMessages();
            }
          }
        } catch (e) {
          /* offline ok */
        }
      }
    } else {
      renderGoogleButton();
    }
  })();
})();
