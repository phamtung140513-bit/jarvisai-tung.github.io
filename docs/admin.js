/**
 * TungDevAI Master Nexus Admin Logic — v10
 */
(() => {
  const LS_ADMIN = "jarvis_admin_token";
  const LS_API = "jarvis_api_base_v2";

  function $(id) {
    return document.getElementById(id);
  }

  function apiBase() {
    const raw = (localStorage.getItem(LS_API) || "").trim().replace(/\/$/, "");
    if (raw) return raw;
    const host = (location.hostname || "").toLowerCase();
    if (host === "127.0.0.1" || host === "localhost") {
      return (location.origin || "").replace(/\/$/, "");
    }
    if (host.indexOf("github.io") !== -1) {
      return "http://127.0.0.1:7860";
    }
    return (location.origin || "").replace(/\/$/, "");
  }

  function token() {
    return (localStorage.getItem(LS_ADMIN) || "").trim();
  }

  function headers() {
    const h = { "Content-Type": "application/json" };
    const t = token();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }

  function planBadge(plan) {
    const p = String(plan || "trial").toLowerCase();
    if (p === "business") return '<span class="badge badge-business">Business (5 mem) 🌟</span>';
    if (p === "pro") return '<span class="badge badge-pro">Pro VIP ⚡</span>';
    if (p === "basic") return '<span class="badge badge-basic">Basic 🚀</span>';
    return '<span class="badge badge-trial">Trial</span>';
  }

  async function api(path, opts = {}) {
    const res = await fetch(apiBase() + path, opts);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const msg = data.detail || text || res.statusText;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  }

  function showGate() {
    $("gate").classList.remove("hidden");
    $("dash").classList.add("hidden");
  }

  function showDash() {
    $("gate").classList.add("hidden");
    $("dash").classList.remove("hidden");
    refreshAll();
  }

  function showMsg(el, text, ok) {
    if (!el) return;
    el.classList.remove("hidden", "ok", "err");
    if (ok === true) el.classList.add("ok");
    else if (ok === false) el.classList.add("err");
    el.textContent = text;
  }

  async function refreshAll() {
    try {
      const st = await api("/api/admin/status", {
        headers: headers(),
        cache: "no-store",
      });
      $("sUsers").textContent = st.total_users != null ? st.total_users : "-";
      $("sActive").textContent = st.active_users != null ? st.active_users : "-";
      $("sMsg").textContent = st.messages_today != null ? st.messages_today : "-";
      $("serverInfo").textContent =
        "Cluster: " +
        (st.ai_provider || "gemini") +
        " | Model: " +
        (st.ai_model || "gemini-3.8-flash") +
        " | Web Sessions: " +
        (st.web_sessions_count != null ? st.web_sessions_count : 0) +
        " | AutoBank: Active";

      // Telegram Users
      try {
        const u = await api("/api/admin/users", {
          headers: headers(),
          cache: "no-store",
        });
        const tbody = $("usersBody");
        if (tbody) {
          tbody.innerHTML = "";
          (u.users || []).forEach((row) => {
            const tr = document.createElement("tr");
            const exp = row.expires_at ? String(row.expires_at).slice(0, 10) : "Vĩnh viễn";
            tr.innerHTML =
              "<td><code>" +
              row.telegram_id +
              "</code></td>" +
              "<td>" +
              (row.username ? "@" + row.username : "-") +
              "</td>" +
              "<td>" +
              planBadge(row.plan_id) +
              "</td>" +
              "<td>" +
              (row.active ? '<span style="color:#4ade80;font-weight:700;">ACTIVE</span>' : '<span style="color:#f87171;">OFF</span>') +
              "</td>" +
              "<td>" +
              exp +
              "</td>";
            tbody.appendChild(tr);
          });
        }
      } catch (_) {}

      // Web Users
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
            const exp = u.plan_expires_at ? String(u.plan_expires_at).slice(0, 10) : "Chưa có";
            tr.innerHTML =
              "<td>#" +
              u.id +
              "</td><td><strong>" +
              (u.email || "-") +
              "</strong></td><td>" +
              (u.name || "-") +
              "</td><td>" +
              planBadge(u.plan_id) +
              "</td><td>" +
              exp +
              "</td><td>" +
              (u.usage_count || 0) +
              " tin" +
              "</td>";
            wb.appendChild(tr);
          });
        }
      } catch (_) {}

      try { await refreshCoupons(); } catch(_) {}

      // Refresh CMD Keys
      try {
        await refreshCmdKeys();
      } catch (_) {}

    } catch (e) {
      if (/401|unauthorized|admin key/i.test(String(e.message || ""))) {
        localStorage.removeItem(LS_ADMIN);
        showGate();
      } else {
        showMsg($("dashMsg"), "Lỗi tải dữ liệu: " + e.message, false);
      }
    }
  }

  async function refreshCmdKeys() {
    const body = $("cmdKeysBody");
    if (!body) return;
    const data = await api("/api/admin/cmd-keys", {
      headers: headers(),
      cache: "no-store",
    });
    body.innerHTML = "";
    (data.keys || []).forEach((k) => {
      const tr = document.createElement("tr");
      const uses =
        (k.uses != null ? k.uses : 0) + "/" + (k.max_uses != null ? k.max_uses : 1);
      tr.innerHTML =
        "<td><code>" +
        (k.code || "") +
        "</code></td>" +
        "<td>" +
        (k.days || "-") +
        " ngày</td>" +
        "<td>" +
        uses +
        "</td>" +
        "<td>" +
        (k.note || "-") +
        "</td>" +
        "<td>" +
        (k.active ? '<span style="color:#4ade80;font-weight:700;">ON</span>' : '<span style="color:#f87171;">OFF</span>') +
        "</td>" +
        "<td>" +
        '<td style="display:flex;gap:0.35rem;">' +
        (k.active
          ? '<button type="button" class="btn btn-sm" data-revoke="' +
            (k.code || "") +
            '">Thu hồi</button>'
          : '<button type="button" class="btn btn-sm" style="opacity:0.5;" disabled>Đã tắt</button>') +
        '<button type="button" class="btn danger btn-sm" data-delete-cmd="' +
        (k.code || "") +
        '">Xóa</button>' +
        '</td>';
      body.appendChild(tr);
    });
    body.querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.onclick = async () => {
        const code = btn.getAttribute("data-revoke") || "";
        if (!code || !confirm("Thu hồi key " + code + "?")) return;
        try {
          await api("/api/admin/cmd-keys/revoke", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ code: code }),
          });
          showMsg($("dashMsg"), "Đã thu hồi key " + code, true);
          await refreshCmdKeys();
        } catch (e) {
          showMsg($("dashMsg"), String(e.message || e), false);
        }
      };
    });

    body.querySelectorAll("[data-delete-cmd]").forEach((btn) => {
      btn.onclick = async () => {
        const code = btn.getAttribute("data-delete-cmd") || "";
        if (!code || !confirm("Bạn có chắc chắn muốn XÓA VĨNH VIỄN key " + code + " khỏi hệ thống?")) return;
        try {
          await api("/api/admin/cmd-keys/delete", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ code: code }),
          });
          showMsg($("dashMsg"), "Đã xóa vĩnh viễn key " + code, true);
          await refreshCmdKeys();
        } catch (e) {
          showMsg($("dashMsg"), String(e.message || e), false);
        }
      };
    });
  }

  // Tab switching
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
    showMsg($("gateMsg"), "Đang xác thực bảo mật...", null);
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key }),
      });
      localStorage.setItem(LS_ADMIN, data.admin_token || key);
      showMsg($("gateMsg"), "Xác thực thành công!", true);
      showDash();
    } catch (e) {
      showMsg(
        $("gateMsg"),
        "Mật mã Admin không chính xác. Truy cập bị từ chối!",
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
        "MÃ KÍCH HOẠT: " +
        data.code +
        "\nGói: " +
        data.plan_name +
        " (" +
        data.days +
        " ngày)\n\nCú pháp khách gõ:\n/activate " +
        data.code;
      showMsg($("dashMsg"), "Đã tạo mã kích hoạt thành công: " + data.code, true);
    } catch (e) {
      showMsg($("dashMsg"), String(e.message || e), false);
    }
  };

  $("btnSetPlan").onclick = async () => {
    try {
      const tid = Number($("planTg").value);
      if (!tid) throw new Error("Nhập Telegram ID");
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
        "Đã nâng cấp Telegram User " + data.telegram_id + " lên gói " + data.plan_id,
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
      if (!tid) throw new Error("Nhập Telegram ID");
      if (!confirm("Bạn có chắc chắn muốn khóa tài khoản " + tid + "?")) return;
      await api("/api/admin/deluser", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ telegram_id: tid }),
      });
      showMsg($("dashMsg"), "Đã khóa tài khoản " + tid, true);
      refreshAll();
    } catch (e) {
      showMsg($("dashMsg"), String(e.message || e), false);
    }
  };

  if ($("btnWebSetPlan")) {
    $("btnWebSetPlan").onclick = async () => {
      try {
        const email = ($("webPlanEmail").value || "").trim();
        if (!email) throw new Error("Vui lòng nhập email tài khoản web");
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
          "Đã kích hoạt thành công gói " + (u.plan_id || body.plan) + " cho " + (u.email || email) + "!",
          true
        );
        refreshAll();
      } catch (e) {
        showMsg($("dashMsg"), String(e.message || e), false);
      }
    };
  }

  if ($("btnGenCmdKey")) {
    $("btnGenCmdKey").onclick = async () => {
      try {
        const body = {
          days: Number(($("cmdDays") && $("cmdDays").value) || 30) || 30,
          max_uses: Number(($("cmdMaxUses") && $("cmdMaxUses").value) || 1) || 1,
          note: (($("cmdNote") && $("cmdNote").value) || "cmd_admin").trim(),
        };
        const data = await api("/api/admin/cmd-keys", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        });
        const k = data.key || {};
        const box = $("cmdKeyResult");
        if (box) {
          box.classList.remove("hidden");
          box.textContent =
            "KEY CLI BẢN QUYỀN: " +
            (k.code || "") +
            "\nThời hạn: " +
            (k.days || body.days) +
            " ngày | Giới hạn: " +
            (k.max_uses || body.max_uses) +
            " máy\n\nKhách chạy file tungdev.cmd rồi gõ:\n/activate " +
            (k.code || "");
        }
        showMsg($("dashMsg"), "Đã tạo Key CLI: " + (k.code || ""), true);
        await refreshCmdKeys();
      } catch (e) {
        showMsg($("dashMsg"), String(e.message || e), false);
      }
    };
  }

  if ($("btnRefreshCmdKeys")) {
    $("btnRefreshCmdKeys").onclick = async () => {
      try {
        await refreshCmdKeys();
        showMsg($("dashMsg"), "Đã làm mới danh sách Key CLI", true);
      } catch (e) {
        showMsg($("dashMsg"), String(e.message || e), false);
      }
    };
  }

  
  // --- COUPON MANAGEMENT ---
  async function refreshCoupons() {
    const body = $("couponsBody");
    if (!body) return;
    try {
      const data = await api("/api/admin/coupons", { headers: headers(), cache: "no-store" });
      body.innerHTML = "";
      (data.coupons || []).forEach((c) => {
        const tr = document.createElement("tr");
        const discountText = c.discount_percent > 0 ? `-${c.discount_percent}%` : `-${Number(c.discount_amount).toLocaleString("vi-VN")} đ`;
        const planText = c.plan_id === "all" ? "Tất cả gói" : c.plan_id.toUpperCase();
        const exp = c.expires_at ? String(c.expires_at).slice(0, 10) : "Vĩnh viễn";
        const uses = `${c.uses || 0} / ${c.max_uses || 100}`;
        const statusBadge = c.active ? '<span style="color:#4ade80;font-weight:700;">ACTIVE</span>' : '<span style="color:#f87171;">TẮT</span>';
        
        tr.innerHTML = `
          <td><code>${c.code}</code></td>
          <td><strong style="color:#34d399;">${discountText}</strong></td>
          <td>${planText}</td>
          <td>${uses}</td>
          <td>${exp}</td>
          <td>${statusBadge}</td>
          <td style="display:flex;gap:0.4rem;">
            <button type="button" class="btn btn-sm" data-toggle-cp="${c.code}" data-active="${c.active ? "0" : "1"}">${c.active ? "Tắt" : "Bật"}</button>
            <button type="button" class="btn danger btn-sm" data-del-cp="${c.code}">Xóa</button>
          </td>
        `;
        body.appendChild(tr);
      });

      body.querySelectorAll("[data-toggle-cp]").forEach((btn) => {
        btn.onclick = async () => {
          const code = btn.getAttribute("data-toggle-cp");
          const nextActive = btn.getAttribute("data-active") === "1";
          try {
            await api("/api/admin/coupons/toggle", {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ code: code, active: nextActive }),
            });
            showMsg($("dashMsg"), `Đã ${nextActive ? "Bật" : "Tắt"} mã ${code}`, true);
            await refreshCoupons();
          } catch (e) {
            showMsg($("dashMsg"), String(e.message || e), false);
          }
        };
      });

      body.querySelectorAll("[data-del-cp]").forEach((btn) => {
        btn.onclick = async () => {
          const code = btn.getAttribute("data-del-cp");
          if (!confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn mã giảm giá ${code}?`)) return;
          try {
            await api("/api/admin/coupons/delete", {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ code: code }),
            });
            showMsg($("dashMsg"), `Đã xóa mã ${code}`, true);
            await refreshCoupons();
          } catch (e) {
            showMsg($("dashMsg"), String(e.message || e), false);
          }
        };
      });
    } catch (e) {
      showMsg($("dashMsg"), "Lỗi tải mã giảm giá: " + e.message, false);
    }
  }

  if ($("btnCreateCoupon")) {
    $("btnCreateCoupon").onclick = async () => {
      const code = ($("cpCode").value || "").trim().toUpperCase();
      if (!code) {
        showMsg($("dashMsg"), "Vui lòng nhập mã code", false);
        return;
      }
      const type = $("cpType").value;
      const val = Number($("cpValue").value || 0);
      if (val <= 0) {
        showMsg($("dashMsg"), "Vui lòng nhập mức giảm giá > 0", false);
        return;
      }
      const body = {
        code: code,
        discount_percent: type === "percent" ? val : 0,
        discount_amount: type === "amount" ? val : 0,
        plan_id: $("cpPlan").value,
        max_uses: Number($("cpMaxUses").value || 100),
        days: Number($("cpDays").value || 30),
        note: ($("cpNote").value || "").trim(),
      };
      try {
        const data = await api("/api/admin/coupons", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        });
        showMsg($("dashMsg"), `🎉 Đã tạo thành công mã giảm giá ${data.coupon.code}!`, true);
        $("cpCode").value = "";
        await refreshCoupons();
      } catch (e) {
        showMsg($("dashMsg"), String(e.message || e), false);
      }
    };
  }

  if ($("btnRefreshCoupons")) {
    $("btnRefreshCoupons").onclick = async () => {
      await refreshCoupons();
      showMsg($("dashMsg"), "Đã làm mới danh sách mã giảm giá", true);
    };
  }


  if (token()) showDash();
  else showGate();
})();
