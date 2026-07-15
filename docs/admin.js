/**
 * TungDevAI Admin management console (secret page /j-panel.html).
 * Works on same-origin server or GitHub Pages (API -> 127.0.0.1:7860).
 */
(() => {
  const LS_API = "jarvis_api_base_v2";
  const LS_ADMIN = "jarvis_admin_token_v2";

  const $ = (id) => document.getElementById(id);

  function apiBase() {
    const loginField = ($("apiBaseLogin") && $("apiBaseLogin").value.trim()) || "";
    if (loginField) return loginField.replace(/\/$/, "");
    const ls = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
    if (ls) return ls;
    const host = (location.hostname || "").toLowerCase();
    // GitHub Pages static -> local API
    if (host.indexOf("github.io") !== -1) return "http://127.0.0.1:7860";
    return (location.origin || "http://127.0.0.1:7860").replace(/\/$/, "");
  }

  function token() {
    return localStorage.getItem(LS_ADMIN) || "";
  }

  function headers() {
    return {
      "Content-Type": "application/json",
      "X-Admin-Token": token(),
    };
  }

  function showMsg(el, text, ok) {
    el.classList.remove("hidden");
    el.textContent = text;
    el.className = "msg " + (ok === true ? "ok" : ok === false ? "err" : "");
  }

  function showGate() {
    $("gate").classList.remove("hidden");
    $("dash").classList.add("hidden");
  }

  function showDash() {
    $("gate").classList.add("hidden");
    $("dash").classList.remove("hidden");
    $("chatLink").href = apiBase() + "/chat.html";
    refreshAll();
  }

  async function api(path, opts) {
    const r = await fetch(apiBase() + path, opts);
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
    if (!r.ok) throw new Error(data.detail || text || "HTTP " + r.status);
    return data;
  }

  async function refreshAll() {
    try {
      const st = await api("/api/admin/status", { headers: headers(), cache: "no-store" });
      $("sUsers").textContent = st.stats ? st.stats.users : "-";
      $("sActive").textContent = st.stats ? st.stats.active : "-";
      $("sMsg").textContent = st.stats ? st.stats.messages_today : "-";
      $("serverInfo").textContent =
        "provider=" +
        st.provider +
        " | model=" +
        st.model +
        " | web_sessions=" +
        (st.web_sessions || 0);
      $("dashSub").textContent = st.app + " · quan ly user / ma kich hoat";

      const us = await api("/api/admin/users?limit=50", {
        headers: headers(),
        cache: "no-store",
      });
      const body = $("usersBody");
      body.innerHTML = "";
      (us.users || []).forEach((u) => {
        const tr = document.createElement("tr");
        const un = u.username ? "@" + u.username : u.full_name || "-";
        const exp = u.expires_at ? u.expires_at.slice(0, 10) : "∞";
        tr.innerHTML =
          "<td><code>" +
          u.telegram_id +
          "</code></td>" +
          "<td>" +
          un +
          "</td>" +
          "<td>" +
          u.plan_id +
          "</td>" +
          "<td>" +
          (u.active ? "ON" : "OFF") +
          "</td>" +
          "<td>" +
          exp +
          "</td>" +
          '<td><button type="button" class="btn danger btn-sm" data-del="' +
          u.telegram_id +
          '">Khoa</button></td>';
        body.appendChild(tr);
      });
      body.querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async () => {
          const tid = Number(btn.getAttribute("data-del"));
          if (!confirm("Khoa user " + tid + "?")) return;
          try {
            await api("/api/admin/deluser", {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ telegram_id: tid }),
            });
            showMsg($("dashMsg"), "Da khoa " + tid, true);
            refreshAll();
          } catch (e) {
            showMsg($("dashMsg"), String(e.message || e), false);
          }
        };
      });

      // Web users
      try {
        const wu = await api("/api/admin/web-users", {
          headers: headers(),
          cache: "no-store",
        });
        const wb = $("webUsersBody");
        if (wb) {
          wb.innerHTML = "";
          (wu.users || []).forEach((u) => {
            const tr = document.createElement("tr");
            const exp = u.plan_expires_at ? String(u.plan_expires_at).slice(0, 10) : "-";
            tr.innerHTML =
              "<td>" +
              u.id +
              "</td><td>" +
              (u.email || "-") +
              "</td><td>" +
              (u.name || "-") +
              "</td><td>" +
              (u.plan_id || "trial") +
              "</td><td>" +
              exp +
              "</td><td>" +
              (u.usage_count || 0) +
              (u.usage_day ? " (" + u.usage_day + ")" : "") +
              "</td>";
            wb.appendChild(tr);
          });
        }
      } catch (we) {
        console.warn("web-users", we);
      }
    } catch (e) {
      showMsg($("dashMsg"), String(e.message || e), false);
      if (String(e.message || "").indexOf("401") !== -1 || String(e.message || "").toLowerCase().indexOf("sai") !== -1) {
        localStorage.removeItem(LS_ADMIN);
        showGate();
      }
    }
  }

  // Tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("on"));
      tab.classList.add("on");
      const name = tab.getAttribute("data-tab");
      document.querySelectorAll(".tabpane").forEach((p) => p.classList.add("hidden"));
      $("pane-" + name).classList.remove("hidden");
    };
  });

  $("btnLogin").onclick = async () => {
    const key = ($("key").value || "").trim();
    const baseInput = ($("apiBaseLogin").value || "").trim().replace(/\/$/, "");
    if (baseInput) localStorage.setItem(LS_API, baseInput);
    showMsg($("gateMsg"), "Dang nhap...", null);
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key }),
      });
      localStorage.setItem(LS_ADMIN, data.admin_token || key);
      showMsg($("gateMsg"), "OK", true);
      showDash();
    } catch (e) {
      showMsg(
        $("gateMsg"),
        String(e.message || e) +
          "\n\nDam bao:\n- Server: python -m webapp.server\n- API: http://127.0.0.1:7860\n- WEB_ADMIN_KEY dung",
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

  $("btnLogout").onclick = () => {
    localStorage.removeItem(LS_ADMIN);
    $("key").value = "";
    showGate();
  };

  $("btnRefresh").onclick = () => refreshAll();

  $("btnGenCode").onclick = async () => {
    try {
      const daysRaw = ($("codeDays").value || "").trim();
      const body = {
        plan: $("codePlan").value,
        note: ($("codeNote").value || "web_admin").trim(),
      };
      if (daysRaw) body.days = Number(daysRaw);
      const data = await api("/api/admin/gencode", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      const box = $("codeResult");
      box.classList.remove("hidden");
      box.textContent =
        "MA: " +
        data.code +
        "\nGoi: " +
        data.plan_name +
        " (" +
        data.days +
        " ngay)\nKhach go:\n/activate " +
        data.code;
      showMsg($("dashMsg"), "Da tao ma " + data.code, true);
    } catch (e) {
      showMsg($("dashMsg"), String(e.message || e), false);
    }
  };

  $("btnSetPlan").onclick = async () => {
    try {
      const tid = Number($("planTg").value);
      if (!tid) throw new Error("Nhap telegram_id");
      const daysRaw = ($("planDays").value || "").trim();
      const body = { telegram_id: tid, plan: $("planId").value };
      if (daysRaw) body.days = Number(daysRaw);
      const data = await api("/api/admin/setplan", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      showMsg(
        $("dashMsg"),
        "OK user " + data.telegram_id + " -> " + data.plan_id,
        true
      );
      refreshAll();
    } catch (e) {
      showMsg($("dashMsg"), String(e.message || e), false);
    }
  };

  $("btnDelUser").onclick = async () => {
    try {
      const tid = Number($("planTg").value);
      if (!tid) throw new Error("Nhap telegram_id");
      if (!confirm("Khoa user " + tid + "?")) return;
      await api("/api/admin/deluser", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ telegram_id: tid }),
      });
      showMsg($("dashMsg"), "Da khoa " + tid, true);
      refreshAll();
    } catch (e) {
      showMsg($("dashMsg"), String(e.message || e), false);
    }
  };

  if ($("btnWebSetPlan")) {
    $("btnWebSetPlan").onclick = async () => {
      try {
        const email = ($("webPlanEmail").value || "").trim();
        if (!email) throw new Error("Nhap email user web");
        const daysRaw = ($("webPlanDays").value || "").trim();
        const body = { email: email, plan: $("webPlanId").value };
        if (daysRaw) body.days = Number(daysRaw);
        const data = await api("/api/admin/web-setplan", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        });
        const u = data.user || {};
        showMsg(
          $("dashMsg"),
          "OK web " + (u.email || email) + " -> " + (u.plan_id || body.plan),
          true
        );
        refreshAll();
      } catch (e) {
        showMsg($("dashMsg"), String(e.message || e), false);
      }
    };
  }

  // Prefill API base
  var defaultApi =
    location.hostname.toLowerCase().indexOf("github.io") !== -1
      ? "http://127.0.0.1:7860"
      : location.origin || "http://127.0.0.1:7860";
  if ($("apiBaseLogin")) {
    $("apiBaseLogin").value = localStorage.getItem(LS_API) || defaultApi;
    $("apiBaseLogin").placeholder =
      "http://127.0.0.1:7860 hoac https://xxx.trycloudflare.com";
  }

  if (token()) showDash();
  else showGate();
})();
