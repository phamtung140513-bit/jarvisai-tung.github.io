/**
 * Secret admin page only — not linked from user chat.
 */
(() => {
  const LS_API = "jarvis_api_base_v2";
  const LS_USER = "jarvis_user_token_v2";
  const LS_ADMIN = "jarvis_admin_token_v2";

  const $ = (id) => document.getElementById(id);

  function apiBase() {
    const ls = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
    if (ls) return ls;
    if (location.hostname.toLowerCase().indexOf("github.io") !== -1) {
      return "http://127.0.0.1:7860";
    }
    return (location.origin || "").replace(/\/$/, "");
  }

  function show(el, on) {
    el.classList.toggle("hidden", !on);
  }

  function msg(el, text, ok) {
    el.classList.remove("hidden");
    el.textContent = text;
    el.style.color = ok === true ? "#34d399" : ok === false ? "#fca5a5" : "#cfcfcf";
  }

  function showDash() {
    show($("gate"), false);
    show($("dash"), true);
    $("apiBase").value = localStorage.getItem(LS_API) || "";
    $("userToken").value = localStorage.getItem(LS_USER) || "";
    $("chatLink").href = (localStorage.getItem(LS_API) || location.origin || "").replace(/\/$/, "") + "/";
    refreshStatus();
  }

  function showGate() {
    show($("dash"), false);
    show($("gate"), true);
  }

  async function refreshStatus() {
    const box = $("dashMsg");
    box.textContent = "Loading...";
    try {
      const base = apiBase();
      const r = await fetch(base + "/api/admin/status", {
        headers: { "X-Admin-Token": localStorage.getItem(LS_ADMIN) || "" },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      msg(
        box,
        "OK\nprovider: " + j.provider + "\nmodel: " + j.model + "\nuser_auth: " + j.user_auth_required,
        true
      );
    } catch (e) {
      msg(box, "Loi: " + (e.message || e), false);
    }
  }

  // Auto enter if already logged in
  if (localStorage.getItem(LS_ADMIN)) {
    showDash();
  }

  $("btnLogin").onclick = async () => {
    const key = ($("key").value || "").trim();
    const out = $("gateMsg");
    msg(out, "Checking...", null);
    try {
      const base = apiBase();
      const r = await fetch(base + "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      localStorage.setItem(LS_ADMIN, j.admin_token || key);
      showDash();
    } catch (e) {
      msg(
        out,
        String(e.message || e) +
          "\nDam bao server chay: python -m webapp.server\nWEB_ADMIN_KEY dung trong .env",
        false
      );
    }
  };

  $("key").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("btnLogin").click();
    }
  });

  $("btnSave").onclick = () => {
    const base = ($("apiBase").value || "").trim().replace(/\/$/, "");
    if (base) localStorage.setItem(LS_API, base);
    else localStorage.removeItem(LS_API);
    const ut = ($("userToken").value || "").trim();
    if (ut) localStorage.setItem(LS_USER, ut);
    else localStorage.removeItem(LS_USER);
    $("chatLink").href = apiBase() + "/";
    msg($("dashMsg"), "Da luu (chi may nay).", true);
  };

  $("btnTest").onclick = () => refreshStatus();

  $("btnLogout").onclick = () => {
    localStorage.removeItem(LS_ADMIN);
    $("key").value = "";
    showGate();
  };
})();
