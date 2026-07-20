/**
 * TungDevAI auth — login.html / register.html
 * Google: GIS button + OAuth id_token (popup desktop / full redirect mobile)
 */
const TungAuth = (() => {
  const LS_API = "jarvis_api_base_v2";
  const LS_GOOGLE = "jarvis_google_session_v1";
  const LS_GOOGLE_USER = "jarvis_google_user_v1";
  const SS_GOOGLE_TOKEN = "tung_google_id_token";
  const SS_GOOGLE_RETURN = "tung_google_return";
  const SS_GOOGLE_NONCE = "tung_google_nonce";
  const CHAT_URL = "chat.html"; // web chat (landing is site root index.html)

  const $ = (id) => document.getElementById(id);

  let serverConfig = {
    google_client_id: "",
    google_auth_required: false,
    auth_required: false,
    email_auth: true,
  };

  let sendCodeCooldown = 0;
  let mode = "login";
  let gsiReady = false;
  let popupWatch = null;
  let cfgPublic = {
    apiBase: "",
    publicSite: "",
    sameOrigin: false,
    google_client_id: "",
  };

  // Client ID public (GIS) — fallback neu /api/config chua load
  const GOOGLE_CLIENT_ID_FALLBACK =
    "932807715948-fvssk3ukqn636tdbuv1n59kvcoa5lhaf.apps.googleusercontent.com";

  function isMobileUa() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  }

  function isStaticHost() {
    const host = (location.hostname || "").toLowerCase();
    return host.indexOf("github.io") !== -1 || location.protocol === "file:";
  }

  function currentOrigin() {
    return (location.origin || "").replace(/\/$/, "");
  }

  function googleClientId() {
    return (
      (serverConfig.google_client_id || "").trim() ||
      (cfgPublic.google_client_id || "").trim() ||
      GOOGLE_CLIENT_ID_FALLBACK
    );
  }

  function googleOriginHelp() {
    const o = currentOrigin();
    return (
      "Google Error 400 = origin/redirect chua khai bao.\n\n" +
      "Vao https://console.cloud.google.com/apis/credentials\n" +
      "→ OAuth client (Web) → them:\n\n" +
      "JavaScript origins:\n" +
      o +
      "\n\nRedirect URIs:\n" +
      o +
      "/google-callback.html\n\n" +
      "Luu 1–5 phut roi thu lai. Dung DUNG link dang mo (khong doi tunnel/IP)."
    );
  }

  function isLoopbackUrl(url) {
    return /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(
      String(url || "").trim()
    );
  }

  /**
   * API server URL:
   * - Same-origin when UI is served by VPS/tunnel (trycloudflare / IP:7860)
   * - On github.io: config.json apiBase or localStorage (NEVER 127.0.0.1 on phone)
   * - Ignore saved 127.0.0.1 when page is already on public VPS/tunnel
   */
  function apiBase() {
    const host = (location.hostname || "").toLowerCase();
    const origin = (location.origin || "").replace(/\/$/, "");
    const fromLs = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
    const fromCfg = (cfgPublic.apiBase || "").trim().replace(/\/$/, "");

    // Local PC: same origin (webapp.server)
    if (host === "127.0.0.1" || host === "localhost") {
      return origin;
    }

    // Public UI (tunnel / VPS / domain): always same-origin.
    // Do NOT prefer localStorage 127.0.0.1 left over from github.io testing.
    if (!isStaticHost() && origin && origin.indexOf("http") === 0) {
      if (fromLs && isLoopbackUrl(fromLs)) {
        try {
          localStorage.removeItem(LS_API);
        } catch (_) {}
      }
      return origin;
    }

    // github.io / file: need remote API
    if (fromLs && !isLoopbackUrl(fromLs)) return fromLs;
    if (fromCfg && !isLoopbackUrl(fromCfg)) return fromCfg;
    if (fromLs && isLoopbackUrl(fromLs)) {
      try {
        localStorage.removeItem(LS_API);
      } catch (_) {}
    }
    return "";
  }

  async function loadPublicConfig() {
    try {
      const r = await fetch("config.json?v=20", { cache: "no-store" });
      if (r.ok) {
        cfgPublic = Object.assign(cfgPublic, await r.json());
        // Bat Google ngay tu config.json (khong doi /api/config)
        if ((cfgPublic.google_client_id || "").trim()) {
          serverConfig.google_client_id = String(
            cfgPublic.google_client_id
          ).trim();
        }
      }
    } catch (_) {
      /* ignore */
    }
    if (!serverConfig.google_client_id) {
      serverConfig.google_client_id = GOOGLE_CLIENT_ID_FALLBACK;
    }
  }

  /** Goi het card/o nhap API cu (khong hien nua) */
  function removeApiBaseFixer() {
    try {
      const box = $("apiBaseFixer");
      if (box) box.remove();
      document.querySelectorAll("#apiBaseFixer").forEach(function (el) {
        el.remove();
      });
    } catch (_) {}
  }

  function clearMsgs() {
    const err = $("authErr");
    const ok = $("authOk");
    if (err) {
      err.classList.add("hidden");
      err.textContent = "";
    }
    if (ok) {
      ok.classList.add("hidden");
      ok.textContent = "";
    }
  }

  function showErr(msg) {
    const ok = $("authOk");
    const err = $("authErr");
    if (ok) ok.classList.add("hidden");
    if (err) {
      err.classList.remove("hidden");
      err.textContent = String(msg || "Loi");
    }
  }

  function showOk(msg) {
    const err = $("authErr");
    const ok = $("authOk");
    if (err) err.classList.add("hidden");
    if (ok) {
      ok.classList.remove("hidden");
      ok.textContent = String(msg || "");
    }
  }

  function setHint(msg) {
    const hint = $("authHint");
    if (hint) hint.textContent = msg || "";
  }

  async function parseJsonResponse(r) {
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
    if (!r.ok) {
      const d = data.detail;
      let msg = text || "Request failed";
      if (typeof d === "string") msg = d;
      else if (Array.isArray(d)) msg = d.map((x) => x.msg || x).join("; ");
      else if (d) msg = JSON.stringify(d);
      throw new Error(msg);
    }
    return data;
  }

  function onAuthSuccess(data) {
    localStorage.setItem(LS_GOOGLE, data.session_token || "");
    localStorage.setItem(LS_GOOGLE_USER, JSON.stringify(data.user || {}));
    const next = new URLSearchParams(location.search).get("next") || CHAT_URL;
    location.href = next;
  }

  async function exchangeGoogleCredential(credential) {
    if (!credential) throw new Error("Thieu credential Google");
    setHint("Đang xác thực Google với server...");
    const r = await fetch(apiBase() + "/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: credential }),
    });
    const data = await parseJsonResponse(r);
    setHint("");
    onAuthSuccess(data);
  }

  async function handleGoogleCredential(response) {
    try {
      clearMsgs();
      await exchangeGoogleCredential(response && response.credential);
    } catch (e) {
      setHint("");
      showErr(e.message || e);
    }
  }

  function randomNonce() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function buildGoogleAuthUrl() {
    const clientId = googleClientId();
    const redirectUri = currentOrigin() + "/google-callback.html";
    const nonce = randomNonce();
    sessionStorage.setItem(SS_GOOGLE_NONCE, nonce);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "id_token",
      scope: "openid email profile",
      nonce: nonce,
      prompt: "select_account",
    });
    return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
  }

  /**
   * OAuth id_token:
   * - Desktop: popup
   * - Mobile: full-page redirect (popup bi chan / khong co window.opener)
   * Can Authorized redirect URI = origin hien tai + /google-callback.html
   */
  function startGooglePopupLogin() {
    const clientId = googleClientId();
    if (!clientId) {
      showErr("Google chưa sẵn sàng. Tải lại trang.");
      return;
    }
    clearMsgs();
    removeApiBaseFixer();

    const url = buildGoogleAuthUrl();

    // Mobile / small screens: full redirect (tranh popup + Error 400 hieu nham)
    if (isMobileUa()) {
      setHint("Đang chuyển sang Google…");
      try {
        sessionStorage.setItem(
          SS_GOOGLE_RETURN,
          location.pathname.split("/").pop() || "login.html"
        );
      } catch (_) {}
      location.href = url;
      return;
    }

    setHint("Đang mở cửa sổ Google...");
    const w = 500;
    const h = 640;
    const left = Math.max(0, (screen.width - w) / 2);
    const top = Math.max(0, (screen.height - h) / 2);
    const popup = window.open(
      url,
      "tungdevai_google_login",
      "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top + ",menubar=no,toolbar=no"
    );

    if (!popup) {
      // Fallback: full redirect (Chrome mobile desktop mode, popup blocked)
      setHint("Popup bị chặn — chuyển trang Google…");
      try {
        sessionStorage.setItem(
          SS_GOOGLE_RETURN,
          location.pathname.split("/").pop() || "login.html"
        );
      } catch (_) {}
      location.href = url;
      return;
    }

    if (popupWatch) clearInterval(popupWatch);
    popupWatch = setInterval(function () {
      if (popup.closed) {
        clearInterval(popupWatch);
        popupWatch = null;
        if ($("authHint") && $("authHint").textContent.indexOf("Đang mở") === 0) {
          setHint("Cửa sổ Google đã đóng. Bấm lại nếu chưa xong.");
        }
      }
    }, 500);
  }

  function onGoogleMessage(ev) {
    if (ev.origin !== location.origin) return;
    const data = ev.data || {};
    if (data.type !== "tungdevai-google-auth") return;
    if (popupWatch) {
      clearInterval(popupWatch);
      popupWatch = null;
    }
    if (data.error) {
      setHint("");
      let m = String(data.error);
      if (/redirect_uri_mismatch|origin_mismatch|Error 400|invalid_request/i.test(m)) {
        m = googleOriginHelp();
      } else if (/access_denied/i.test(m)) {
        m =
          "Google từ chối. Nếu app ở chế độ Testing: OAuth consent → Test users → thêm email của bạn.";
      }
      showErr(m);
      return;
    }
    if (data.credential) {
      handleGoogleCredential({ credential: data.credential });
    }
  }

  /** Resume after mobile full-page OAuth redirect */
  function resumeGoogleRedirectIfAny() {
    let token = "";
    try {
      token = (sessionStorage.getItem(SS_GOOGLE_TOKEN) || "").trim();
      if (token) sessionStorage.removeItem(SS_GOOGLE_TOKEN);
    } catch (_) {}
    if (!token) return false;
    setHint("Đang hoàn tất đăng nhập Google…");
    handleGoogleCredential({ credential: token });
    return true;
  }

  function makeGoogleFallbackButton(wrap) {
    wrap.innerHTML = "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btnGoogleContinue";
    btn.className = "auth-primary";
    btn.style.width = "100%";
    btn.style.background = "#fff";
    btn.style.color = "#1f1f1f";
    btn.style.border = "1px solid #dadce0";
    btn.style.fontWeight = "600";
    btn.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:10px;justify-content:center">' +
      '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">' +
      '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
      '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
      '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
      '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
      "</svg>Tiếp tục với Google</span>";
    btn.addEventListener("click", startGooglePopupLogin);
    wrap.appendChild(btn);
  }

  function renderGoogleButton() {
    const wrap = $("googleBtnWrap");
    if (!wrap) return;
    removeApiBaseFixer();

    const clientId = googleClientId();
    serverConfig.google_client_id = clientId;

    // Mobile: nut redirect on-page (GIS hay bi Error 400 / popup)
    if (isMobileUa()) {
      makeGoogleFallbackButton(wrap);
      return;
    }

    if (typeof google === "undefined" || !google.accounts || !google.accounts.id) {
      makeGoogleFallbackButton(wrap);
      setTimeout(renderGoogleButton, 500);
      return;
    }

    try {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: false,
        itp_support: true,
      });
      gsiReady = true;
      wrap.innerHTML = "";
      google.accounts.id.renderButton(wrap, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 320,
        logo_alignment: "left",
      });
    } catch (e) {
      console.warn("GIS render failed", e);
      makeGoogleFallbackButton(wrap);
    }
  }

  async function submitLogin(e) {
    if (e) e.preventDefault();
    clearMsgs();
    const email = (($("loginEmail") && $("loginEmail").value) || "").trim();
    const password = ($("loginPassword") && $("loginPassword").value) || "";
    if (!email || !password) {
      showErr("Nhập email và mật khẩu");
      return;
    }
    try {
      setHint("Đang đăng nhập...");
      const r = await fetch(apiBase() + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await parseJsonResponse(r);
      setHint("");
      onAuthSuccess(data);
    } catch (err) {
      setHint("");
      showErr(err.message || err);
    }
  }

  async function sendRegisterCode() {
    clearMsgs();
    const email = (($("regEmail") && $("regEmail").value) || "").trim();
    const btn = $("btnSendCode");
    if (!email) {
      showErr("Nhập email để nhận mã");
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const r = await fetch(apiBase() + "/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "register" }),
      });
      const data = await parseJsonResponse(r);
      // Khong bao gio tu dien ma vao o — user chi nhan ma qua email
      if ($("regCode")) $("regCode").value = "";

      if (data.sent) {
        const panel = $("otpPanel");
        if (panel) panel.classList.add("is-sent");
        showOk(
          "Đã gửi mã 6 số tới " +
            (data.email || email) +
            ". Mở email (và Spam), rồi gõ mã vào ô — web không tự điền."
        );
        if ($("codeHint")) {
          $("codeHint").textContent =
            "Mã chỉ có trong hộp thư · Không thấy? Đợi 1 phút / kiểm tra Spam";
        }
        if ($("regCode")) $("regCode").focus();
      } else {
        // Khong hien dev_code tren UI (du server co tra)
        showErr(
          "Chưa gửi được email — VPS chưa bật SMTP (smtp_configured: false).\n" +
            "SSH VPS → paste file Desktop\\VPS-PASTE-OTP.sh → restart web.\n" +
            "Hoặc test trên PC: http://127.0.0.1:7860/register.html (SMTP máy nhà đã OK)."
        );
        if ($("codeHint")) {
          $("codeHint").textContent =
            "Server public chưa gửi mail. Cần SMTP trên VPS (1 lần paste script).";
        }
      }
      sendCodeCooldown = 45;
      const tick = function () {
        if (!btn) return;
        if (sendCodeCooldown <= 0) {
          btn.disabled = false;
          btn.textContent = "Gửi mã";
          return;
        }
        btn.textContent = "Gửi lại (" + sendCodeCooldown + "s)";
        sendCodeCooldown -= 1;
        setTimeout(tick, 1000);
      };
      tick();
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Gửi mã";
      }
      showErr(e.message || e);
    }
  }

  async function submitRegister(e) {
    if (e) e.preventDefault();
    clearMsgs();
    const email = (($("regEmail") && $("regEmail").value) || "").trim();
    const password = ($("regPassword") && $("regPassword").value) || "";
    const code = (($("regCode") && $("regCode").value) || "").trim();
    const name = (($("regName") && $("regName").value) || "").trim();
    if (!email || !password) {
      showErr("Nhập email và mật khẩu");
      return;
    }
    if (password.length < 6) {
      showErr("Mật khẩu tối thiểu 6 ký tự");
      return;
    }
    if (!code) {
      showErr("Bấm Gửi mã rồi nhập mã 6 số từ email");
      return;
    }
    try {
      setHint("Đang tạo tài khoản...");
      const r = await fetch(apiBase() + "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code, name }),
      });
      const data = await parseJsonResponse(r);
      setHint("");
      onAuthSuccess(data);
    } catch (err) {
      setHint("");
      showErr(err.message || err);
    }
  }

  async function alreadyLoggedIn() {
    const session = (localStorage.getItem(LS_GOOGLE) || "").trim();
    if (!session) return false;
    try {
      const r = await fetch(apiBase() + "/api/auth/me", {
        headers: { "X-User-Session": session },
        cache: "no-store",
      });
      if (!r.ok) return false;
      location.href = CHAT_URL;
      return true;
    } catch {
      return false;
    }
  }

  async function loadServerConfig() {
    await loadPublicConfig();
    removeApiBaseFixer();
    clearMsgs();
    setHint("");

    // Luon co Google client id de hien nut
    serverConfig.google_client_id = googleClientId();

    const host = (location.hostname || "").toLowerCase();
    // Xoa API base cu / chet — tranh card loi + Failed to fetch
    try {
      const saved = (localStorage.getItem(LS_API) || "").trim();
      if (
        saved &&
        (isLoopbackUrl(saved) ||
          /assists-trinity-apartment-evanescence/i.test(saved) ||
          (!(host === "127.0.0.1" || host === "localhost") &&
            !isStaticHost()))
      ) {
        // Same-origin (tunnel/VPS): khong can LS. Loopback/tunnel chet: xoa.
        localStorage.removeItem(LS_API);
      }
    } catch (_) {}

    const base = apiBase();
    if (!base) {
      // Giao dien tinh (github.io) khong co API — van hien Google, khong hien card
      return;
    }

    try {
      const r = await fetch(base + "/api/config", { cache: "no-store" });
      if (r.ok) {
        const cfg = await r.json();
        serverConfig = Object.assign(serverConfig, cfg);
        if (!(serverConfig.google_client_id || "").trim()) {
          serverConfig.google_client_id = googleClientId();
        }
      }
      // Loi API: im lang, khong hien card / doan text dai
    } catch (_) {
      /* silent — UI sach, Google van hien */
    }
    removeApiBaseFixer();
  }

  async function init(pageMode) {
    mode = pageMode === "register" ? "register" : "login";
    document.body.dataset.authPage = mode;
    removeApiBaseFixer();

    window.addEventListener("message", onGoogleMessage);

    // Mobile OAuth: resume token sau full-page redirect (async)
    const resumingGoogle = resumeGoogleRedirectIfAny();

    await loadServerConfig();
    // Ve Google ngay (khong doi API)
    if (!resumingGoogle) renderGoogleButton();

    if (!resumingGoogle && (await alreadyLoggedIn())) return;

    if (mode === "login") {
      const form = $("formLogin");
      if (form) form.addEventListener("submit", submitLogin);
    } else {
      const form = $("formRegister");
      if (form) form.addEventListener("submit", submitRegister);
      const btn = $("btnSendCode");
      if (btn) btn.addEventListener("click", sendRegisterCode);
    }
  }

  return { init, startGooglePopupLogin, googleOriginHelp };
})();
