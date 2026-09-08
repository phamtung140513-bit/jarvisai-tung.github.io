/**
 * Web checkout: VietQR (STK shop) + poll trạng thái + Mã Giảm Giá (Coupons)
 */
(() => {
  const LS_SESSION = "jarvis_google_session_v1";
  const LS_USER = "jarvis_google_user_v1";
  const LS_API = "jarvis_api_base_v2";

  let currentPlan = "basic";
  let currentCoupon = null;

  function apiBase() {
    const host = (location.hostname || "").toLowerCase();
    if (host === "127.0.0.1" || host === "localhost") {
      return (location.origin || "").replace(/\/$/, "");
    }
    if (host.indexOf("github.io") !== -1) {
      return (localStorage.getItem(LS_API) || "http://127.0.0.1:7860").replace(
        /\/$/,
        ""
      );
    }
    return (location.origin || "").replace(/\/$/, "");
  }

  function session() {
    return (localStorage.getItem(LS_SESSION) || "").trim();
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(LS_USER) || "null");
    } catch (_) {
      return null;
    }
  }

  function headers() {
    const h = {
      "Content-Type": "application/json",
    };
    const s = session();
    if (s) h["X-User-Session"] = s;
    return h;
  }

  function getModal() {
    return document.getElementById("payModal");
  }

  function getEls() {
    return {
      title: document.getElementById("payTitle"),
      sub: document.getElementById("paySub"),
      qr: document.getElementById("payQr"),
      amount: document.getElementById("payAmount"),
      content: document.getElementById("payContent"),
      orderId: document.getElementById("payOrderId"),
      status: document.getElementById("payStatus"),
      hint: document.getElementById("payHint"),
      openPage: document.getElementById("payOpenPage"),
      goChat: document.getElementById("payGoChat"),
      close: document.getElementById("payClose"),
      couponInput: document.getElementById("payCouponInput"),
      couponBtn: document.getElementById("payCouponBtn"),
      couponMsg: document.getElementById("payCouponMsg"),
    };
  }

  let pollTimer = null;

  function openModal() {
    const m = getModal();
    if (m) {
      m.classList.remove("hidden");
      m.style.display = "flex";
    }
  }

  function closeModal() {
    const m = getModal();
    if (m) {
      m.classList.add("hidden");
      m.style.display = "none";
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showCouponMsg(text, ok) {
    const els = getEls();
    if (!els.couponMsg) return;
    els.couponMsg.classList.remove("hidden", "ok", "err");
    if (ok === true) els.couponMsg.classList.add("ok");
    else if (ok === false) els.couponMsg.classList.add("err");
    els.couponMsg.textContent = text;
  }

  function initModalEvents() {
    const els = getEls();
    const modal = getModal();
    if (els.close) {
      els.close.onclick = closeModal;
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal || (e.target && e.target.classList && e.target.classList.contains("p-modal-backdrop"))) {
          closeModal();
        }
      });
    }

    if (els.couponBtn && els.couponInput) {
      els.couponBtn.onclick = async () => {
        const code = (els.couponInput.value || "").trim().toUpperCase();
        if (!code) {
          showCouponMsg("Vui lòng nhập mã giảm giá", false);
          return;
        }
        els.couponBtn.textContent = "Kiểm tra...";
        try {
          const r = await fetch(apiBase() + "/api/billing/validate-coupon", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: code, plan: currentPlan }),
          });
          const data = await r.json();
          if (!r.ok) {
            throw new Error(data.detail || "Mã không hợp lệ");
          }
          currentCoupon = code;
          const pct = data.discount_percent ? ` (-${data.discount_percent}%)` : "";
          const diff = Number(data.discount_amount || 0).toLocaleString("vi-VN") + " đ";
          showCouponMsg(`🎉 Đã áp dụng mã ${data.code}: Giảm ${diff}${pct}`, true);
          createOrder(currentPlan, currentCoupon);
        } catch (e) {
          currentCoupon = null;
          showCouponMsg(String(e.message || e), false);
        } finally {
          els.couponBtn.textContent = "Áp Dụng";
        }
      };

      els.couponInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          els.couponBtn.click();
        }
      });
    }
  }

  async function createOrder(plan, couponCode = null) {
    currentPlan = (plan || "basic").toLowerCase();
    const els = getEls();

    // Mở Modal tức thì để người dùng có phản hồi ngay
    openModal();
    if (els.title) els.title.textContent = "Đang tạo mã QR...";
    if (els.sub) els.sub.textContent = "Quét QR để chuyển khoản đúng nội dung";
    if (els.status) {
      els.status.textContent = "Đang xử lý...";
      els.status.style.color = "#fbbf24";
    }
    if (els.amount) els.amount.textContent = "---";
    if (els.content) els.content.textContent = "---";
    if (els.orderId) els.orderId.textContent = "---";
    if (els.hint) els.hint.textContent = "Đang kết nối cổng thanh toán VietQR...";
    if (els.qr) {
      els.qr.removeAttribute("src");
      els.qr.alt = "VietQR";
    }
    if (els.goChat) els.goChat.classList.add("hidden");

    try {
      const payload = { plan: currentPlan };
      if (couponCode) payload.coupon_code = couponCode;

      const r = await fetch(apiBase() + "/api/billing/create-order", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
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
        let msg = typeof d === "string" ? d : d?.message || text || "Lỗi tạo đơn";
        if (/VIETQR|3000|tạo được QR|ECONNREFUSED|connect/i.test(msg)) {
          msg = "Máy chủ thanh toán đang khởi động lại. Vui lòng thử lại sau vài giây.";
        }
        throw new Error(msg);
      }

      // 0d Instant Free Activation
      if (data.free || data.amount === 0 || String(data.status).toLowerCase() === "paid") {
        if (els.title) els.title.textContent = "🎉 KÍCH HOẠT THÀNH CÔNG!";
        if (els.sub) els.sub.textContent = "Gói " + (data.plan_name || currentPlan.toUpperCase()) + " (0đ) đã được kích hoạt miễn phí 100%!";
        if (els.status) {
          els.status.textContent = "ĐÃ KÍCH HOẠT THÀNH CÔNG";
          els.status.style.color = "#34d399";
        }
        if (els.amount) els.amount.innerHTML = `<span style="color:#34d399;font-weight:800;font-size:1.4rem;">0 đ</span> <span style="font-size:0.8rem;color:#a3e635;font-weight:700;">(Miễn Phí 100%)</span>`;
        if (els.hint) els.hint.innerHTML = `<span style="color:#34d399;font-weight:700;">🚀 Đang tự động chuyển hướng vào Web Chat Studio trong 1.5 giây...</span>`;
        if (els.qr) els.qr.style.display = "none";
        if (els.goChat) els.goChat.classList.remove("hidden");
        if (data.user) {
          localStorage.setItem(LS_USER, JSON.stringify(data.user));
        }
        setTimeout(() => {
          window.location.href = "/chat.html";
        }, 1500);
        return;
      }

      if (els.title) els.title.textContent = "Mua gói " + (data.plan_name || currentPlan.toUpperCase());
      if (els.sub) els.sub.textContent = "Quét QR để chuyển khoản đúng nội dung";
      if (els.amount) {
        const amtStr = Number(data.amount || 0).toLocaleString("vi-VN") + " đ";
        if (couponCode) {
          els.amount.innerHTML = `<span style="color:#34d399;font-weight:800;">${amtStr}</span> <span style="font-size:0.75rem;color:#a3e635;">(Đã giảm giá)</span>`;
        } else {
          els.amount.textContent = amtStr;
        }
      }
      if (els.content) els.content.textContent = data.content || "---";
      if (els.orderId) els.orderId.textContent = data.orderId || "---";
      if (els.status) {
        els.status.textContent = "Đang chờ thanh toán...";
        els.status.style.color = "#fbbf24";
      }
      if (els.hint)
        els.hint.textContent =
          "Chuyển khoản đúng số tiền + nội dung. Hệ thống auto kích hoạt khi nhận tiền.";
      if (els.qr && data.qrImageUrl) {
        els.qr.src = data.qrImageUrl;
        els.qr.alt = "QR " + (data.orderId || "");
        els.qr.onerror = function () {
          if (els.hint)
            els.hint.textContent =
              "Không tải được ảnh QR. Kiểm tra mạng hoặc bấm mở trang riêng.";
        };
      }
      if (els.openPage) {
        if (data.payPage) {
          els.openPage.href = data.payPage;
          els.openPage.classList.remove("hidden");
        } else {
          els.openPage.classList.add("hidden");
        }
      }
      startPoll(data.orderId);
    } catch (e) {
      const msg = String(e.message || e);
      if (els.status) {
        els.status.textContent = "Lỗi";
        els.status.style.color = "#f87171";
      }
      if (els.hint) els.hint.textContent = msg;
    }
  }

  function startPoll(orderId) {
    if (!orderId) return;
    if (pollTimer) clearInterval(pollTimer);
    let n = 0;
    pollTimer = setInterval(async () => {
      n += 1;
      const els = getEls();
      if (n > 200) {
        clearInterval(pollTimer);
        pollTimer = null;
        if (els.hint)
          els.hint.textContent =
            "Hết thời gian chờ. Nếu đã chuyển khoản, hãy vào Chat nhắn Admin.";
        return;
      }
      try {
        const r = await fetch(
          apiBase() +
            "/api/billing/order-status?order_id=" +
            encodeURIComponent(orderId),
          { headers: headers(), cache: "no-store" }
        );
        if (!r.ok) return;
        const data = await r.json();
        const st = String(data.status || "").toLowerCase();
        if (st === "paid") {
          clearInterval(pollTimer);
          pollTimer = null;
          if (els.status) {
            els.status.textContent = "Đã nhận thanh toán thành công! 🎉";
            els.status.style.color = "#4ade80";
          }
          if (els.hint)
            els.hint.textContent =
              "Thành công! Gói VIP đã được kích hoạt. Hãy vào Chat để trải nghiệm!";
          if (els.goChat) els.goChat.classList.remove("hidden");
          if (data.user) {
            try {
              localStorage.setItem(LS_USER, JSON.stringify(data.user));
            } catch (e) {}
          }
        }
      } catch (e) {
        /* ignore */
      }
    }, 3000);
  }

  // --- TAB SWITCHING: Cá Nhân vs Doanh Nghiệp ---
  function initTabs() {
    const tPersonal = document.getElementById("tabPersonal");
    const tBiz = document.getElementById("tabBiz");
    const gPersonal = document.getElementById("gridPersonal");
    const gBiz = document.getElementById("gridBiz");

    if (tPersonal && tBiz && gPersonal && gBiz) {
      tPersonal.addEventListener("click", (e) => {
        e.preventDefault();
        tPersonal.classList.add("active");
        tBiz.classList.remove("active");
        gPersonal.classList.remove("hidden");
        gBiz.classList.add("hidden");
      });

      tBiz.addEventListener("click", (e) => {
        e.preventDefault();
        tBiz.classList.add("active");
        tPersonal.classList.remove("active");
        gBiz.classList.remove("hidden");
        gPersonal.classList.add("hidden");
      });

      try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get("tab") === "biz") {
          tBiz.click();
        }
      } catch (err) {}
    }
  }

  // --- NAVBAR AUTH STATE (Đổi Đăng nhập -> Đăng xuất khi đã login) ---
  function updateNavbarAuth() {
    const u = getUser();
    const navLinks = document.querySelector(".p-nav-links");
    if (!navLinks) return;

    if (session() && u) {
      const loginLink = navLinks.querySelector('a[href*="login.html"]');
      const regLink = navLinks.querySelector('a[href*="register.html"]');
      if (regLink) regLink.remove();

      if (loginLink) {
        const shortName = (u.name || u.email || "User").split(" ")[0];
        loginLink.innerHTML = "🚪 Đăng Xuất (" + shortName + ")";
        loginLink.href = "#logout";
        loginLink.style.color = "#f87171";
        loginLink.style.fontWeight = "700";
        loginLink.onclick = (e) => {
          e.preventDefault();
          if (confirm("Bạn có chắc chắn muốn đăng xuất tài khoản?")) {
            try {
              fetch(apiBase() + "/api/auth/logout", { method: "POST", headers: headers() }).catch(() => {});
              localStorage.removeItem(LS_SESSION);
              localStorage.removeItem(LS_USER);
            } catch (_) {}
            location.reload();
          }
        };
      }
    }
  }

  
  // --- ACTIVE PLAN HIGHLIGHT ---
  async function updatePlanCardsState() {
    let u = getUser();
    if (session()) {
      try {
        const r = await fetch(apiBase() + "/api/auth/me", { headers: headers(), cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          if (data && data.user) {
            u = data.user;
            try { localStorage.setItem(LS_USER, JSON.stringify(u)); } catch (_) {}
          }
        }
      } catch (_) {}
    }

    if (!u && !session()) return;

    const currentPlanId = ((u && (u.plan_id || u.plan_name)) || "trial").toLowerCase().trim();

    // 1. Free/Trial button
    const freeBtn = document.getElementById("btnFreePlan") || document.querySelector('a[href*="register.html"]');
    if (freeBtn) {
      if (currentPlanId === "trial") {
        freeBtn.textContent = "✓ Gói Bạn Đang Sử Dụng";
        freeBtn.classList.add("p-cta-current");
        freeBtn.href = "chat.html";
      } else {
        freeBtn.textContent = "Vào Web Chat";
        freeBtn.href = "chat.html";
      }
    }

    // 2. Paid buttons
    document.querySelectorAll(".js-buy").forEach((btn) => {
      const plan = (btn.getAttribute("data-plan") || "").toLowerCase().trim();
      const card = btn.closest(".p-card");
      if (plan === currentPlanId) {
        if (plan === "business") {
          btn.innerHTML = "👥 Quản Lý 5 Thành Viên Team ↗";
          btn.onclick = (e) => { e.preventDefault(); location.assign("chat.html?team=1"); };
        } else {
          btn.innerHTML = "✓ Gói Bạn Đang Sử Dụng";
        }
        btn.classList.add("p-cta-current");
        btn.classList.remove("p-cta-primary", "p-cta-muted");

        if (card && !card.querySelector(".p-badge-active-user")) {
          const badge = document.createElement("div");
          badge.className = "p-badge p-badge-active-user";
          badge.style.background = "linear-gradient(135deg, #10b981, #059669)";
          badge.style.color = "#010402";
          badge.style.fontWeight = "800";
          badge.textContent = "✨ Đang Kích Hoạt";
          card.prepend(badge);
        }
      } else {
        btn.classList.remove("p-cta-current");
        if (card) {
          const oldBadge = card.querySelector(".p-badge-active-user");
          if (oldBadge) oldBadge.remove();
        }
      }
    });
  }


  // --- EVENT BUY BUTTONS ---
  function attachBuyEvents() {
    initModalEvents();
    initTabs();
    updateNavbarAuth();
    updatePlanCardsState();

    document.querySelectorAll(".js-buy").forEach((btn) => {
      if (btn.dataset.hasBuyListener) return;
      btn.dataset.hasBuyListener = "1";
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const plan = btn.getAttribute("data-plan") || "basic";
        currentPlan = plan;
        currentCoupon = null;
        const els = getEls();
        if (els.couponInput) els.couponInput.value = "";
        if (els.couponMsg) els.couponMsg.classList.add("hidden");
        createOrder(plan);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachBuyEvents);
  } else {
    attachBuyEvents();
  }

  // Sau login quay lại ?buy=plan để tự tạo QR
  try {
    const q = new URLSearchParams(location.search).get("buy");
    if (q && /^(basic|pro|business)$/i.test(q)) {
      setTimeout(() => createOrder(q.toLowerCase()), 400);
    }
  } catch (e) {}
})();
