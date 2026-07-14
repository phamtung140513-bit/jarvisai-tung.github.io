/**
 * Jarvis Chat (GitHub Pages) — users chat only.
 * Admin tab locked by WEB_ADMIN_KEY (server). No public API settings.
 */
(() => {
  const LS_API = "jarvis_api_base_v2";
  const LS_USER_TOKEN = "jarvis_user_token_v2";
  const LS_ADMIN_TOKEN = "jarvis_admin_token_v2";
  const LS_CHATS = "jarvis_pages_chats_v2";
  const MAX_IMAGES = 4;
  const MAX_EDGE = 1280;
  const JPEG_Q = 0.82;

  const $ = (id) => document.getElementById(id);
  const els = {
    sidebar: $("sidebar"),
    backdrop: $("backdrop"),
    history: $("history"),
    messages: $("messages"),
    welcome: $("welcome"),
    form: $("form"),
    input: $("input"),
    send: $("btnSend"),
    btnNew: $("btnNew"),
    btnAdmin: $("btnAdmin"),
    btnAdminTop: $("btnAdminTop"),
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
    adminLoginModal: $("adminLoginModal"),
    adminKeyInput: $("adminKeyInput"),
    btnAdminLogin: $("btnAdminLogin"),
    adminLoginOut: $("adminLoginOut"),
    adminPanelModal: $("adminPanelModal"),
    adminApiBase: $("adminApiBase"),
    adminUserToken: $("adminUserToken"),
    adminStatusBox: $("adminStatusBox"),
    btnAdminSave: $("btnAdminSave"),
    btnAdminTest: $("btnAdminTest"),
    btnAdminLogout: $("btnAdminLogout"),
    adminPanelOut: $("adminPanelOut"),
  };

  let cfgPublic = { apiBase: "", telegramBot: "https://t.me/grokapiai_bot" };
  let pendingImages = [];
  let chats = [];
  let activeId = null;
  let busy = false;
  let sessionId = localStorage.getItem("jarvis_sid_v2") || "";

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

  function adminToken() {
    return (localStorage.getItem(LS_ADMIN_TOKEN) || "").trim();
  }

  function isAdmin() {
    return Boolean(adminToken());
  }

  function userHeaders(extra) {
    const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    const t = userToken();
    if (t) h["X-Web-Token"] = t;
    return h;
  }

  function adminHeaders() {
    const h = { "Content-Type": "application/json" };
    const t = adminToken();
    if (t) h["X-Admin-Token"] = t;
    return h;
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

  function loadChats() {
    try {
      chats = JSON.parse(localStorage.getItem(LS_CHATS) || "[]");
    } catch {
      chats = [];
    }
    if (!Array.isArray(chats)) chats = [];
  }

  function persistChats() {
    try {
      localStorage.setItem(LS_CHATS, JSON.stringify(chats));
    } catch {
      /* quota */
    }
  }

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
      els.modelChip.textContent = (j.model || "server") + (isAdmin() ? " | admin" : "");
      setStatus(true);
      return j;
    } catch (e) {
      els.modelChip.textContent = "server offline";
      setStatus(false);
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
      row.querySelector(".title").textContent = c.title || "Chat moi";
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

  function formatMarkdown(text) {
    if (!text) return "";
    let s = escapeHtml(text);
    s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      return (
        '<pre><code class="lang-' +
        (lang || "txt") +
        '">' +
        code.replace(/\n$/, "") +
        "</code></pre>"
      );
    });
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|\n)[*-] (.+)/g, "$1• $2");
    return s
      .split(/\n{2,}/)
      .map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>")
      .join("");
  }

  function renderMessages() {
    const chat = activeChat();
    els.messages.innerHTML = "";
    if (!chat || !chat.messages.length) {
      els.messages.appendChild(els.welcome);
      els.welcome.style.display = "";
      bindSuggestions();
      els.chatTitle.textContent = "Jarvis";
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
    av.textContent = role === "user" ? "U" : "J";
    const body = document.createElement("div");
    body.className = "body";
    const roleEl = document.createElement("div");
    roleEl.className = "role";
    roleEl.textContent = role === "user" ? "Ban" : "Jarvis";
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
    if (role === "assistant") contentEl.innerHTML = formatMarkdown(content || "");
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
    const c = { id: uid(), title: "Chat moi", messages: [], updated: Date.now() };
    chats.unshift(c);
    activeId = c.id;
    sessionId = "";
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

  /** Chat via backend — API keys stay on server */
  async function sendMessage(text) {
    text = (text || "").trim();
    const images = pendingImages.slice();
    if ((!text && !images.length) || busy) return;

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
    if (chat.title === "Chat moi") {
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
        throw new Error("Server " + res.status + ": " + errText.slice(0, 200));
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
                localStorage.setItem("jarvis_sid_v2", sessionId);
              }
              if (j.type === "delta" && j.text) {
                full += j.text;
                contentEl.innerHTML = formatMarkdown(full);
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
          localStorage.setItem("jarvis_sid_v2", sessionId);
        }
      }

      contentEl.parentElement.parentElement.classList.remove("typing");
      if (!full) throw new Error("Server tra ve rong. Kiem tra webapp dang chay?");
      contentEl.innerHTML = formatMarkdown(full);
      chat.messages.push({ role: "assistant", content: full });
      chat.updated = Date.now();
      persistChats();
      renderHistory();
      setStatus(true);
    } catch (err) {
      contentEl.parentElement.parentElement.classList.remove("typing");
      contentEl.innerHTML = formatMarkdown(
        "**Loi ket noi server**\n\n" +
          String(err.message || err) +
          "\n\nAdmin can:\n" +
          "1. Chay `python -m webapp.server` (port 7860)\n" +
          "2. Dat `WEB_ADMIN_KEY` trong `.env`\n" +
          "3. Bam **Admin** de dang nhap + set Backend URL\n" +
          "4. User khong can API key"
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

  function openAdmin() {
    if (isAdmin()) {
      openAdminPanel();
    } else {
      els.adminLoginOut.hidden = true;
      els.adminKeyInput.value = "";
      els.adminLoginModal.showModal();
    }
  }

  function openAdminPanel() {
    els.adminApiBase.value = apiBase();
    els.adminUserToken.value = userToken();
    els.adminPanelOut.hidden = true;
    els.adminStatusBox.textContent = "Dang load...";
    els.adminPanelModal.showModal();
    refreshAdminStatus();
  }

  async function refreshAdminStatus() {
    try {
      const r = await fetch(apiBase() + "/api/admin/status", {
        headers: adminHeaders(),
        cache: "no-store",
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      els.adminStatusBox.textContent =
        "OK | provider=" +
        j.provider +
        " | model=" +
        j.model +
        " | user_auth=" +
        j.user_auth_required;
      setStatus(true);
    } catch (e) {
      els.adminStatusBox.textContent = "Loi: " + (e.message || e);
    }
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

  els.btnNew.addEventListener("click", newChat);
  els.btnAdmin.addEventListener("click", openAdmin);
  els.btnAdminTop.addEventListener("click", openAdmin);
  if (els.btnOpenSidebar) els.btnOpenSidebar.addEventListener("click", openSidebar);
  if (els.btnCloseSidebar) els.btnCloseSidebar.addEventListener("click", closeSidebar);
  if (els.backdrop) els.backdrop.addEventListener("click", closeSidebar);

  els.btnAdminLogin.addEventListener("click", async () => {
    const key = (els.adminKeyInput.value || "").trim();
    els.adminLoginOut.hidden = false;
    els.adminLoginOut.className = "test-out";
    els.adminLoginOut.textContent = "Dang kiem tra...";
    try {
      // Ensure api base from input if already known
      const base = apiBase();
      const r = await fetch(base + "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || "Sai key / server loi");
      }
      const j = await r.json();
      localStorage.setItem(LS_ADMIN_TOKEN, j.admin_token || key);
      els.adminLoginOut.className = "test-out ok";
      els.adminLoginOut.textContent = "OK admin";
      els.adminLoginModal.close();
      openAdminPanel();
      pingServer();
    } catch (e) {
      els.adminLoginOut.className = "test-out err";
      els.adminLoginOut.textContent =
        String(e.message || e) +
        " | Dam bao webapp dang chay + WEB_ADMIN_KEY dung + Backend URL dung.";
    }
  });

  els.btnAdminSave.addEventListener("click", () => {
    const base = (els.adminApiBase.value || "").trim().replace(/\/$/, "");
    if (base) localStorage.setItem(LS_API, base);
    const ut = (els.adminUserToken.value || "").trim();
    if (ut) localStorage.setItem(LS_USER_TOKEN, ut);
    else localStorage.removeItem(LS_USER_TOKEN);
    els.adminPanelOut.hidden = false;
    els.adminPanelOut.className = "test-out ok";
    els.adminPanelOut.textContent = "Da luu cau hinh admin (chi may nay).";
    pingServer();
  });

  els.btnAdminTest.addEventListener("click", async () => {
    els.adminPanelOut.hidden = false;
    els.adminPanelOut.className = "test-out";
    els.adminPanelOut.textContent = "Testing...";
    const h = await pingServer();
    if (h) {
      els.adminPanelOut.className = "test-out ok";
      els.adminPanelOut.textContent = "Health OK: " + (h.model || "");
      refreshAdminStatus();
    } else {
      els.adminPanelOut.className = "test-out err";
      els.adminPanelOut.textContent = "Khong ket noi duoc " + apiBase();
    }
  });

  els.btnAdminLogout.addEventListener("click", () => {
    localStorage.removeItem(LS_ADMIN_TOKEN);
    els.adminPanelModal.close();
    pingServer();
  });

  // Boot
  (async function boot() {
    await loadPublicConfig();
    loadChats();
    activeId = chats[0] ? chats[0].id : null;
    renderHistory();
    renderMessages();
    bindSuggestions();
    await pingServer();
  })();
})();
