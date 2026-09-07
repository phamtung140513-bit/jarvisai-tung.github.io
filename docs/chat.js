
window.rawCodeStorage = window.rawCodeStorage || [];

window.unescapeHtml = function(str) {
  if (!str) return "";
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
};

window.termEscape = function(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/&lt;/g, "&lt;")
    .replace(/>/g, "&gt;");
};

window.getPureCodeFromBlock = function(blockEl, btnEl) {
  if (btnEl && btnEl.hasAttribute && btnEl.hasAttribute("data-code-id")) {
    const id = Number(btnEl.getAttribute("data-code-id"));
    if (window.rawCodeStorage[id] != null) return window.rawCodeStorage[id];
  }
  if (blockEl && blockEl.hasAttribute && blockEl.hasAttribute("data-code-id")) {
    const id = Number(blockEl.getAttribute("data-code-id"));
    if (window.rawCodeStorage[id] != null) return window.rawCodeStorage[id];
  }
  const codeEl = blockEl ? blockEl.querySelector("pre code, pre") : null;
  let raw = codeEl ? codeEl.textContent || "" : "";
  return window.unescapeHtml(raw);
};


  function unescapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/");
  }

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
  const LS_MODE = "jarvis_chat_mode_v1";
  const MAX_IMAGES = 4;
  const MAX_EDGE = 1280;
  const JPEG_Q = 0.82;
  const MODE_LABELS = {
    coder: "💻 Coder Pro",
    security: "🛡️ Hacker Mũ Trắng",
    marketing: "📈 Phù Thủy Content",
    business: "💼 Cố Vấn Kinh Doanh",
    tutor: "🎓 Gia Sư AI",
    data: "📊 Data Scientist",
    default: "✨ Đa Năng",
  };

  const $ = (id) => document.getElementById(id);
  function getCookie(name) {
    try {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? decodeURIComponent(match[2]) : "";
    } catch (_) { return ""; }
  }

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
    modeBar: $("modeBar"),
    modeBadge: $("modeBadge"),
    streamStatus: $("streamStatus"),
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

  let googleSession = localStorage.getItem(LS_GOOGLE) || "";
  let googleUser = null;
  try {
    googleUser = JSON.parse(localStorage.getItem(LS_GOOGLE_USER) || "null");
  } catch (_) {}
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
  let pendingAttachments = [];
  let webSearchEnabled = localStorage.getItem('tungdev_web_search') === 'true';
  let chats = [];
  let activeId = null;
  let busy = false;
  let currentAbortController = null;
  let sessionId = localStorage.getItem(LS_SID) || localStorage.getItem("jarvis_sid_v2") || "";
  let activeMode = (localStorage.getItem(LS_MODE) || "coder").toLowerCase();
  if (!MODE_LABELS[activeMode]) activeMode = "coder";

  /**
   * Same domain as the web UI by default (empty apiBase => location.origin).
   * GitHub Pages is static only — use config.json apiBase or localStorage (VPS/tunnel).
   * Never default to 127.0.0.1 on github.io (that is the phone, not the VPS).
   */
  function apiBase() {
    const host = (location.hostname || "").toLowerCase();
    const origin = (location.origin || "").replace(/\/$/, "");
    const fromLs = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
    const fromCfg = (cfgPublic.apiBase || "").trim().replace(/\/$/, "");
    const isLoop = (u) =>
      /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(String(u || ""));

    // Local PC server
    if (host === "127.0.0.1" || host === "localhost") return origin;

    // Public VPS/tunnel: same origin; ignore leftover 127.0.0.1 in localStorage
    if (host.indexOf("github.io") === -1 && location.protocol !== "file:") {
      if (fromLs && isLoop(fromLs)) {
        try {
          localStorage.removeItem(LS_API);
        } catch (_) {}
      }
      return origin;
    }

    // github.io / file — need remote API (never 127.0.0.1 on phone)
    if (fromLs && !isLoop(fromLs)) return fromLs;
    if (fromCfg && !isLoop(fromCfg)) return fromCfg;
    if (fromLs && isLoop(fromLs)) {
      try {
        localStorage.removeItem(LS_API);
      } catch (_) {}
    }
    return "";
  }

  function userToken() {
    return (localStorage.getItem(LS_USER_TOKEN) || "").trim();
  }

  function userHeaders(extra) {
    const h = Object.assign(
      {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        "Cache-Control": "no-store",
      },
      extra || {}
    );
    const t = userToken();
    if (t) h["X-Web-Token"] = t;
    const sess = (googleSession || localStorage.getItem(LS_GOOGLE) || "").trim();
    if (sess) {
      h["X-User-Session"] = sess;
      h["Authorization"] = "Bearer " + sess;
    }
    return h;
  }

  /** Detect ngrok browser-warning HTML mistaken for API body */
  function looksLikeNgrokHtml(text) {
    const s = String(text || "");
    return (
      /<!DOCTYPE html>/i.test(s) ||
      /assets\.ngrok\.com/i.test(s) ||
      /ERR_NGROK|ngrok-free|Visit Site/i.test(s)
    );
  }

  function ngrokHtmlErrorHint() {
    return (
      "Ngrok chặn request (trả HTML thay vì API).\n\n" +
      "Cách fix:\n" +
      "1) Mở đúng link: " +
      (apiBase() || "https://…ngrok-free.dev") +
      "/chat.html\n" +
      "2) Nếu thấy 'Visit Site' → bấm qua 1 lần\n" +
      "3) PC phải chạy web + ngrok (BAT_TUNGAI.FUN_ONLINE.bat)\n" +
      "4) Tải lại trang (Ctrl+F5)"
    );
  }

  async function apiFetch(path, opts) {
    const base = apiBase();
    if (!base) {
      throw new Error(
        "Chưa có API server. Mở link ngrok/local, không chỉ github.io."
      );
    }
    const o = opts || {};
    const headers = userHeaders(o.headers || {});
    // GET: still need ngrok skip even without JSON body
    if (!headers["Content-Type"] && o.method && o.method.toUpperCase() !== "GET") {
      headers["Content-Type"] = "application/json";
    }
    return fetch(base + path, Object.assign({}, o, { headers: headers }));
  }

  function showApp() {
    if (els.app) els.app.classList.remove("hidden");
  }

  /** Separate pages: login.html / register.html */
  function getLocalUser() {
    if (googleUser && (googleUser.email || googleUser.name)) return googleUser;
    try {
      const u = JSON.parse(localStorage.getItem(LS_GOOGLE_USER) || "null");
      if (u && (u.email || u.name)) {
        googleUser = u;
        return u;
      }
    } catch (_) {}
    return googleUser;
  }

  function isLoggedIn() {
    const sess = (googleSession || localStorage.getItem(LS_GOOGLE) || "").trim();
    const u = googleUser || getLocalUser();
    return !!(sess || (u && (u.email || u.name)));
  }

  function redirectToLogin() {
    window.location.href = "login.html";
  }

  function refreshUserChip() {
    const logged = isLoggedIn();
    const u = getLocalUser();

    if (!logged) {
      if (els.appNameLabel) els.appNameLabel.textContent = "TUNGAI.FUN";
      if (els.modelChip) {
        els.modelChip.textContent = "Đăng nhập";
        els.modelChip.classList.add("login-cta");
      }
      if (els.userPillName) els.userPillName.textContent = "Đăng nhập";
      if (els.userAvatar) els.userAvatar.src = "assets/tungdevai-core-logo.jpg?v=core2026";
      if (els.userPillImg) els.userPillImg.src = "assets/tungdevai-core-logo.jpg?v=core2026";
      return;
    }

    updateBrandEdition(u);
    const displayName = (u && (u.name || u.email)) || "Thành viên VIP";
    const planName = (u && planDisplayName(u)) || "Pro VIP";

    if (els.appNameLabel) els.appNameLabel.textContent = displayName;
    if (els.userPillName) els.userPillName.textContent = displayName;
    if (els.welcomeName) els.welcomeName.textContent = displayName.split(" ")[0] || displayName;

    if (els.modelChip) {
      els.modelChip.classList.remove("login-cta");
      els.modelChip.textContent = "Gói " + planName;
    }

    if (u && u.picture) {
      if (els.userAvatar) els.userAvatar.src = u.picture;
      if (els.userPillImg) els.userPillImg.src = u.picture;
    } else {
      if (els.userAvatar) els.userAvatar.src = "assets/tungdevai-core-logo.jpg?v=core2026";
      if (els.userPillImg) els.userPillImg.src = "assets/tungdevai-core-logo.jpg?v=core2026";
    }
  }

  function updateBrandEdition(user) {
    const brandEdition = $("brandEdition") || document.getElementById("brandEdition");
    const welcomeEdition = $("welcomeEdition") || document.getElementById("welcomeEdition");
    const chatTitle = $("chatTitle") || document.getElementById("chatTitle");

    const planId = ((user && (user.plan_id || user.plan_name)) || "trial").toLowerCase().trim();

    let editionText = "Studio Pro";
    let fullTitle = "TUNGAI.FUN Studio";

    if (planId === "basic") {
      editionText = "Basic";
      fullTitle = "TUNGAI.FUN Basic";
    } else if (planId === "pro") {
      editionText = "Pro VIP";
      fullTitle = "TUNGAI.FUN Pro VIP";
    } else if (planId === "business") {
      editionText = "Business";
      fullTitle = "TUNGAI.FUN Business";
    } else if (planId === "owner" || planId === "enterprise") {
      editionText = "Enterprise";
      fullTitle = "TUNGAI.FUN Enterprise";
    } else {
      editionText = "Studio Pro";
      fullTitle = "TUNGAI.FUN Studio";
    }

    if (brandEdition) {
      brandEdition.textContent = editionText;
    }
    if (welcomeEdition) {
      welcomeEdition.textContent = editionText;
    }
    if (chatTitle && (chatTitle.textContent.indexOf("TUNGAI.FUN") !== -1)) {
      chatTitle.textContent = fullTitle;
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
    const pid = (user.plan_id || user.ai_tier || "trial").toLowerCase();
    let ai = "Coder v1.0";
    if (pid === "owner" || pid === "business") {
      ai = "Coder Pro VIP";
    } else if (pid === "pro") {
      ai = "Coder Pro";
    } else if (pid === "basic") {
      ai = "Coder v1.0";
    } else {
      ai = "Coder v1.0";
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
      if (b.metaEl) {
        b.metaEl.textContent = "";
        b.metaEl.style.display = "none";
      }
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
    if (pid === 'business' || pid === 'owner') {
      if (typeof btnManageTeam !== 'undefined' && btnManageTeam) btnManageTeam.classList.remove('hidden');
      if (typeof btnManageTeamTop !== 'undefined' && btnManageTeamTop) btnManageTeamTop.classList.remove('hidden');
    } else {
      if (typeof btnManageTeam !== 'undefined' && btnManageTeam) btnManageTeam.classList.add('hidden');
      if (typeof btnManageTeamTop !== 'undefined' && btnManageTeamTop) btnManageTeamTop.classList.add('hidden');
    }
    // Sidebar chip: always show Gói Pro / Basic / …
    if (els.modelChip && user) {
      els.modelChip.classList.remove("login-cta");
      els.modelChip.textContent = planLabel(user) || "Gói " + planDisplayName(user);
    }
  }

  async function refreshPlanFromServer() {
    if (!googleSession) return false;
    try {
      const r = await apiFetch("/api/auth/me", { cache: "no-store" });
      if (!r.ok) return false;
      const text = await r.text();
      if (looksLikeNgrokHtml(text)) return false;
      const j = JSON.parse(text);
      if (j && j.user) {
        applyUserUi(j.user);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function applyUserUi(user) {
    googleUser = user || null;
    try { updateBrandEdition(user);
    try { checkTeamVisibility(user); } catch(e) {} } catch(e) {}
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
      if (els.userPillImg) els.userPillImg.src = "assets/tungdevai-core-logo.jpg?v=core2026";
      if (els.userAvatar) els.userAvatar.src = "assets/tungdevai-core-logo.jpg?v=core2026";
    }
    const emailLine = user.email || name;
    // Menu: email riêng, gói riêng
    if (els.accountMenuEmail) els.accountMenuEmail.textContent = emailLine;
    if (els.accountMenuEmailTop) els.accountMenuEmailTop.textContent = emailLine;
    setPlanMenu(user);
    updateBrandEdition(user);
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
    const r = await apiFetch("/api/auth/activate", {
      method: "POST",
      body: JSON.stringify({ code: code }),
    });
    const text = await r.text();
    if (looksLikeNgrokHtml(text)) {
      return { ok: false, message: ngrokHtmlErrorHint() };
    }
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
      apiFetch("/api/auth/logout", { method: "POST" }).catch(function () {});
    }
    googleSession = "";
    googleUser = null;
    localStorage.removeItem(LS_GOOGLE);
    localStorage.removeItem(LS_GOOGLE_USER);
    applyUserUi(null);
    redirectToLogin();
  }

        async function restoreGoogleSession() {
    googleSession = (localStorage.getItem(LS_GOOGLE) || localStorage.getItem("jarvis_session_token") || getCookie("tungdev_session") || "").trim();
    if (googleSession) {
      localStorage.setItem(LS_GOOGLE, googleSession);
    }
    try {
      googleUser = JSON.parse(localStorage.getItem(LS_GOOGLE_USER) || "null");
    } catch (_) {
      googleUser = null;
    }

    // Paint UI immediately from cache so user never sees "Đăng nhập" if logged in
    if (googleUser) {
      applyUserUi(googleUser);
      showApp();
    }

    if (!googleSession && !googleUser) return false;

    // Verify / sync fresh plan from backend
    if (googleSession) {
      try {
        const r = await apiFetch("/api/auth/me", { cache: "no-store" });
        if (r.ok) {
          const text = await r.text();
          if (!looksLikeNgrokHtml(text)) {
            const j = JSON.parse(text);
            if (j && j.user) {
              applyUserUi(j.user);
              showApp();
              return true;
            }
          }
        }
      } catch (e) {
        // network issue - keep local session intact
      }
    }
    return !!(googleUser || googleSession);
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
      window.location.href = "login.html";
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
      const r = await fetch("config.json?v=8", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        cfgPublic = Object.assign(cfgPublic, j);
      }
    } catch (e) {
      /* use defaults */
    }
    if (els.tgLink && cfgPublic.telegramBot) els.tgLink.href = cfgPublic.telegramBot;
    if (els.appNameLabel && cfgPublic.appName && !isLoggedIn()) els.appNameLabel.textContent = cfgPublic.appName;
  }

  function _slimChats(list) {
    // Drop big base64 images so localStorage never blows quota
    return list.map(function (c) {
      return {
        id: c.id,
        title: c.title,
        updated: c.updated,
        sessionId: c.sessionId || "",
        pinned: !!c.pinned,
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
      const r = await apiFetch("/api/health", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const text = await r.text();
      if (looksLikeNgrokHtml(text)) throw new Error("ngrok html");
      const j = JSON.parse(text);
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

  let activeMenuChatId = null;

  function renderHistory() {
    if (!els.history) return;
    els.history.innerHTML = "";

    // Sort: Pinned chats first, then newest updated
    const sorted = chats.slice().sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updated || 0) - (a.updated || 0);
    });

    sorted.forEach((c) => {
      const isAct = c.id === activeId;
      const isPin = !!c.pinned;
      const title = c.title || "Chat mới";

      const row = document.createElement("div");
      row.className = "history-item" + (isAct ? " active" : "") + (isPin ? " pinned" : "");
      row.setAttribute("data-id", c.id);
      row.setAttribute("title", title);

      row.innerHTML = 
        '<span class="hist-title">' + escapeHtml(title) + '</span>' +
        '<div class="hist-actions">' +
          '<button type="button" class="hist-btn hist-pin-btn" data-id="' + c.id + '" title="' + (isPin ? 'Bỏ ghim' : 'Ghim đoạn chat') + '">' +
            '<svg class="pin-svg" width="14" height="14" viewBox="0 0 24 24" fill="' + (isPin ? '#34d399' : 'none') + '" stroke="' + (isPin ? '#34d399' : 'currentColor') + '" stroke-width="2">' +
              '<path d="M12 2v6m0 0l-3 3v4h6v-4l-3-3zM9 15h6M12 15v7"/>' +
            '</svg>' +
          '</button>' +
          '<button type="button" class="hist-btn hist-menu-btn" data-id="' + c.id + '" title="Tùy chọn khác">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
              '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>' +
            '</svg>' +
          '</button>' +
        '</div>';

      // Click to select chat
      row.addEventListener("click", (e) => {
        if (e.target.closest(".hist-btn, .hist-rename-input")) return;
        selectChat(c.id);
      });

      // Pin button click
      const pinBtn = row.querySelector(".hist-pin-btn");
      if (pinBtn) {
        pinBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          togglePinChat(c.id);
        });
      }

      // 3-dots Menu button click
      const menuBtn = row.querySelector(".hist-menu-btn");
      if (menuBtn) {
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openHistContextMenu(c.id, menuBtn);
        });
      }

      els.history.appendChild(row);
    });
  }

  function togglePinChat(id) {
    const c = chats.find((item) => item.id === id);
    if (c) {
      c.pinned = !c.pinned;
      persistChats();
      renderHistory();
    }
  }

  function startRenameChat(id) {
    const c = chats.find((item) => item.id === id);
    if (!c) return;
    const row = document.querySelector('.history-item[data-id="' + id + '"]');
    if (!row) return;

    const titleEl = row.querySelector(".hist-title");
    if (!titleEl) return;

    const currentTitle = c.title || "Chat mới";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "hist-rename-input";
    input.value = currentTitle;
    input.maxLength = 60;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const save = () => {
      const val = input.value.trim() || "Chat mới";
      c.title = val;
      persistChats();
      renderHistory();
      if (c.id === activeId && els.chatTitle) {
        els.chatTitle.textContent = val;
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        renderHistory();
      }
    });
    input.addEventListener("blur", save);
  }

  function openHistContextMenu(id, btnEl) {
    const menu = document.getElementById("histContextMenu");
    if (!menu) return;
    activeMenuChatId = id;

    const c = chats.find((item) => item.id === id);
    const pinLabel = document.getElementById("histMenuPinLabel");
    if (pinLabel && c) {
      pinLabel.textContent = c.pinned ? "Bỏ ghim đoạn chat" : "Ghim lên đầu";
    }

    const rect = btnEl.getBoundingClientRect();
    menu.classList.remove("hidden");
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.left = Math.max(10, rect.right - 175) + "px";

    // Mark parent active for hover state
    document.querySelectorAll(".history-item").forEach(r => r.classList.remove("menu-open"));
    const parentRow = btnEl.closest(".history-item");
    if (parentRow) parentRow.classList.add("menu-open");
  }

  function closeHistContextMenu() {
    const menu = document.getElementById("histContextMenu");
    if (menu) menu.classList.add("hidden");
    activeMenuChatId = null;
    document.querySelectorAll(".history-item").forEach(r => r.classList.remove("menu-open"));
  }

  // Bind History Menu Actions
  document.addEventListener("DOMContentLoaded", function () {
    const menuPin = document.getElementById("histMenuPin");
    const menuRename = document.getElementById("histMenuRename");
    const menuDelete = document.getElementById("histMenuDelete");

    if (menuPin) {
      menuPin.onclick = function (e) {
        e.stopPropagation();
        if (activeMenuChatId) togglePinChat(activeMenuChatId);
        closeHistContextMenu();
      };
    }

    if (menuRename) {
      menuRename.onclick = function (e) {
        e.stopPropagation();
        const targetId = activeMenuChatId;
        closeHistContextMenu();
        if (targetId) startRenameChat(targetId);
      };
    }

    if (menuDelete) {
      menuDelete.onclick = function (e) {
        e.stopPropagation();
        const targetId = activeMenuChatId;
        closeHistContextMenu();
        if (targetId) {
          if (confirm("Bạn có chắc chắn muốn xóa đoạn chat này?")) {
            deleteChat(targetId);
          }
        }
      };
    }

    // Close menu on outside click
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#histContextMenu, .hist-menu-btn")) {
        closeHistContextMenu();
      }
    });
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

    
  function quickHighlightCode(lang, code) {
    const l = String(lang || "").toLowerCase();
    let s = escapeHtml(code);

    if (l === "html" || l === "xml" || l === "svg") {
      // HTML comments
      s = s.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="token comment syn-comm">$1</span>');
      // Doctype
      s = s.replace(/(&lt;!DOCTYPE[^&]*&gt;)/gi, '<span class="token doctype syn-comm">$1</span>');
      // Tags and attributes
      s = s.replace(/(&lt;\/?)([a-zA-Z0-9:-]+)((?:\s+[a-zA-Z0-9_:-]+(?:=(?:&quot;[^&]*&quot;|&#39;[^&#39;]*&#39;|[^\s&gt;]+))?)*)(\s*\/?&gt;)/g, function(_, open, tag, attrs, close) {
        let parsedAttrs = attrs.replace(/([a-zA-Z0-9_:-]+)(=)(&quot;[^&]*&quot;|&#39;[^&#39;]*&#39;|[^\s&gt;]+)/g, '<span class="token attr-name syn-attr">$1</span><span class="token punctuation syn-punc">$2</span><span class="token attr-value syn-val">$3</span>');
        return '<span class="token punctuation syn-punc">' + open + '</span><span class="token tag syn-tag">' + tag + '</span>' + parsedAttrs + '<span class="token punctuation syn-punc">' + close + '</span>';
      });
      return s;
    }

    if (l === "js" || l === "javascript" || l === "ts" || l === "typescript" || l === "py" || l === "python" || l === "cpp" || l === "c" || l === "java" || l === "php") {
      // Comments
      s = s.replace(/(\/\/[^\n]*|#[^\n]*)/g, '<span class="token comment syn-comm">$1</span>');
      // Strings
      s = s.replace(/(&quot;[^"]*&quot;|&#39;[^&#39;]*&#39;|`[^`]*`)/g, '<span class="token string syn-str">$1</span>');
      // Keywords
      const kwds = "function|const|let|var|return|async|await|if|else|for|while|import|from|export|class|def|elif|try|except|finally|public|private|static|new|this|typeof|instanceof";
      const kwdRegex = new RegExp('\\b(' + kwds + ')\\b', 'g');
      s = s.replace(kwdRegex, '<span class="token keyword syn-kwd">$1</span>');
      // Booleans & numbers
      s = s.replace(/\b(true|false|null|undefined|None|True|False)\b/g, '<span class="token boolean syn-num">$1</span>');
      s = s.replace(/\b(\d+)\b/g, '<span class="token number syn-num">$1</span>');
      // Functions
      s = s.replace(/\b([a-zA-Z_0-9]+)(?=\s*\()/g, '<span class="token function syn-fn">$1</span>');
      return s;
    }

    return s;
  }

  const rawCodeStorage = window.rawCodeStorage;

  function getPureCodeFromBlock(blockEl, btnEl) { return window.getPureCodeFromBlock(blockEl, btnEl); }
  function _oldGetPureCode(blockEl, btnEl) {
    if (btnEl && btnEl.hasAttribute("data-code-id")) {
      const id = Number(btnEl.getAttribute("data-code-id"));
      if (rawCodeStorage[id] != null) return rawCodeStorage[id];
    }
    if (blockEl && blockEl.hasAttribute("data-code-id")) {
      const id = Number(blockEl.getAttribute("data-code-id"));
      if (rawCodeStorage[id] != null) return rawCodeStorage[id];
    }
    const codeEl = blockEl ? blockEl.querySelector("pre code, pre") : null;
    let raw = codeEl ? codeEl.textContent || "" : "";
    return unescapeHtml(raw);
  }

  function isExecutableLang(lang) {
    const l = String(lang || "").trim().toLowerCase();
    if (["html", "htm", "svg", "xml", "web"].includes(l)) return "web";
    if (["javascript", "js", "ts", "typescript", "node"].includes(l)) return "js";
    if (["python", "py", "python3"].includes(l)) return "py";
    if (["cpp", "c++", "c", "cc", "hpp"].includes(l)) return "cpp";
    return null;
  }

  function buildCodeBlockHtml(lang, code) {
    const rawLang = String(lang || "code").trim().toLowerCase().replace(/[^a-z0-9_+#-]/gi, "") || "code";
    const unescapedBody = unescapeHtml(String(code || "").replace(/\r\n/g, "\n").replace(/\n$/, ""));
    const execType = isExecutableLang(rawLang);
    const codeId = rawCodeStorage.length;
    rawCodeStorage.push(unescapedBody);

    let runBtnHtml = "";
    if (execType === "cpp") {
      runBtnHtml = '<button type="button" class="btn-code-action btn-run-preview btn-run-cpp" data-exec="cpp" data-code-id="' + codeId + '" onclick="window.openCloudTerminal && window.openCloudTerminal(\'cpp\', this)" title="Biên dịch & Chạy C++ Siêu Tốc (G++ C++20)"><span class="run-icon">⚡</span> Chạy C++</button>';
    } else if (execType === "web") {
      runBtnHtml = '<button type="button" class="btn-code-action btn-run-preview" data-exec="web" data-code-id="' + codeId + '" onclick="window.openWebSandboxModal && window.openWebSandboxModal(this)" title="Chạy thử giao diện Web / Live Preview">🌐 Chạy Web</button>';
    } else if (execType === "js") {
      runBtnHtml = '<button type="button" class="btn-code-action btn-run-preview" data-exec="js" data-code-id="' + codeId + '" onclick="window.openCloudTerminal && window.openCloudTerminal(\'js\', this)" title="Chạy thử JavaScript (Node.js)">▶ Chạy JS</button>';
    } else if (execType === "py") {
      runBtnHtml = '<button type="button" class="btn-code-action btn-run-preview" data-exec="py" data-code-id="' + codeId + '" onclick="window.openCloudTerminal && window.openCloudTerminal(\'py\', this)" title="Chạy thử Python Sandbox">▶ Chạy Python</button>';
    }

    return (
      '<div class="code-block" data-lang="' + escapeHtml(rawLang) + '" data-code-id="' + codeId + '">' +
      '<div class="code-block-bar">' +
      '<div class="code-block-left">' +
      '<span class="code-lang-badge"><span class="code-lang-dot"></span>' + escapeHtml(rawLang.toUpperCase()) + '</span>' +
      '</div>' +
      '<div class="code-block-actions">' +
      runBtnHtml +
      '<button type="button" class="btn-code-action btn-download-file" data-lang="' + escapeHtml(rawLang) + '" data-code-id="' + codeId + '" title="Tải mã nguồn này về máy tính">💾 Tải file (.' + escapeHtml(rawLang) + ')</button>' +
      '<button type="button" class="btn-code-action code-copy" data-code-id="' + codeId + '" title="Sao chép toàn bộ code">📋 Sao chép</button>' +
      '</div>' +
      '</div>' +
      '<pre class="language-' + escapeHtml(rawLang) + '"><code class="language-' + escapeHtml(rawLang) + '">' +
      escapeHtml(unescapedBody) +
      '</code></pre>' +
      '</div>'
    );
  }

  function formatMarkdown(text) {
    if (!text) return "";
    let s = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const codeBlocks = [];

    function pushBlock(lang, code) {
      codeBlocks.push(buildCodeBlockHtml(lang, code));
      return "\n\n@@CODEBLOCK" + (codeBlocks.length - 1) + "@@\n\n";
    }

    // Parse <think>...</think> Deep Reasoning blocks
    s = s.replace(/<think>([\s\S]*?)<\/think>/gi, function (_, thought) {
      return '<details class="deep-thinking-card" open>' +
        '<summary class="thinking-summary">' +
          '<span class="thinking-icon">🧠</span>' +
          '<span class="thinking-label">Quá trình tư duy sâu & Kiến trúc (Deep Reasoning)</span>' +
          '<span class="thinking-badge">Đã hoàn thành</span>' +
        '</summary>' +
        '<div class="thinking-content">' + escapeHtml(thought.trim()) + '</div>' +
      '</details>';
    });

    // Extract code blocks first before any other markdown processing
    s = s.replace(/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g, function (_, lang, code) {
      return pushBlock(lang, code);
    });

    // 1. Parse markdown images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(((?:https?:\/\/|\/|\.)[^\s)]+)\)/g, function (_, alt, url) {
      const cleanAlt = escapeHtml(alt || "AI Image");
      return '<div class="image-preview-wrap">' +
        '<div class="image-loading-spinner">🎨 Đang tải ảnh nghệ thuật HD...</div>' +
        '<img src="' + url + '" alt="' + cleanAlt + '" class="ai-generated-image" onload="const sp=this.previousElementSibling; if(sp) sp.style.display=\'none\'; this.classList.add(\'loaded\');" onerror="this.onerror=null; this.src=\'https://image.pollinations.ai/prompt/cute%20boy%20masterpiece%20portrait?width=768&height=768&nologo=true\';" onclick="window.open(this.src,\'_blank\')" />' +
        '<div class="image-actions-bar">' +
        '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="btn-image-action">🔍 Xem ảnh Full-HD</a>' +
        '<a href="' + url + '" target="_blank" download class="btn-image-action">⬇ Tải về</a>' +
        '</div>' +
        '</div>';
    });

    // Auto convert textual download mentions into real interactive buttons
    s = s.replace(/(?:bấm\s+)?(?:nút\s+)?(?:`|\[)?💾\s*Tải\s*file(?:`|\])?/gi, function () {
      return '<button type="button" class="btn-inline-download" title="Bấm vào đây để tải file mã nguồn về máy tính">💾 Tải file ngay</button>';
    });

    // 2. Parse markdown links: [text](url)
    s = s.replace(/(?<!\[)\[([^\]]+)\]\(((?:https?:\/\/|\/|\.)[^\s)]+)\)/g, function (_, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="chat-link">' + escapeHtml(label) + '</a>';
    });

    // 3. Headings
    s = s.replace(/^### (.+)$/gm, function(_, h) { return '<h3 class="chat-h3">' + escapeHtml(h) + '</h3>'; });
    s = s.replace(/^## (.+)$/gm, function(_, h) { return '<h2 class="chat-h2">' + escapeHtml(h) + '</h2>'; });
    s = s.replace(/^# (.+)$/gm, function(_, h) { return '<h1 class="chat-h1">' + escapeHtml(h) + '</h1>'; });

    // 4. Blockquotes / Meta rows
    s = s.replace(/^> (.+)$/gm, function(_, m) { return '<div class="chat-meta-row">' + escapeHtml(m) + '</div>'; });

    // 5. Inline formatting
    s = s.replace(/`([^`\n]+)`/g, function(_, c) { return '<code>' + escapeHtml(c) + '</code>'; });
    s = s.replace(/\*\*([^\*]+)\*\*/g, function(_, b) { return '<strong>' + escapeHtml(b) + '</strong>'; });
    s = s.replace(/\*([^\*]+)\*/g, function(_, em) { return '<em>' + escapeHtml(em) + '</em>'; });
    s = s.replace(/(^|\n)[*-] (.+)/g, "$1• $2");

    s = s
      .split(/\n{2,}/)
      .map(function (p) {
        const t = p.trim();
        if (!t) return "";
        if (/^@@CODEBLOCK\d+@@$/.test(t)) return t;
        if (/^<div class="image-preview-wrap">/.test(t)) return t;
        if (/^<h[1-3]/.test(t)) return t;
        if (/^<details/.test(t)) return t;
        if (t.indexOf("@@CODEBLOCK") !== -1) {
          return t.replace(/(@@CODEBLOCK\d+@@)/g, "\n$1\n");
        }
        return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
      })
      .join("");

    // Restore code blocks
    s = s.replace(/(?:<p>)?\s*(@@CODEBLOCK\d+@@)\s*(?:<\/p>)?/g, "$1");
    s = s.replace(/@@CODEBLOCK(\d+)@@/g, function (_, i) {
      return codeBlocks[Number(i)] || "";
    });
    return s;
  }
  window.formatMarkdown = formatMarkdown;

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
      const codeEl = pre.querySelector("code");
      let lang = "code";
      if (codeEl) {
        const cls = codeEl.className || "";
        const m = cls.match(/lang(?:uage)?-([a-z0-9_+#-]+)/i);
        if (m) lang = m[1];
      }
      const rawCode = pre.textContent || "";
      const tempWrap = document.createElement("div");
      tempWrap.innerHTML = buildCodeBlockHtml(lang, rawCode);
      const newBlock = tempWrap.firstElementChild;
      if (newBlock) {
        pre.parentNode.insertBefore(newBlock, pre);
        pre.remove();
      }
    });
  }

  
  /* ============================================================
     LIVE CODE EXECUTION & RUNNER ENGINE
  ============================================================ */
  let pyodideInstance = null;
  let pyodideLoading = false;

  async function getPyodide() {
    if (pyodideInstance) return pyodideInstance;
    if (pyodideLoading) {
      while (pyodideLoading) {
        await new Promise(r => setTimeout(r, 100));
      }
      return pyodideInstance;
    }
    pyodideLoading = true;
    try {
      if (!window.loadPyodide) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js";
          script.onload = resolve;
          script.onerror = () => reject(new Error("Không thể tải Pyodide CDN"));
          document.head.appendChild(script);
        });
      }
      pyodideInstance = await window.loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/"
      });
      return pyodideInstance;
    } finally {
      pyodideLoading = false;
    }
  }

  function handleRunCodeClick(btn) {
    const block = btn.closest(".code-block");
    if (!block) return;
    const execType = btn.getAttribute("data-exec");
    const codeEl = block.querySelector("pre code, pre");
    const code = codeEl ? codeEl.textContent || "" : "";

    // Toggle close if already open
    const existingSandbox = block.querySelector(".code-live-sandbox, .code-live-terminal");
    if (existingSandbox) {
      existingSandbox.remove();
      btn.classList.remove("active");
      return;
    }

    btn.classList.add("active");

    if (execType === "web") {
      runWebPreview(block, code, btn);
    } else if (execType === "js") {
      runJsCode(block, code, btn);
    } else if (execType === "py") {
      runPythonCode(block, code, btn);
    }
  }

  function runWebPreview(block, code, btn) {
    const wrap = document.createElement("div");
    wrap.className = "code-live-sandbox";
    wrap.innerHTML = `
      <div class="sandbox-toolbar">
        <div class="sandbox-status">
          <span class="sandbox-status-dot"></span>
          <span>Live Web Sandbox</span>
        </div>
        <div class="sandbox-tools">
          <button type="button" class="sandbox-btn btn-reload" title="Tải lại giao diện">🔄 Tải lại</button>
          <button type="button" class="sandbox-btn btn-expand" title="Mở rộng / Thu nhỏ">⛶ Mở rộng</button>
          <button type="button" class="sandbox-btn btn-close" title="Đóng preview">✖ Đóng</button>
        </div>
      </div>
      <iframe class="sandbox-frame" sandbox="allow-scripts allow-modals allow-forms"></iframe>
    `;

    block.appendChild(wrap);
    const iframe = wrap.querySelector(".sandbox-frame");

    function renderContent() {
      let doc = code.trim();
      if (!doc.toLowerCase().includes("<html") && !doc.toLowerCase().includes("<!doctype")) {
        doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 1rem; color: #1e293b; }
  </style>
</head>
<body>
  ${doc}
</body>
</html>`;
      }
      iframe.srcdoc = doc;
    }

    renderContent();

    wrap.querySelector(".btn-reload").addEventListener("click", () => renderContent());
    wrap.querySelector(".btn-expand").addEventListener("click", () => {
      if (iframe.style.height === "550px") {
        iframe.style.height = "320px";
      } else {
        iframe.style.height = "550px";
      }
    });
    wrap.querySelector(".btn-close").addEventListener("click", () => {
      wrap.remove();
      btn.classList.remove("active");
    });
  }

  function runJsCode(block, code, btn) {
    const wrap = document.createElement("div");
    wrap.className = "code-live-terminal";
    wrap.innerHTML = `
      <div class="terminal-header">
        <span>⚡ JavaScript Output (Console)</span>
        <button type="button" class="sandbox-btn btn-close-term" style="padding:1px 6px;">✖ Đóng</button>
      </div>
      <div class="terminal-logs"></div>
    `;

    block.appendChild(wrap);
    const logsEl = wrap.querySelector(".terminal-logs");
    wrap.querySelector(".btn-close-term").addEventListener("click", () => {
      wrap.remove();
      btn.classList.remove("active");
    });

    const logs = [];
    const pushLog = (type, ...args) => {
      const msg = args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ");
      logs.push({ type, msg });
      const line = document.createElement("div");
      line.className = `terminal-log-item ${type}`;
      line.textContent = `> ${msg}`;
      logsEl.appendChild(line);
    };

    try {
      const sandboxFn = new Function("console", `
        "use strict";
        ${code}
      `);
      const customConsole = {
        log: (...args) => pushLog("log", ...args),
        error: (...args) => pushLog("error", ...args),
        warn: (...args) => pushLog("warn", ...args),
        info: (...args) => pushLog("info", ...args),
      };
      const t0 = performance.now();
      const res = sandboxFn(customConsole);
      const elapsed = (performance.now() - t0).toFixed(1);
      if (res !== undefined) {
        pushLog("success", `[Return value]: ${typeof res === "object" ? JSON.stringify(res, null, 2) : res}`);
      }
      if (logs.length === 0) {
        pushLog("info", `Code chạy thành công (${elapsed}ms) — không có console.log`);
      }
    } catch (err) {
      pushLog("error", `Lỗi thực thi: ${err.message}`);
    }
  }

    async function runPythonCode(block, code, btn) {
    // 1. If Workspace panel exists, open it and sync file
    if (window.TungDevWorkspace) {
      window.TungDevWorkspace.openWorkspace();
      window.TungDevWorkspace.vfs.setFile("main.py", code);
      window.TungDevWorkspace.switchTab("terminal");
      window.TungDevWorkspace.terminal.log("SYSTEM", "🐍 Đang thực thi main.py...");
    }

    // 2. Open inline interactive terminal directly below the code block
    let wrap = block.querySelector(".code-live-terminal");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "code-live-terminal";
      wrap.innerHTML = `
        <div class="terminal-header">
          <span>🐍 Python Interactive Output (Pyodide & Server Engine)</span>
          <button type="button" class="sandbox-btn btn-close-term" style="padding:1px 6px;">✖ Đóng</button>
        </div>
        <div class="terminal-logs"><div class="terminal-log-item info">⏳ Đang khởi chạy môi trường Python...</div></div>
      `;
      block.appendChild(wrap);
      wrap.querySelector(".btn-close-term").addEventListener("click", () => {
        wrap.remove();
        btn.classList.remove("active");
      });
    }

    const logsEl = wrap.querySelector(".terminal-logs");
    logsEl.innerHTML = '<div class="terminal-log-item info">⏳ Đang chạy mã nguồn Python...</div>';

    const pushTerm = (type, text) => {
      const line = document.createElement("div");
      line.className = `terminal-log-item ${type || ""}`;
      line.textContent = text;
      logsEl.appendChild(line);
      if (window.TungDevWorkspace && window.TungDevWorkspace.terminal) {
        window.TungDevWorkspace.terminal.log(type === "error" ? "ERROR" : "LOG", text);
      }
    };

    // Method A: In-browser Pyodide WASM Engine
    try {
      const pyodide = await getPyodide();
      logsEl.innerHTML = "";
      pyodide.setStdout({
        batched: (str) => pushTerm("log", str)
      });
      pyodide.setStderr({
        batched: (str) => pushTerm("error", str)
      });

      const t0 = performance.now();
      const result = await pyodide.runPythonAsync(code);
      const elapsed = (performance.now() - t0).toFixed(1);

      if (result !== undefined && result !== null) {
        pushTerm("success", `[Return value]: ${String(result)}`);
      }
      if (!logsEl.children.length) {
        pushTerm("success", `✅ Thực thi Python thành công (${elapsed}ms)!`);
      }
      return;
    } catch (wasmErr) {
      console.warn("Pyodide WASM fallback to server:", wasmErr);
    }

    // Method B: Server Subprocess Execution Fallback (/api/run-code)
    try {
      const apiBase = resolveApiBase ? resolveApiBase() : "";
      const resp = await fetch(`${apiBase}/api/run-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: "python", code: code })
      });
      if (resp.ok) {
        const data = await resp.json();
        logsEl.innerHTML = "";
        if (data.stdout) {
          data.stdout.trim().split("\n").forEach(line => pushTerm("log", line));
        }
        if (data.stderr) {
          data.stderr.trim().split("\n").forEach(line => pushTerm("error", line));
        }
        if (!data.stdout && !data.stderr) {
          pushTerm("success", `✅ Code thực thi hoàn tất trong ${data.elapsed}s (exit code 0).`);
        }
        return;
      }
    } catch (serverErr) {
      console.error("Server run-code error:", serverErr);
    }

    logsEl.innerHTML = '<div class="terminal-log-item error">❌ Không thể chạy Python (Lỗi nạp môi trường).</div>';
  }


  
  function triggerPrismHighlight(root) {
    if (window.Prism && window.Prism.highlightAllUnder && root) {
      try {
        window.Prism.highlightAllUnder(root);
      } catch (e) {
        /* fallback to instant tokenizer */
      }
    }
  }

  function setAssistantHtml(el, text) {
    if (!el) return;
    el.innerHTML = formatMarkdown(text || "");
    enhanceCodeBlocks(el);
    triggerPrismHighlight(el);
  }

  function renderMessages() {
    const chat = activeChat();
    els.messages.innerHTML = "";
    if (!chat || !chat.messages.length) {
      els.messages.appendChild(els.welcome);
      els.welcome.style.display = "";
      bindSuggestions();
      els.chatTitle.textContent = "TUNGAI.FUN";
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
    row.className = "message-row " + role;

    if (role === "assistant") {
      const avImg = document.createElement("img");
      avImg.className = "message-avatar";
      avImg.src = "assets/tungdevai-core-logo.jpg?v=core2026";
      avImg.alt = "TUNGAI.FUN";
      row.appendChild(avImg);
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (images.length) {
      const wrap = document.createElement("div");
      wrap.className = "msg-images";
      images.forEach((src) => {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Anh";
        wrap.appendChild(img);
      });
      bubble.appendChild(wrap);
    }

    const contentEl = document.createElement("div");
    contentEl.className = "content";

    if (role === "assistant" && !(content || "").trim()) {
      contentEl.innerHTML = '<div class="fx-loading-bubble" style="display:flex;gap:6px;padding:8px 0;"><span style="width:8px;height:8px;border-radius:50%;background:#34d399;animation:pulse-glow 1s infinite alternate;"></span><span style="width:8px;height:8px;border-radius:50%;background:#6ee7b7;animation:pulse-glow 1s infinite alternate 0.2s;"></span><span style="width:8px;height:8px;border-radius:50%;background:#a3e635;animation:pulse-glow 1s infinite alternate 0.4s;"></span></div>';
    } else if (role === "assistant") {
      setAssistantHtml(contentEl, content || "");
    } else {
      contentEl.textContent = content || "";
    }
    bubble.appendChild(contentEl);
    row.appendChild(bubble);

    if (role === "user") {
      const avUser = document.createElement("div");
      avUser.className = "message-avatar user-avatar-badge";
      avUser.textContent = "Bạn";
      row.appendChild(avUser);
    }

    els.messages.appendChild(row);
    if (scroll) scrollBottom();
    return contentEl;
  }

  function scrollBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function newChat() {
    stopThinkingAnimation();
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
    stopThinkingAnimation();
    activeId = id;
    const ac = activeChat();
    sessionId = (ac && ac.sessionId) ? ac.sessionId : id;
    localStorage.setItem(LS_SID, sessionId);
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

    const SEND_ICON_HTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  const STOP_ICON_HTML = '<span class="stop-btn-wrap"><svg class="stop-spin-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.25"></circle><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" class="stop-spin-circle"></circle></svg><span class="stop-square"></span></span>';

  function setBusy(v) {
    busy = v;
    if (els.send) {
      els.send.disabled = false;
      if (v) {
        els.send.classList.add("btn-generating");
        els.send.title = "Dừng tạo câu trả lời (Stop)";
        els.send.setAttribute("aria-label", "Dừng tạo câu trả lời");
        els.send.innerHTML = STOP_ICON_HTML;
      } else {
        els.send.classList.remove("btn-generating");
        els.send.title = "Gửi tin nhắn (Enter)";
        els.send.setAttribute("aria-label", "Gửi tin nhắn");
        els.send.innerHTML = SEND_ICON_HTML;
      }
    }
    if (els.input) els.input.disabled = false;
    if (els.btnPlus) els.btnPlus.disabled = !!v;
    if (els.modeBar) {
      els.modeBar.querySelectorAll(".mode-chip").forEach(function (b) {
        b.disabled = !!v;
      });
    }
    if (!v) setStreamStatus("");
  }

  
  /* ============================================================
     TUNGAI.FUN DYNAMIC THINKING & GENERATING MOTION LOGIC
     ============================================================ */
  let currentThinkingTimer = null;
  let activeThinkingContentEl = null;

  function getThinkingPhrases() {
    let modelName = "Google Gemini 3.8 High";
    try {
      const activeItem = document.querySelector(".model-opt-item.active");
      if (activeItem) {
        const titleEl = activeItem.querySelector(".model-opt-title");
        if (titleEl) modelName = titleEl.textContent.trim();
      }
    } catch (_) {}

    return [
      { icon: "🧠", text: "TUNGAI.FUN đang tiếp nhận và suy nghĩ..." },
      { icon: "⚡", text: "Đang làm rồi, đang kết nối " + modelName + "..." },
      { icon: "🛠️", text: "Đang phân tích dữ liệu và viết code..." },
      { icon: "✨", text: "Sắp xong rồi, đang trau chuốt câu trả lời..." },
      { icon: "🚀", text: "Gần xong rồi, đang đưa ra kết quả tốt nhất..." }
    ];
  }

  function startThinkingAnimation(contentEl) {
    stopThinkingAnimation();
    if (!contentEl) return;
    activeThinkingContentEl = contentEl;
    let step = 0;
    const phrases = getThinkingPhrases();

    contentEl.innerHTML = `
      <div class="tg-thinking-box">
        <div class="tg-thinking-orb-wrap">
          <span class="tg-thinking-pulse"></span>
          <span class="tg-thinking-spinner"></span>
          <span class="tg-thinking-icon">${phrases[0].icon}</span>
        </div>
        <div class="tg-thinking-text-wrap">
          <span class="tg-thinking-msg">${phrases[0].text}</span>
          <span class="tg-thinking-dots"><span></span><span></span><span></span></span>
        </div>
      </div>
    `;

    const iconEl = contentEl.querySelector(".tg-thinking-icon");
    const msgEl = contentEl.querySelector(".tg-thinking-msg");

    currentThinkingTimer = setInterval(() => {
      step++;
      const currentPhrases = getThinkingPhrases();
      const p = currentPhrases[step % currentPhrases.length];
      if (msgEl && iconEl) {
        msgEl.classList.add("anim-out");
        setTimeout(() => {
          if (iconEl) iconEl.textContent = p.icon;
          if (msgEl) {
            msgEl.textContent = p.text;
            msgEl.classList.remove("anim-out");
            msgEl.classList.add("anim-in");
            setTimeout(() => msgEl.classList.remove("anim-in"), 200);
          }
        }, 180);
      }
      scrollBottom();
    }, 2100);
  }

  function stopThinkingAnimation(contentEl) {
    if (currentThinkingTimer) {
      clearInterval(currentThinkingTimer);
      currentThinkingTimer = null;
    }
    const target = contentEl || activeThinkingContentEl;
    if (target) {
      const box = target.querySelector(".tg-thinking-box");
      if (box) box.remove();
    }
    activeThinkingContentEl = null;
  }


  function stopGeneration() {
    stopThinkingAnimation();
    if (currentAbortController) {
      try { currentAbortController.abort(); } catch(_) {}
      currentAbortController = null;
    }
    setBusy(false);
    setStreamStatus("⏹ Đã dừng tạo câu trả lời.");
    const typingRows = document.querySelectorAll(".message-row.assistant.typing");
    typingRows.forEach(row => row.classList.remove("typing"));
    if (els.input) els.input.focus();
  }

  function setStreamStatus(text) {
    if (els.streamStatus) {
      els.streamStatus.hidden = true;
      els.streamStatus.innerHTML = "";
    }
  }

  function setActiveMode(modeId, opts) {
    opts = opts || {};
    var id = String(modeId || "default").toLowerCase();
    if (!MODE_LABELS[id]) id = "default";
    activeMode = id;
    localStorage.setItem(LS_MODE, id);
    if (els.modeBadge) els.modeBadge.textContent = MODE_LABELS[id] || id;
    const agentIcons = { coder: "💻", security: "🛡️", marketing: "📈", business: "💼", tutor: "🎓", data: "📊", default: "✨" };
    const agentNames = { coder: "Coder Pro", security: "Hacker Mũ Trắng", marketing: "Marketing Viral", business: "Cố Vấn Kinh Doanh", tutor: "Gia Sư AI", data: "Data Scientist", default: "Đa Năng" };
    const iconEl = document.getElementById("agentSelectIcon");
    const nameEl = document.getElementById("agentSelectName");
    if (iconEl) iconEl.textContent = agentIcons[id] || "🤖";
    if (nameEl) nameEl.textContent = agentNames[id] || (MODE_LABELS[id] || id);
    if (opts.announce) {
      var tip =
        id === "coder"
          ? "Mode Coder — code production-ready, temp thấp."
          : "Mode " + (MODE_LABELS[id] || id) + " đã bật.";
      if (els.input) els.input.placeholder = "Nhắn tin… (" + (MODE_LABELS[id] || id) + ") · /plan /code /build /help";
      console.info("[TUNGAI.FUN]", tip);
    }
  }

  function bindModeBar() {
    if (!els.modeBar) return;
    els.modeBar.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest && e.target.closest(".mode-chip");
      if (!btn || busy) return;
      setActiveMode(btn.getAttribute("data-mode"), { announce: true });
    });
    setActiveMode(activeMode);
  }

  function clearPendingImages() {
    pendingImages = [];
    pendingAttachments = [];
    renderAttachPreview();
  }

  function renderAttachPreview() {
    if (!els.attachPreview) return;
    const hasItems = (pendingImages && pendingImages.length > 0) || (pendingAttachments && pendingAttachments.length > 0);
    if (!hasItems) {
      els.attachPreview.hidden = true;
      els.attachPreview.innerHTML = "";
      return;
    }
    els.attachPreview.hidden = false;
    els.attachPreview.innerHTML = "";

    // 1. Render Images (Compact square thumbnail with floating X button on top-right)
    (pendingImages || []).forEach((src, i) => {
      const chip = document.createElement("div");
      chip.className = "attach-thumb-card";
      chip.innerHTML = 
        '<div class="thumb-img-wrap">' +
          '<img src="' + src + '" alt="attachment" />' +
          '<button type="button" class="btn-remove-thumb" title="Xóa ảnh" aria-label="Xóa">✕</button>' +
        '</div>';
      chip.querySelector(".btn-remove-thumb").onclick = () => {
        pendingImages.splice(i, 1);
        renderAttachPreview();
      };
      els.attachPreview.appendChild(chip);
    });

    // 2. Render Document/Code attachments
    (pendingAttachments || []).forEach((att, i) => {
      const chip = document.createElement("div");
      chip.className = "attach-doc-card";
      chip.innerHTML = 
        '<span class="doc-icon">📄</span>' +
        '<div class="doc-info">' +
          '<span class="doc-name">' + escapeHtml(att.filename || "Tệp đính kèm") + '</span>' +
          '<span class="doc-meta">' + escapeHtml(att.meta || "") + '</span>' +
        '</div>' +
        '<button type="button" class="btn-remove-doc" title="Xóa tệp" aria-label="Xóa">✕</button>';
      chip.querySelector(".btn-remove-doc").onclick = () => {
        pendingAttachments.splice(i, 1);
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
    if (looksLikeNgrokHtml(errText)) return ngrokHtmlErrorHint();
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
    } catch (e) {
      // HTML/plain noise
      if (/<!DOCTYPE|<html/i.test(String(errText || ""))) {
        return ngrokHtmlErrorHint();
      }
    }
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
      startThinkingAnimation(contentEl);
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
        stopThinkingAnimation(contentEl);
        contentEl.innerHTML = "";
        contentEl.parentElement.parentElement.classList.remove("typing");
        setAssistantHtml(contentEl, msg);
        chat.messages.push({ role: "assistant", content: msg });
        chat.updated = Date.now();
        persistChats();
      } catch (err) {
        stopThinkingAnimation(contentEl);
        contentEl.innerHTML = "";
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

    // Client-side /mode for instant UI switch (server also handles)
    var modeCmd = text.match(/^\/mode(?:\s+(\S+))?$/i);
    if (modeCmd) {
      var mid = (modeCmd[1] || "").toLowerCase();
      if (mid && MODE_LABELS[mid]) {
        setActiveMode(mid, { announce: true });
      }
      // Fall through so server also confirms in chat transcript
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
    startThinkingAnimation(contentEl);
    setBusy(true);
    setStreamStatus("Đang kết nối AI…");

    try {
      const base = apiBase();
      if (!base) {
        throw new Error(
          "Chưa có API server (apiBase trống). Mở http://127.0.0.1:7860 hoặc bật ngrok / BAT_TUNGAI.FUN_ONLINE.bat"
        );
      }
      let res;
      try {
        // Multi-turn context: take last 10 messages from current conversation
        const prevMsgs = (chat.messages || []).slice(-10).map(function(m) {
          return { role: m.role, content: m.content };
        });

        currentAbortController = new AbortController();
        res = await apiFetch("/api/chat", {
          method: "POST",
          signal: currentAbortController.signal,
          body: JSON.stringify({
            message: payloadText,
            session_id: sessionId || chat.sessionId || chat.id,
            stream: true,
            mode: activeMode,
            model: activeModel,
            web_search: !!webSearchEnabled,
            attachments: pendingAttachments.slice(),
            history: prevMsgs,
          }),
        });
      } catch (netErr) {
        throw new Error(
          "Không kết nối được API AI (server/ngrok tắt).\n" +
            "→ PC: chạy Desktop\\BAT_TUNGAI.FUN_ONLINE.bat\n" +
            "→ Local: http://127.0.0.1:7860/chat.html\n" +
            "→ Online: link ngrok + đăng nhập lại"
        );
      }

      const ctypePeek = res.headers.get("content-type") || "";
      // ngrok free sometimes returns HTML interstitial with 200
      if (ctypePeek.indexOf("text/html") !== -1) {
        const htmlBody = await res.text();
        if (looksLikeNgrokHtml(htmlBody)) {
          throw new Error(ngrokHtmlErrorHint());
        }
        throw new Error("Server trả HTML thay vì API. Kiểm tra tunnel/server.");
      }

      if (!res.ok) {
        const errText = await res.text();
        if (looksLikeNgrokHtml(errText)) {
          throw new Error(ngrokHtmlErrorHint());
        }
        if (res.status === 401) {
          throw new Error(
            "Phiên làm việc cần làm mới. Hãy nhấp vào 'Đăng nhập' ở thanh bên trái để đăng nhập lại."
          );
        }
        throw new Error(parseApiError(res.status, errText.slice(0, 800)));
      }

      const ctype = res.headers.get("content-type") || "";
      let full = "";
      let gotDelta = false;
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
              if (j.type === "meta") {
                if (j.session_id) {
                  sessionId = j.session_id;
                  localStorage.setItem(LS_SID, sessionId);
                  var ac = activeChat();
                  if (ac) ac.sessionId = sessionId;
                  persistChats();
                }
                if (j.mode && MODE_LABELS[j.mode]) {
                  setActiveMode(j.mode);
                }
                if (j.ai_label || j.ai_model) {
                  lastModel = j.ai_label || j.ai_model;
                  if (els.modelChip && isLoggedIn()) {
                    // keep plan info; model shown on status
                  }
                }
                if (j.agent && j.agent !== "chat") {
                  setStreamStatus(
                    (j.agent === "build" ? "🔧" : "⚙️") +
                      " Agent " +
                      j.agent +
                      " · " +
                      (j.ai_label || j.ai_model || "")
                  );
                } else {
                  setStreamStatus(
                    "✦ " +
                      (MODE_LABELS[activeMode] || activeMode) +
                      " · " +
                      (j.ai_label || j.ai_model || "streaming…")
                  );
                }
              }
              if (j.type === "status" && j.text) {
                setStreamStatus(j.text);
              }
              if (j.type === "delta" && j.text) {
                if (!gotDelta) {
                  gotDelta = true;
                  stopThinkingAnimation(contentEl);
                  contentEl.innerHTML = "";
                  contentEl.parentElement.parentElement.classList.remove("typing");
                  setStreamStatus("");
                }
                full += j.text;
                setAssistantHtml(contentEl, full);
                scrollBottom();
              }
              if (j.type === "done" && j.mode && MODE_LABELS[j.mode]) {
                setActiveMode(j.mode);
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
        stopThinkingAnimation(contentEl);
        contentEl.innerHTML = "";
        if (j.session_id) {
          sessionId = j.session_id;
          localStorage.setItem(LS_SID, sessionId);
          var ac2 = activeChat();
          if (ac2) ac2.sessionId = sessionId;
        }
        if (j.mode && MODE_LABELS[j.mode]) setActiveMode(j.mode);
      }

      contentEl.parentElement.parentElement.classList.remove("typing");
      setStreamStatus("");
      if (!full) throw new Error("Server tra ve rong. Kiem tra webapp dang chay?");
      setAssistantHtml(contentEl, full);
      chat.messages.push({ role: "assistant", content: full });
      chat.updated = Date.now();
      persistChats();
      renderHistory();
      setStatus(true);
      // Refresh quota / plan chip after each message
      if (googleSession) {
        refreshPlanFromServer().catch(function () {});
      }
    } catch (err) {
      stopThinkingAnimation(contentEl);
      contentEl.innerHTML = "";
      contentEl.parentElement.parentElement.classList.remove("typing");
      setStreamStatus("");
      const em = String(err.message || err);
      setAssistantHtml(
        contentEl,
        "**Lỗi**\n\n" +
          em +
          "\n\nGợi ý:\n" +
          "1. PC bật: `Desktop\\BAT_TUNGAI.FUN_ONLINE.bat` (web + ngrok)\n" +
          "2. Mở: http://127.0.0.1:7860/chat.html (cùng máy)\n" +
          "3. Phiên hết hạn → [Đăng nhập lại](login.html?next=chat.html)\n" +
          "4. Hết quota? [Mua gói VIP](pricing.html)\n" +
          "5. Bot Telegram: https://t.me/grokapiai_bot"
      );
      setStatus(false);
      if (/hết hạn|Cần đăng nhập|401/i.test(em)) {
        // Do not force redirect - allow user to stay in chat
      }
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
  bindModeBar();
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) {
      stopGeneration();
      return;
    }
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
    // Boot chat UI if chat elements exist
    if (!document.getElementById("messages") && !document.getElementById("input") && !document.getElementById("app")) {
      return;
    }

    await loadPublicConfig();
    try {
      if (apiBase()) {
        const r = await apiFetch("/api/config", { cache: "no-store" });
        if (r.ok) {
          const text = await r.text();
          if (!looksLikeNgrokHtml(text)) {
            serverConfig = Object.assign(serverConfig, JSON.parse(text));
          }
        }
      }
    } catch (e) {
      /* server offline — restore may use cache */
    }

    let ok = await restoreGoogleSession();
    if (!ok && !googleUser) {
      applyUserUi(null);
      showApp();
      ok = true;
    } else {
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
    renderHistory();
    renderMessages();
    bindSuggestions();
    if (ok) {
      await pingServer();
      if (sessionId && isLoggedIn()) {
        try {
          const r = await apiFetch(
            "/api/chat/history?session_id=" + encodeURIComponent(sessionId),
            { cache: "no-store" }
          );
          if (r.ok) {
            const text = await r.text();
            if (!looksLikeNgrokHtml(text)) {
              const j = JSON.parse(text);
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
          }
        } catch (e) {
          /* offline ok */
        }
      }
    } else {
      renderGoogleButton();
    }
  })();

  // =========================================================================
  // AI MODEL SELECTOR CONTROLLER
  // =========================================================================
  const LS_MODEL = "jarvis_ai_model_v1";
  let activeModel = localStorage.getItem(LS_MODEL) || "coder-v1";

  const btnModelSelect = document.getElementById("btnModelSelect");
  const modelDropdown = document.getElementById("modelDropdown");
  const modelSelectIcon = document.getElementById("modelSelectIcon");
  const modelSelectName = document.getElementById("modelSelectName");

  function initModelSelector() {
    if (!btnModelSelect || !modelDropdown) return;

    applyModel(activeModel, false);

    btnModelSelect.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !modelDropdown.classList.contains("hidden");
      if (isOpen) {
        closeModelDropdown();
      } else {
        openModelDropdown();
      }
    });

    document.querySelectorAll(".model-opt-item").forEach((item) => {
      item.addEventListener("click", () => {
        const modelId = item.dataset.model || "coder-v1";
        applyModel(modelId, true);
        closeModelDropdown();
      });
    });

    document.addEventListener("click", (e) => {
      if (!modelDropdown.contains(e.target) && !btnModelSelect.contains(e.target)) {
        closeModelDropdown();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModelDropdown();
    });
  }

  function openModelDropdown() {
    modelDropdown.classList.remove("hidden");
    btnModelSelect.classList.add("active-open");
    btnModelSelect.setAttribute("aria-expanded", "true");
  }

  function closeModelDropdown() {
    modelDropdown.classList.add("hidden");
    btnModelSelect.classList.remove("active-open");
    btnModelSelect.setAttribute("aria-expanded", "false");
  }

  function applyModel(modelId, showHint) {
    activeModel = modelId;
    localStorage.setItem(LS_MODEL, modelId);

    const activeItem = document.querySelector(`.model-opt-item[data-model="${modelId}"]`);
    if (activeItem) {
      document.querySelectorAll(".model-opt-item").forEach((it) => it.classList.remove("active"));
      activeItem.classList.add("active");

      const icon = activeItem.dataset.icon || "🪐";
      const label = activeItem.dataset.label || "Quantum 4.0";
      if (modelSelectIcon) modelSelectIcon.textContent = icon;
      if (modelSelectName) modelSelectName.textContent = label;

      if (showHint && typeof showToast === "function") {
        showToast(`⚡ Đã chuyển sang mô hình: ${label}`);
      }
    }
  }

  // Auto initialize on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initModelSelector);
  } else {
        const btnCloseWs = document.getElementById("btnCloseWorkspace");
    if (btnCloseWs) {
      btnCloseWs.onclick = () => {
        if (window.TungDevWorkspace) window.TungDevWorkspace.closeWorkspace();
      };
    }

    initModelSelector();
  initAgentHub();
  initWebSearchToggle();
  }

// --- Team Management Logic ---

  // =========================================================================
  // TEAM MANAGEMENT (Business plan - 5 members)
  // =========================================================================
  const teamModal = $("teamModal") || document.getElementById("teamModal");
  const btnSidebarTeam = $("btnSidebarTeam") || document.getElementById("btnSidebarTeam");
  const btnManageTeam = $("btnManageTeam") || document.getElementById("btnManageTeam");
  const btnCloseTeam = $("btnCloseTeam") || document.getElementById("btnCloseTeam");
  const teamModalBackdrop = $("teamModalBackdrop") || document.getElementById("teamModalBackdrop");
  const btnAddTeam = $("btnAddTeam") || document.getElementById("btnAddTeam");
  const teamInviteEmail = $("teamInviteEmail") || document.getElementById("teamInviteEmail");
  const teamList = $("teamList") || document.getElementById("teamList");
  const teamMsg = $("teamMsg") || document.getElementById("teamMsg");
  const modalTeamCounter = $("modalTeamCounter") || document.getElementById("modalTeamCounter");
  const sidebarTeamWrap = $("sidebarTeamWrap") || document.getElementById("sidebarTeamWrap");
  const sidebarTeamCount = $("sidebarTeamCount") || document.getElementById("sidebarTeamCount");

  function showTeamMsg(text, isOk) {
    if (!teamMsg) return;
    teamMsg.style.display = "block";
    teamMsg.style.background = isOk ? "rgba(52,211,153,0.15)" : "rgba(239,68,68,0.15)";
    teamMsg.style.border = isOk ? "1px solid #34d399" : "1px solid #f87171";
    teamMsg.style.color = isOk ? "#6ee7b7" : "#fca5a5";
    teamMsg.textContent = text;
  }

  function showTeamModal() {
    if (!teamModal) return;
    teamModal.classList.remove("hidden");
    teamModal.style.display = "flex";
    if (teamMsg) teamMsg.style.display = "none";
    loadTeamMembers();
  }

  function hideTeamModal() {
    if (teamModal) {
      teamModal.classList.add("hidden");
      teamModal.style.display = "none";
    }
  }

  if (btnSidebarTeam) btnSidebarTeam.onclick = showTeamModal;
  if (btnManageTeam) btnManageTeam.onclick = () => {
    const accMenu = $("accountMenu");
    if (accMenu) accMenu.classList.add("hidden");
    showTeamModal();
  };
  if (btnCloseTeam) btnCloseTeam.onclick = hideTeamModal;
  if (teamModalBackdrop) teamModalBackdrop.onclick = hideTeamModal;

  async function loadTeamMembers() {
    if (!teamList) return;
    teamList.innerHTML = "<p style='color:#94a3b8; font-size:0.85rem; text-align:center; padding:1rem 0; margin:0;'>Đang tải danh sách...</p>";
    try {
      const s = (localStorage.getItem(LS_GOOGLE_SESSION) || "").trim();
      const r = await fetch(apiBase() + "/api/team", {
        headers: { "X-User-Session": s, "Content-Type": "application/json" }
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Không thể tải danh sách team");

      const members = data.members || [];
      const count = members.length;
      if (modalTeamCounter) modalTeamCounter.textContent = `${count} / 5 người`;
      if (sidebarTeamCount) sidebarTeamCount.textContent = `${count}/5`;

      if (members.length === 0) {
        teamList.innerHTML = "<p style='color:#94a3b8; font-size:0.85rem; text-align:center; padding:1.25rem 0; margin:0;'>Chưa có thành viên nào trong team.<br><span style='font-size:0.78rem; color:#64748b;'>Hãy nhập email ở trên để thêm thành viên.</span></p>";
      } else {
        teamList.innerHTML = "";
        members.forEach(m => {
          const div = document.createElement("div");
          div.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06);";
          div.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:28px; height:28px; border-radius:50%; background:rgba(52,211,153,0.2); color:#6ee7b7; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.75rem;">${(m.email || "M")[0].toUpperCase()}</div>
              <div>
                <div style="font-weight:600; font-size:0.85rem; color:#f0fdf4;">${m.email}</div>
                <div style="font-size:0.72rem; color:#34d399;">VIP Business (Active)</div>
              </div>
            </div>
            <button type="button" class="btn-del-member" data-email="${m.email}" style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#fca5a5; border-radius:6px; padding:0.3rem 0.6rem; font-size:0.75rem; cursor:pointer; font-weight:600;">Xóa</button>
          `;
          teamList.appendChild(div);
        });

        teamList.querySelectorAll(".btn-del-member").forEach(btn => {
          btn.onclick = async () => {
            const email = btn.getAttribute("data-email");
            if (!confirm(`Xác nhận xóa thành viên ${email} khỏi Team?`)) return;
            try {
              const s = (localStorage.getItem(LS_GOOGLE_SESSION) || "").trim();
              const delRes = await fetch(apiBase() + "/api/team/remove", {
                method: "POST",
                headers: { "X-User-Session": s, "Content-Type": "application/json" },
                body: JSON.stringify({ email: email })
              });
              const delData = await delRes.json();
              if (!delRes.ok) throw new Error(delData.detail || "Lỗi xóa thành viên");
              showTeamMsg(`Đã xóa ${email} khỏi team`, true);
              loadTeamMembers();
            } catch (e) {
              showTeamMsg(String(e.message || e), false);
            }
          };
        });
      }
    } catch (e) {
      teamList.innerHTML = `<p style='color:#fca5a5; font-size:0.85rem; text-align:center; padding:1rem 0; margin:0;'>${e.message || e}</p>`;
    }
  }

  if (btnAddTeam && teamInviteEmail) {
    btnAddTeam.onclick = async () => {
      const email = (teamInviteEmail.value || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        showTeamMsg("Vui lòng nhập địa chỉ email hợp lệ", false);
        return;
      }
      btnAddTeam.textContent = "Đang thêm...";
      try {
        const s = (localStorage.getItem(LS_GOOGLE_SESSION) || "").trim();
        const res = await fetch(apiBase() + "/api/team/add", {
          method: "POST",
          headers: { "X-User-Session": s, "Content-Type": "application/json" },
          body: JSON.stringify({ email: email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Lỗi thêm thành viên");
        showTeamMsg(`🎉 ${data.message || `Đã thêm ${email} vào team thành công!`}`, true);
        teamInviteEmail.value = "";
        loadTeamMembers();
      } catch (e) {
        showTeamMsg(String(e.message || e), false);
      } finally {
        btnAddTeam.textContent = "+ Thêm";
      }
    };

    teamInviteEmail.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnAddTeam.click();
      }
    });
  }

  // Show/hide Team buttons based on user plan
  function checkTeamVisibility(user) {
    const planId = ((user && (user.plan_id || user.plan_name)) || "").toLowerCase().trim();
    const isBiz = planId === "business" || planId === "owner" || planId === "enterprise";
    if (sidebarTeamWrap) {
      if (isBiz) sidebarTeamWrap.classList.remove("hidden");
      else sidebarTeamWrap.classList.add("hidden");
    }
    if (btnManageTeam) {
      if (isBiz) btnManageTeam.classList.remove("hidden");
      else btnManageTeam.classList.add("hidden");
    }
  }

})();

  // =========================================================================
  // AI AGENT HUB MODAL CONTROLLER
  // =========================================================================
  function initAgentHub() {
    const btnOpen = document.getElementById("btnOpenAgentHub");
    const btnAgentSelect = document.getElementById("btnAgentSelect");
    if (btnAgentSelect && modal) btnAgentSelect.addEventListener("click", () => modal.classList.remove("hidden"));
    const modal = document.getElementById("agentHubModal");
    const btnClose = document.getElementById("btnCloseAgentHub");

    if (btnOpen && modal) {
      btnOpen.addEventListener("click", () => {
        modal.classList.remove("hidden");
      });
    }

    if (btnClose && modal) {
      btnClose.addEventListener("click", () => {
        modal.classList.add("hidden");
      });
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.classList.contains("hidden")) {
          modal.classList.add("hidden");
        }
      });

      // Bind card selections
      modal.querySelectorAll(".agent-card").forEach((card) => {
        card.addEventListener("click", () => {
          const modeId = card.getAttribute("data-agent-mode");
          if (modeId) {
            setActiveMode(modeId, { announce: true });
            modal.classList.add("hidden");
            if (els.input) els.input.focus();
          }
        });
      });
    }
  }


  // =========================================================================
  // WEB SEARCH TOGGLE & MULTI-DOCUMENT UPLOADER CONTROLLER
  // =========================================================================
  const btnWebSearch = document.getElementById("btnWebSearch");

  function initWebSearchToggle() {
    if (!btnWebSearch) return;
    updateWebSearchUi();
    btnWebSearch.addEventListener("click", () => {
      webSearchEnabled = !webSearchEnabled;
      localStorage.setItem("tungdev_web_search", webSearchEnabled ? "true" : "false");
      updateWebSearchUi();
    });
  }

  function updateWebSearchUi() {
    if (!btnWebSearch) return;
    if (webSearchEnabled) {
      btnWebSearch.classList.add("active");
      btnWebSearch.title = "Tìm kiếm Web: ĐANG BẬT (AI sẽ tìm kiếm Internet trực tiếp)";
    } else {
      btnWebSearch.classList.remove("active");
      btnWebSearch.title = "Tìm kiếm Web: ĐANG TẮT (Click để bật tra cứu Internet)";
    }
  }

  async function handleFileUpload(files) {
    if (!files || !files.length) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("image/")) {
        // Image handler
        const reader = new FileReader();
        reader.onload = (e) => {
          pendingImages.push(e.target.result);
          renderAttachPreview();
        };
        reader.readAsDataURL(file);
      } else {
        // Document / Code handler via /api/upload-doc
        setStreamStatus("📄 Đang phân tích tài liệu " + file.name + "…");
        try {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch((apiBase() || "") + "/api/upload-doc", {
            method: "POST",
            body: fd,
          });
          if (res.ok) {
            const data = await res.json();
            pendingAttachments.push({
              filename: data.filename,
              meta: data.meta,
              content: data.content,
            });
            renderAttachPreview();
          } else {
            alert("Lỗi đọc tài liệu: " + file.name);
          }
        } catch (err) {
          console.error("Upload doc error:", err);
        } finally {
          setStreamStatus("");
        }
      }
    }
  }





  // Download File button click handler (both on code block and inline in text)
  document.addEventListener("click", function (e) {
    const btn = e.target && e.target.closest && e.target.closest(".btn-download-file, .btn-inline-download");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    let block = btn.closest(".code-block");
    if (!block) {
      // If clicked inline in message text, find the nearest code block in the message row
      const row = btn.closest(".message-row, .message-content, .message, .chat-message");
      if (row) {
        block = row.querySelector(".code-block");
      }
      if (!block) {
        const allBlocks = document.querySelectorAll(".code-block");
        if (allBlocks.length) block = allBlocks[allBlocks.length - 1];
      }
    }

    const text = getPureCodeFromBlock(block, btn);
    if (!text.trim()) {
      alert("Không tìm thấy nội dung mã nguồn để tải về.");
      return;
    }

    const lang = (btn.getAttribute("data-lang") || "code").toLowerCase();
    const extMap = {
      html: "index.html",
      css: "style.css",
      javascript: "script.js",
      js: "script.js",
      python: "main.py",
      py: "main.py",
      cpp: "main.cpp",
      "c++": "main.cpp",
      c: "main.c",
      java: "Main.java",
      cs: "Program.cs",
      csharp: "Program.cs",
      go: "main.go",
      rust: "main.rs",
      rs: "main.rs",
      php: "index.php",
      sql: "schema.sql",
      json: "data.json",
      shell: "run.sh",
      bash: "run.sh",
      sh: "run.sh",
      markdown: "README.md",
      md: "README.md"
    };
    const filename = extMap[lang] || ("tungai_code_" + Date.now() + "." + (lang || "txt"));

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const oldText = btn.innerHTML;
    btn.innerHTML = "✅ Đã tải!";
    btn.style.color = "#34d399";
    setTimeout(() => {
      btn.innerHTML = oldText;
      btn.style.color = "";
    }, 2000);
  });


  // =========================================================================
  // INTERACTIVE CLOUD TERMINAL CONTROLLER (Python, C++, Node.js)
  // =========================================================================
  let currentRunningCode = "";
  let currentRunningLang = "python";

  window.openCloudTerminal = function (lang, targetOrCode, stdinVal = "") {
    let rawCode = "";
    if (typeof targetOrCode === "string") {
      rawCode = targetOrCode;
    } else if (targetOrCode && targetOrCode.closest) {
      const block = targetOrCode.closest(".code-block");
      rawCode = getPureCodeFromBlock(block, targetOrCode);
    }
    if (!rawCode || !rawCode.trim()) {
      alert("Không tìm thấy mã nguồn để thực thi.");
      return;
    }

    currentRunningLang = (lang || "python").toLowerCase();
    currentRunningCode = unescapeHtml(rawCode);

    const modal = document.getElementById("terminalModal");
    const win = document.getElementById("terminalModalWindow");
    const titleText = document.getElementById("termTitleText");
    const termIcon = document.getElementById("termIcon");
    const cmdLine = document.getElementById("termExecutedCmd");
    const outputStream = document.getElementById("termOutputStream");
    const statDot = document.getElementById("termStatusDot");
    const statText = document.getElementById("termStatusText");
    const execTime = document.getElementById("termExecutionTime");
    const exitCode = document.getElementById("termExitCode");
    const sandboxType = document.getElementById("termSandboxType");
    const stdinInput = document.getElementById("termStdinInput");

    if (!modal) return;
    modal.classList.remove("hidden");

    if (stdinVal && stdinInput) stdinInput.value = stdinVal;

    let langTitle = "Python 3.10 Cloud Terminal";
    let icon = "🐍";
    let cmd = "python3 main.py";
    let sb = "Python 3.10 Sandbox Isolation";

    if (currentRunningLang === "cpp" || currentRunningLang === "c++" || currentRunningLang === "c") {
      langTitle = "C++20 Cloud Terminal (G++ 11.4 -O3)";
      icon = "⚡";
      cmd = "g++ -O3 -std=c++20 main.cpp -o main.out && ./main.out";
      sb = "GCC 11.4 Linux Container";
    } else if (currentRunningLang === "js" || currentRunningLang === "javascript" || currentRunningLang === "node") {
      langTitle = "Node.js v20 Cloud Terminal";
      icon = "🟢";
      cmd = "node main.js";
      sb = "V8 Node.js Isolation";
    }

    if (titleText) titleText.textContent = langTitle;
    if (termIcon) termIcon.textContent = icon;
    if (cmdLine) cmdLine.textContent = cmd;
    if (sandboxType) sandboxType.textContent = sb;
    if (execTime) execTime.textContent = "Đang chạy...";
    if (exitCode) exitCode.textContent = "Chờ phản hồi...";

    if (statDot) {
      statDot.className = "stat-dot running";
    }
    if (statText) {
      statText.textContent = "Đang thực thi...";
      statText.style.color = "#fbbf24";
    }

    if (outputStream) {
      outputStream.innerHTML = '<span class="term-running-indicator"><span class="pulse-code-dot"></span> Đang nạp mã nguồn và thực thi trên Cloud Sandbox...</span>';
    }

    // Execute API
    executeTerminalPayload(currentRunningLang, currentRunningCode, stdinVal);
  }

  function termEscape(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function executeTerminalPayload(lang, code, stdinData) {
    const outputStream = document.getElementById("termOutputStream");
    const statDot = document.getElementById("termStatusDot");
    const statText = document.getElementById("termStatusText");
    const execTime = document.getElementById("termExecutionTime");
    const exitCode = document.getElementById("termExitCode");

    try {
      let endpoint = "/api/run-code";
      try {
        const base = typeof apiBase === "function" ? apiBase() : "";
        if (base && (location.hostname.indexOf("github.io") !== -1 || location.protocol === "file:")) {
          endpoint = base.replace(/\/$/, "") + "/api/run-code";
        }
      } catch (_) {}

      const hdrs = { "Content-Type": "application/json" };
      try {
        const tok = localStorage.getItem("jarvis_google_session_v1") || "";
        if (tok) hdrs["X-User-Session"] = tok;
      } catch (_) {}

      const res = await fetch(endpoint, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ lang: lang, code: code, stdin: stdinData || "" }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Lỗi máy chủ thực thi.");
      }

      const isOk = !!data.ok;
      const dur = data.execution_time_ms != null ? data.execution_time_ms + "ms" : "12ms";
      const eCode = data.exit_code != null ? data.exit_code : (isOk ? 0 : 1);

      if (execTime) execTime.textContent = dur;
      if (exitCode) {
        exitCode.textContent = "Exit " + eCode + (isOk ? " (Thành công)" : " (Lỗi)");
        exitCode.style.color = isOk ? "#34d399" : "#f87171";
      }

      if (statDot) {
        statDot.className = isOk ? "stat-dot" : "stat-dot error";
      }
      if (statText) {
        statText.textContent = isOk ? "Đã hoàn thành" : "Lỗi thực thi";
        statText.style.color = isOk ? "#34d399" : "#f87171";
      }

      let outHtml = "";
      if (data.stdout) {
        outHtml += '<div class="term-output-stdout">' + termEscape(data.stdout) + '</div>';
      }
      if (data.stderr) {
        outHtml += '<div class="term-output-stderr"><strong>[LỖI / STDERR]:</strong>\n' + termEscape(data.stderr) + '</div>';
      }
      if (!data.stdout && !data.stderr) {
        outHtml = '<div style="color:#94a3b8;font-style:italic;">(Chương trình thực thi thành công và không in ra màn hình console)</div>';
      }

      if (outputStream) {
        outputStream.innerHTML = outHtml;
      }
    } catch (err) {
      if (statDot) statDot.className = "stat-dot error";
      if (statText) {
        statText.textContent = "Lỗi kết nối";
        statText.style.color = "#f87171";
      }
      if (outputStream) {
        outputStream.innerHTML = '<div class="term-output-stderr"><strong>[LỖI HỆ THỐNG]:</strong>\n' + termEscape(String(err.message || err)) + '</div>';
      }
    }
  }

  function closeCloudTerminal() {
    const modal = document.getElementById("terminalModal");
    if (modal) modal.classList.add("hidden");
  }

  // Bind Terminal Controls
  document.addEventListener("DOMContentLoaded", function () {
    const btnClose1 = document.getElementById("btnCloseTerminal");
    const btnClose2 = document.getElementById("btnTermCloseBtn");
    const modalBackdrop = document.getElementById("terminalModal");
    const btnRerun = document.getElementById("btnTermRerun");
    const btnClear = document.getElementById("btnTermClear");
    const btnCopy = document.getElementById("btnTermCopy");
    const btnMax = document.getElementById("btnMaxTerminal");
    const termWin = document.getElementById("terminalModalWindow");
    const btnSendStdin = document.getElementById("btnTermSendStdin");
    const stdinInput = document.getElementById("termStdinInput");

    if (btnClose1) btnClose1.onclick = closeCloudTerminal;
    if (btnClose2) btnClose2.onclick = closeCloudTerminal;
    if (modalBackdrop) {
      modalBackdrop.onclick = function (e) {
        if (e.target === modalBackdrop) closeCloudTerminal();
      };
    }
    if (btnMax && termWin) {
      btnMax.onclick = function () {
        termWin.classList.toggle("fullscreen");
      };
    }
    if (btnRerun) {
      btnRerun.onclick = function () {
        const stdinVal = stdinInput ? stdinInput.value : "";
        openCloudTerminal(currentRunningLang, currentRunningCode, stdinVal);
      };
    }
    if (btnClear) {
      btnClear.onclick = function () {
        const out = document.getElementById("termOutputStream");
        if (out) out.innerHTML = '<div style="color:#64748b;font-style:italic;">(Terminal đã được xóa màn hình)</div>';
      };
    }
    if (btnCopy) {
      btnCopy.onclick = function () {
        const out = document.getElementById("termOutputStream");
        if (out) {
          navigator.clipboard.writeText(out.textContent || "");
          const old = btnCopy.textContent;
          btnCopy.textContent = "✅ Đã chép!";
          setTimeout(() => { btnCopy.textContent = old; }, 2000);
        }
      };
    }
    if (btnSendStdin && stdinInput) {
      btnSendStdin.onclick = function () {
        openCloudTerminal(currentRunningLang, currentRunningCode, stdinInput.value);
      };
      stdinInput.onkeydown = function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          btnSendStdin.click();
        }
      };
    }
  });

  // Wire code action buttons to open Terminal Modal
  document.addEventListener("click", function (e) {
    const btn = e.target && e.target.closest && e.target.closest(".btn-run-preview");
    if (!btn) return;
    const execType = btn.getAttribute("data-exec");
    if (execType === "web") return; // Handled by web preview sandbox

    e.preventDefault();
    e.stopPropagation();

    const block = btn.closest(".code-block");
    const code = getPureCodeFromBlock(block, btn);
    if (!code.trim()) return;

    openCloudTerminal(execType, code);
  });

