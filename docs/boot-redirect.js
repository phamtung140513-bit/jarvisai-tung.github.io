/**
 * GitHub Pages = static only (no API).
 * If opened on github.io / file:// → jump to live API host (same-origin login/chat).
 * config.json.apiBase must be the running tunnel/VPS URL.
 */
(function () {
  var host = (location.hostname || "").toLowerCase();
  var isStatic =
    host.indexOf("github.io") !== -1 || location.protocol === "file:";
  if (!isStatic) return;

  var path = location.pathname || "/";
  var file = path.split("/").pop() || "index.html";
  if (!file || file === host || file.indexOf(".") === -1) {
    file = "landing.html";
  }
  // Keep landing on github for marketing? No — full redirect for app pages.
  // Landing can stay, but login/register/chat/pricing must leave.
  var appPages = {
    "login.html": 1,
    "register.html": 1,
    "chat.html": 1,
    "pricing.html": 1,
    "google-callback.html": 1,
    "j-panel.html": 1,
  };
  if (!appPages[file] && file !== "index.html") {
    // landing.html stays on github (marketing) but CTA will use live links
    if (file === "landing.html") return;
  }

  function go(base) {
    base = String(base || "")
      .trim()
      .replace(/\/$/, "");
    if (!base || !/^https?:\/\//i.test(base)) return false;
    if (/127\.0\.0\.1|localhost/i.test(base)) return false;
    var target =
      base +
      "/" +
      file +
      (location.search || "") +
      (location.hash || "");
    if (target.replace(/\/$/, "") === location.href.replace(/\/$/, "")) return true;
    location.replace(target);
    return true;
  }

  // 1) localStorage override
  try {
    var ls = (localStorage.getItem("jarvis_api_base_v2") || "").trim();
    if (go(ls)) return;
  } catch (_) {}

  // 2) config.json
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "config.json?v=boot24", true);
  xhr.timeout = 8000;
  xhr.onload = function () {
    try {
      var j = JSON.parse(xhr.responseText || "{}");
      if (go(j.apiBase || j.liveApp || j.publicApi)) return;
    } catch (_) {}
    showStuck();
  };
  xhr.onerror = xhr.ontimeout = function () {
    showStuck();
  };
  xhr.send();

  function showStuck() {
    document.addEventListener("DOMContentLoaded", function () {
      var b = document.body;
      if (!b) return;
      b.innerHTML =
        '<div style="min-height:100vh;display:grid;place-items:center;background:#212121;color:#eee;font-family:system-ui;padding:1.5rem;text-align:center">' +
        "<p><b>Trang GitHub chỉ là giới thiệu.</b><br/>App + Google login chạy trên server.</p>" +
        '<p style="opacity:.8;font-size:.9rem">Cần link tunnel/VPS trong config.json (apiBase).</p>' +
        "</div>";
    });
  }
})();
