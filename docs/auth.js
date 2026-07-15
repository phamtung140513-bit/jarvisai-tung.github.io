/**
 * TungDevAI auth — login.html / register.html
 * Google: OAuth popup (id_token) + GIS button fallback
 */
const TungAuth = (() => {
  const LS_API = "jarvis_api_base_v2";
  const LS_GOOGLE = "jarvis_google_session_v1";
  const LS_GOOGLE_USER = "jarvis_google_user_v1";
  const CHAT_URL = "index.html";

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

  function apiBase() {
    const host = (location.hostname || "").toLowerCase();
    if (host.indexOf("github.io") !== -1) {
      const fromLs = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
      return fromLs || "http://127.0.0.1:7860";
    }
    if (host === "127.0.0.1" || host === "localhost") {
      return (location.origin || "").replace(/\/$/, "");
    }
    const fromLs = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
    if (fromLs) return fromLs;
    if (location.protocol === "file:") return "http://127.0.0.1:7860";
    return (location.origin || "").replace(/\/$/, "");
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
    setHint("Dang xac thuc Google voi server...");
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

  /**
   * Primary: OAuth implicit id_token popup — works when GIS button is flaky.
   * Requires Authorized redirect URI:
   *   http://127.0.0.1:7860/google-callback.html
   *   http://localhost:7860/google-callback.html
   */
  function startGooglePopupLogin() {
    const clientId = (serverConfig.google_client_id || "").trim();
    if (!clientId) {
      showErr("GOOGLE_CLIENT_ID chua cau hinh tren server.");
      return;
    }
    clearMsgs();
    setHint("Dang mo cua so Google...");

    const redirectUri = location.origin.replace(/\/$/, "") + "/google-callback.html";
    const nonce = randomNonce();
    sessionStorage.setItem("tung_google_nonce", nonce);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "id_token",
      scope: "openid email profile",
      nonce: nonce,
      prompt: "select_account",
    });
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();

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
      setHint("");
      showErr(
        "Trinh duyet chan popup. Cho phep popup cho " +
          location.host +
          " roi bam lai."
      );
      return;
    }

    if (popupWatch) clearInterval(popupWatch);
    popupWatch = setInterval(function () {
      if (popup.closed) {
        clearInterval(popupWatch);
        popupWatch = null;
        if ($("authHint") && $("authHint").textContent.indexOf("Dang mo") === 0) {
          setHint("Cua so Google da dong. Bam lai neu chua xong.");
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
      if (/redirect_uri_mismatch/i.test(m)) {
        m =
          "redirect_uri_mismatch: trong Google Cloud → Credentials → OAuth client, them Redirect URI:\n" +
          location.origin +
          "/google-callback.html";
      } else if (/access_denied/i.test(m)) {
        m =
          "Google tu choi. Neu app o che do Testing: OAuth consent → Test users → them email cua ban.";
      }
      showErr(m);
      return;
    }
    if (data.credential) {
      handleGoogleCredential({ credential: data.credential });
    }
  }

  function renderGoogleButton() {
    const wrap = $("googleBtnWrap");
    const clientId = (serverConfig.google_client_id || "").trim();
    if (!wrap) return;

    if (!clientId) {
      wrap.innerHTML =
        '<p class="auth-hint" style="margin:0">Google chua cau hinh. Dung email ben tren.</p>';
      return;
    }

    if (typeof google === "undefined" || !google.accounts || !google.accounts.id) {
      wrap.innerHTML =
        '<p class="auth-hint" style="margin:0">Dang tai Google…</p>';
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
    } catch (e) {
      console.warn("GIS render failed", e);
      wrap.innerHTML =
        '<p class="auth-hint" style="margin:0">Khong ve duoc nut Google. Thu email/mat khau.</p>';
    }
  }

  async function submitLogin(e) {
    if (e) e.preventDefault();
    clearMsgs();
    const email = (($("loginEmail") && $("loginEmail").value) || "").trim();
    const password = ($("loginPassword") && $("loginPassword").value) || "";
    if (!email || !password) {
      showErr("Nhap email va mat khau");
      return;
    }
    try {
      setHint("Dang dang nhap...");
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
      showErr("Nhap email de nhan ma");
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
      let msg = data.message || "Da gui ma xac thuc.";
      if (data.dev_code) {
        msg = "Ma xac thuc (dev): " + data.dev_code + " — nhap vao o Ma xac thuc.";
        if ($("regCode")) $("regCode").value = data.dev_code;
      }
      showOk(msg);
      if ($("codeHint")) {
        $("codeHint").textContent = data.sent ? "Kiem tra hop thu (va spam)." : "";
      }
      sendCodeCooldown = 45;
      const tick = function () {
        if (!btn) return;
        if (sendCodeCooldown <= 0) {
          btn.disabled = false;
          btn.textContent = "Gui ma";
          return;
        }
        btn.textContent = "Gui lai (" + sendCodeCooldown + "s)";
        sendCodeCooldown -= 1;
        setTimeout(tick, 1000);
      };
      tick();
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Gui ma";
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
      showErr("Nhap email va mat khau");
      return;
    }
    if (password.length < 6) {
      showErr("Mat khau toi thieu 6 ky tu");
      return;
    }
    if (!code) {
      showErr("Bam Gui ma roi nhap ma 6 so tu email");
      return;
    }
    try {
      setHint("Dang tao tai khoan...");
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
    const host = (location.hostname || "").toLowerCase();
    if (host === "127.0.0.1" || host === "localhost") {
      try {
        localStorage.removeItem(LS_API);
      } catch (_) {}
    }
    try {
      const r = await fetch(apiBase() + "/api/config", { cache: "no-store" });
      if (r.ok) {
        serverConfig = Object.assign(serverConfig, await r.json());
      } else {
        showErr("Server tra loi config: " + r.status);
      }
    } catch (e) {
      setHint(
        "Khong ket noi server " +
          apiBase() +
          " — chay BAT_DAU_WEB.cmd hoac python -m webapp.server"
      );
      showErr("Server dang tat (cong 7860). Bat server roi tai lai trang.");
    }
  }

  async function init(pageMode) {
    mode = pageMode === "register" ? "register" : "login";
    document.body.dataset.authPage = mode;

    window.addEventListener("message", onGoogleMessage);

    if (await alreadyLoggedIn()) return;
    await loadServerConfig();

    // Only official Google GIS button (below "hoac") — no white custom button
    renderGoogleButton();

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

  return { init, startGooglePopupLogin };
})();
