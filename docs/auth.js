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
  let cfgPublic = { apiBase: "", publicSite: "", sameOrigin: false };

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
      const r = await fetch("config.json?v=9", { cache: "no-store" });
      if (r.ok) {
        cfgPublic = Object.assign(cfgPublic, await r.json());
      }
    } catch (_) {
      /* ignore */
    }
  }

  function showApiBaseFixer(reason) {
    let box = $("apiBaseFixer");
    if (!box) {
      box = document.createElement("div");
      box.id = "apiBaseFixer";
      box.style.cssText =
        "margin-top:0.75rem;padding:0.75rem;border:1px solid #444;border-radius:10px;text-align:left";
      const hint = $("authHint");
      if (hint && hint.parentNode) hint.parentNode.insertBefore(box, hint);
      else {
        const card = document.querySelector(".auth-card");
        if (card) card.appendChild(box);
      }
    }
    box.innerHTML =
      '<p class="auth-hint" style="margin:0 0 0.5rem;white-space:pre-wrap"></p>' +
      '<label class="auth-label" for="apiBaseInput">Link server VPS / tunnel</label>' +
      '<input class="auth-input" id="apiBaseInput" type="url" placeholder="https://xxxx.trycloudflare.com" />' +
      '<button type="button" class="auth-primary" id="btnSaveApi" style="margin-top:0.5rem;width:100%">Lưu & thử lại</button>' +
      '<p class="auth-hint" style="margin:0.5rem 0 0;font-size:0.75rem">Lay URL tren VPS: journalctl -u tungdevai-tunnel -n 50 --no-pager | grep trycloudflare</p>';
    const p = box.querySelector("p");
    if (p) {
      p.textContent =
        reason ||
        "Trang github.io chỉ là giao diện. Server API nằm trên VPS — dán URL public (trycloudflare) vào đây.";
    }
    const input = $("apiBaseInput");
    if (input) {
      input.value =
        localStorage.getItem(LS_API) ||
        (cfgPublic.apiBase || "") ||
        "";
    }
    const btn = $("btnSaveApi");
    if (btn) {
      btn.onclick = async function () {
        const v = (($("apiBaseInput") && $("apiBaseInput").value) || "")
          .trim()
          .replace(/\/$/, "");
        if (!v || !/^https?:\/\//i.test(v)) {
          showErr("Nhap day du URL, vi du: https://abc.trycloudflare.com");
          return;
        }
        if (/127\.0\.0\.1|localhost/i.test(v) && isStaticHost()) {
          showErr(
            "Tren dien thoai/github.io, 127.0.0.1 la chinh may ban — khong phai VPS. Can link trycloudflare.com cua VPS."
          );
          return;
        }
        try {
          localStorage.setItem(LS_API, v);
        } catch (_) {}
        clearMsgs();
        setHint("Dang thu ket noi " + v + " …");
        await loadServerConfig();
        renderGoogleButton();
      };
    }
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
    const clientId = (serverConfig.google_client_id || "").trim();
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
    const clientId = (serverConfig.google_client_id || "").trim();
    if (!clientId) {
      showErr("GOOGLE_CLIENT_ID chua cau hinh tren server.");
      return;
    }
    clearMsgs();

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

  function renderGoogleButton() {
    const wrap = $("googleBtnWrap");
    const clientId = (serverConfig.google_client_id || "").trim();
    if (!wrap) return;

    if (!clientId) {
      wrap.innerHTML =
        '<p class="auth-hint" style="margin:0">Google chưa cấu hình. Dùng email bên trên.</p>';
      return;
    }

    // Mobile: nut redirect on-page (GIS hay bi Error 400 / popup)
    if (isMobileUa()) {
      wrap.innerHTML = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "auth-primary";
      btn.style.width = "100%";
      btn.style.background = "#fff";
      btn.style.color = "#1f1f1f";
      btn.style.border = "1px solid #dadce0";
      btn.textContent = "Tiếp tục với Google";
      btn.addEventListener("click", startGooglePopupLogin);
      wrap.appendChild(btn);
      return;
    }

    if (typeof google === "undefined" || !google.accounts || !google.accounts.id) {
      wrap.innerHTML =
        '<p class="auth-hint" style="margin:0">Đang tải Google…</p>';
      setTimeout(renderGoogleButton, 400);
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
      // Chi 1 nut Google chuan (GIS) — khong them nut "cửa sổ khác"
    } catch (e) {
      console.warn("GIS render failed", e);
      wrap.innerHTML = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "auth-primary";
      btn.style.width = "100%";
      btn.textContent = "Tiếp tục với Google";
      btn.addEventListener("click", startGooglePopupLogin);
      wrap.appendChild(btn);
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

    const host = (location.hostname || "").toLowerCase();
    // Xoa 127.0.0.1/localhost trong LS khi dang o VPS/tunnel/github (khong phai PC local)
    if (!(host === "127.0.0.1" || host === "localhost")) {
      try {
        const saved = (localStorage.getItem(LS_API) || "").trim();
        if (isLoopbackUrl(saved)) localStorage.removeItem(LS_API);
      } catch (_) {}
    }

    const base = apiBase();
    if (!base) {
      setHint(
        "Ban dang mo trang tinh (" +
          (location.hostname || "file") +
          "). VPS bat roi van can URL public (trycloudflare) — khong dung 127.0.0.1."
      );
      showErr(
        "Thieu dia chi API. Mo thang link trycloudflare cua VPS, hoac dan URL vao o ben duoi."
      );
      showApiBaseFixer(
        "VPS dang chay nhung trang github.io khong goi duoc 127.0.0.1 (do la may ban).\n" +
          "Mo link:\n" +
          "  https://assists-trinity-apartment-evanescence.trycloudflare.com/register.html\n" +
          "hoac dan URL tunnel vao o duoi."
      );
      return;
    }

    try {
      const r = await fetch(base + "/api/config", { cache: "no-store" });
      if (r.ok) {
        serverConfig = Object.assign(serverConfig, await r.json());
        setHint("");
        const box = $("apiBaseFixer");
        if (box) box.remove();
      } else {
        showErr("Server tra loi config: " + r.status + " (" + base + ")");
        showApiBaseFixer("Server co phan hoi nhung loi " + r.status);
      }
    } catch (e) {
      const detail = String((e && e.message) || e || "");
      if (isLoopbackUrl(base) || /127\.0\.0\.1|localhost/i.test(base)) {
        setHint(
          "Trang dang goi " +
            base +
            " (may ban), khong phai VPS. Mo link tunnel VPS."
        );
        showErr(
          "Sai dia chi API: " +
            base +
            "\nVPS dang bat o trycloudflare — khong mo github.io / 127.0.0.1 tren dien thoai."
        );
        showApiBaseFixer(
          "Dan URL VPS hien tai:\nhttps://assists-trinity-apartment-evanescence.trycloudflare.com"
        );
        return;
      }
      setHint("Khong ket noi " + base + (detail ? " — " + detail : ""));
      showErr(
        "Khong den duoc server API (" +
          base +
          ").\n• Dung: mo URL trycloudflare.com cua VPS\n• Sai: github.io + apiBase cu / 127.0.0.1"
      );
      showApiBaseFixer(
        "VPS dang bat nhung URL nay khong ket noi duoc.\n" +
          "Thu: https://assists-trinity-apartment-evanescence.trycloudflare.com\n" +
          "Hoac SSH: journalctl -u tungdevai-tunnel -n 50 --no-pager | grep trycloudflare"
      );
    }
  }

  async function init(pageMode) {
    mode = pageMode === "register" ? "register" : "login";
    document.body.dataset.authPage = mode;

    window.addEventListener("message", onGoogleMessage);

    // Mobile OAuth: resume token sau full-page redirect (async)
    const resumingGoogle = resumeGoogleRedirectIfAny();

    if (!resumingGoogle && (await alreadyLoggedIn())) return;
    await loadServerConfig();

    if (!resumingGoogle) renderGoogleButton();

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
