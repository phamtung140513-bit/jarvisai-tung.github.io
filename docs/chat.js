/**
 * Jarvis Chat — static ChatGPT-style UI for GitHub Pages.
 * Supports text + images (OpenAI-compatible vision models).
 */
(() => {
  const STORAGE_CFG = "jarvis_pages_cfg_v1";
  const STORAGE_CHATS = "jarvis_pages_chats_v1";
  const MAX_IMAGES = 4;
  const MAX_EDGE = 1280;
  const JPEG_Q = 0.82;

  const PRESETS = {
    groq: {
      base: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      label: "Groq",
    },
    "groq-vision": {
      base: "https://api.groq.com/openai/v1",
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      label: "Groq Vision",
    },
    openrouter: {
      base: "https://openrouter.ai/api/v1",
      model: "openrouter/auto",
      label: "OpenRouter",
    },
    xai: {
      base: "https://api.x.ai/v1",
      model: "grok-3-mini",
      label: "xAI",
    },
    custom: {
      base: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      label: "Custom",
    },
  };

  const DEFAULT_SYSTEM = `Bạn là Jarvis — trợ lý AI thông minh (web tĩnh + Telegram bot cùng thương hiệu).
Trả lời tiếng Việt khi user dùng tiếng Việt. Rõ ràng, có cấu trúc, code block khi cần.
Khi user gửi ảnh: mô tả / phân tích / trả lời câu hỏi về ảnh một cách hữu ích.
Không bịa API; nếu không chắc hãy nói rõ.`;

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
    btnSettings: $("btnSettings"),
    btnTopSettings: $("btnTopSettings"),
    btnOpenSidebar: $("btnOpenSidebar"),
    btnCloseSidebar: $("btnCloseSidebar"),
    btnPlus: $("btnPlus"),
    plusMenu: $("plusMenu"),
    menuPickImage: $("menuPickImage"),
    fileImage: $("fileImage"),
    attachPreview: $("attachPreview"),
    modelChip: $("modelChip"),
    chatTitle: $("chatTitle"),
    statusDot: $("statusDot"),
    modal: $("settingsModal"),
    cfgPreset: $("cfgPreset"),
    cfgBase: $("cfgBase"),
    cfgKey: $("cfgKey"),
    cfgModel: $("cfgModel"),
    cfgSystem: $("cfgSystem"),
    cfgStream: $("cfgStream"),
    btnSave: $("btnSaveSettings"),
    btnTest: $("btnTest"),
    testOut: $("testOut"),
  };

  /** Pending images as data URLs */
  let pendingImages = [];
  /** @type {{id:string,title:string,messages:any[],updated:number}[]} */
  let chats = [];
  /** @type {string|null} */
  let activeId = null;
  let busy = false;

  function loadCfg() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_CFG) || "{}");
    } catch {
      return {};
    }
  }

  function saveCfg(cfg) {
    localStorage.setItem(STORAGE_CFG, JSON.stringify(cfg));
    refreshModelChip();
  }

  function getCfg() {
    const c = loadCfg();
    const preset = c.preset || "groq";
    const def = PRESETS[preset] || PRESETS.groq;
    return {
      preset,
      base: (c.base || def.base).replace(/\/$/, ""),
      key: c.key || "",
      model: c.model || def.model,
      system: c.system || DEFAULT_SYSTEM,
      stream: c.stream !== false,
    };
  }

  function loadChats() {
    try {
      chats = JSON.parse(localStorage.getItem(STORAGE_CHATS) || "[]");
    } catch {
      chats = [];
    }
    if (!Array.isArray(chats)) chats = [];
  }

  function persistChats() {
    // Cap total storage: strip old images from very old chats if needed
    try {
      localStorage.setItem(STORAGE_CHATS, JSON.stringify(chats));
    } catch {
      // Quota exceeded — drop images from oldest messages
      for (const c of [...chats].sort((a, b) => a.updated - b.updated)) {
        for (const m of c.messages) {
          if (m.images && m.images.length) m.images = [];
        }
        try {
          localStorage.setItem(STORAGE_CHATS, JSON.stringify(chats));
          break;
        } catch {
          /* continue */
        }
      }
    }
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function refreshModelChip() {
    const c = getCfg();
    els.modelChip.textContent = c.key ? `${c.model}` : "chưa có API key";
    els.statusDot.classList.toggle("ok", Boolean(c.key));
    els.statusDot.classList.toggle("err", !c.key);
  }

  function activeChat() {
    return chats.find((c) => c.id === activeId) || null;
  }

  function renderHistory() {
    els.history.innerHTML = "";
    const sorted = [...chats].sort((a, b) => b.updated - a.updated);
    for (const c of sorted) {
      const row = document.createElement("div");
      row.className = "hist-item" + (c.id === activeId ? " active" : "");
      row.innerHTML = `<span class="title"></span><button type="button" class="del" title="Xóa">✕</button>`;
      row.querySelector(".title").textContent = c.title || "Chat mới";
      row.addEventListener("click", (e) => {
        if (e.target.closest(".del")) return;
        selectChat(c.id);
      });
      row.querySelector(".del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(c.id);
      });
      els.history.appendChild(row);
    }
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
      return `<pre><code class="lang-${lang || "txt"}">${code.replace(/\n$/, "")}</code></pre>`;
    });
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|\n)[*-] (.+)/g, "$1• $2");
    s = s
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
      .join("");
    return s;
  }

  function renderMessages() {
    const chat = activeChat();
    els.messages.innerHTML = "";
    if (!chat || chat.messages.length === 0) {
      els.messages.appendChild(els.welcome);
      els.welcome.style.display = "";
      bindSuggestions();
      els.chatTitle.textContent = "Jarvis";
      return;
    }
    els.chatTitle.textContent = chat.title || "Chat";
    for (const m of chat.messages) {
      appendMsg(m.role, m.content, m.images || [], false);
    }
    scrollBottom();
  }

  function appendMsg(role, content, images = [], scroll = true) {
    if (els.welcome && els.welcome.parentElement) {
      els.welcome.remove();
    }
    const row = document.createElement("div");
    row.className = `msg ${role}`;
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = role === "user" ? "U" : "J";
    const body = document.createElement("div");
    body.className = "body";
    const roleEl = document.createElement("div");
    roleEl.className = "role";
    roleEl.textContent = role === "user" ? "Bạn" : "Jarvis";
    body.appendChild(roleEl);

    if (images && images.length) {
      const wrap = document.createElement("div");
      wrap.className = "msg-images";
      for (const src of images) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Ảnh đính kèm";
        img.addEventListener("click", () => window.open(src, "_blank"));
        wrap.appendChild(img);
      }
      body.appendChild(wrap);
    }

    const contentEl = document.createElement("div");
    contentEl.className = "content";
    if (role === "assistant") contentEl.innerHTML = formatMarkdown(content || "");
    else contentEl.textContent = content || (images?.length ? "" : "");
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
    const c = {
      id: uid(),
      title: "Chat mới",
      messages: [],
      updated: Date.now(),
    };
    chats.unshift(c);
    activeId = c.id;
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
    if (activeId === id) activeId = chats[0]?.id || null;
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

  function closePlusMenu() {
    if (!els.plusMenu) return;
    els.plusMenu.hidden = true;
    els.btnPlus?.classList.remove("open");
    els.btnPlus?.setAttribute("aria-expanded", "false");
  }

  function togglePlusMenu() {
    if (!els.plusMenu) return;
    const open = els.plusMenu.hidden;
    els.plusMenu.hidden = !open;
    els.btnPlus?.classList.toggle("open", open);
    els.btnPlus?.setAttribute("aria-expanded", open ? "true" : "false");
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
      chip.innerHTML = `<img alt="preview" /><button type="button" class="rm" title="Gỡ">✕</button>`;
      chip.querySelector("img").src = src;
      chip.querySelector(".rm").addEventListener("click", () => {
        pendingImages.splice(i, 1);
        renderAttachPreview();
      });
      els.attachPreview.appendChild(chip);
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Không đọc được file ảnh"));
      reader.readAsDataURL(file);
    });
  }

  function compressImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const max = MAX_EDGE;
        if (width > max || height > max) {
          const r = Math.min(max / width, max / height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_Q));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/"));
    for (const f of files) {
      if (pendingImages.length >= MAX_IMAGES) break;
      try {
        let data = await fileToDataUrl(f);
        data = await compressImage(data);
        pendingImages.push(data);
      } catch (e) {
        console.warn(e);
      }
    }
    renderAttachPreview();
  }

  function openSettings() {
    const c = getCfg();
    els.cfgPreset.value = c.preset in PRESETS ? c.preset : "custom";
    els.cfgBase.value = c.base;
    els.cfgKey.value = c.key;
    els.cfgModel.value = c.model;
    els.cfgSystem.value = c.system;
    els.cfgStream.checked = c.stream;
    els.testOut.hidden = true;
    els.modal.showModal();
  }

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p || name === "custom") return;
    els.cfgBase.value = p.base;
    els.cfgModel.value = p.model;
  }

  /** Convert stored messages → API payload (multimodal when images). */
  function toApiMessages(messages) {
    return messages.map((m) => {
      if (m.role === "assistant") {
        return { role: "assistant", content: m.content || "" };
      }
      const imgs = m.images || [];
      if (!imgs.length) {
        return { role: "user", content: m.content || "" };
      }
      const parts = [];
      const text = (m.content || "").trim() || "Hãy xem ảnh và phân tích / trả lời.";
      parts.push({ type: "text", text });
      for (const url of imgs) {
        parts.push({
          type: "image_url",
          image_url: { url },
        });
      }
      return { role: "user", content: parts };
    });
  }

  async function chatCompletion(messages, { stream }) {
    const cfg = getCfg();
    if (!cfg.key) {
      throw new Error("Chưa có API key. Mở Cài đặt (⚙️) và dán key Groq/OpenRouter.");
    }
    const url = `${cfg.base}/chat/completions`;
    const body = {
      model: cfg.model,
      messages: [{ role: "system", content: cfg.system }, ...messages],
      temperature: 0.7,
      stream: Boolean(stream),
    };
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
    };
    if (cfg.base.includes("openrouter")) {
      headers["HTTP-Referer"] = location.origin;
      headers["X-Title"] = "Jarvis AI Pages";
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API ${res.status}: ${t.slice(0, 320)}`);
    }
    return res;
  }

  async function readStream(res, onDelta) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const data = s.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(full);
          }
        } catch {
          /* ignore */
        }
      }
    }
    return full;
  }

  async function sendMessage(text) {
    text = (text || "").trim();
    const images = [...pendingImages];
    if ((!text && !images.length) || busy) return;

    const cfg = getCfg();
    if (!cfg.key) {
      openSettings();
      els.testOut.hidden = false;
      els.testOut.className = "test-out err";
      els.testOut.textContent = "Cần API key trước khi chat.";
      return;
    }

    // Hint if image + non-vision model
    if (images.length && /llama-3\.3-70b|versatile|deepseek-chat/i.test(cfg.model)) {
      const ok = confirm(
        "Model hiện tại có thể không hỗ trợ ảnh.\n\n" +
          "Nên chọn preset «Groq vision» trong ⚙️ (model llama-4-scout).\n\n" +
          "Vẫn gửi tiếp?"
      );
      if (!ok) {
        openSettings();
        return;
      }
    }

    const chat = ensureChat();
    const userMsg = { role: "user", content: text, images };
    chat.messages.push(userMsg);
    if (chat.title === "Chat mới") {
      const t = text || "Ảnh đính kèm";
      chat.title = t.slice(0, 40) + (t.length > 40 ? "…" : "");
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
      const apiMessages = toApiMessages(chat.messages);

      if (cfg.stream) {
        const res = await chatCompletion(apiMessages, { stream: true });
        const full = await readStream(res, (partial) => {
          contentEl.innerHTML = formatMarkdown(partial);
          scrollBottom();
        });
        contentEl.parentElement.parentElement.classList.remove("typing");
        if (!full) throw new Error("API trả về rỗng (CORS / model / vision).");
        contentEl.innerHTML = formatMarkdown(full);
        chat.messages.push({ role: "assistant", content: full });
      } else {
        const res = await chatCompletion(apiMessages, { stream: false });
        const data = await res.json();
        const full = data.choices?.[0]?.message?.content?.trim() || "";
        contentEl.parentElement.parentElement.classList.remove("typing");
        if (!full) throw new Error("API trả về rỗng.");
        contentEl.innerHTML = formatMarkdown(full);
        chat.messages.push({ role: "assistant", content: full });
      }
      chat.updated = Date.now();
      persistChats();
      renderHistory();
      els.statusDot.classList.add("ok");
      els.statusDot.classList.remove("err");
    } catch (err) {
      contentEl.parentElement.parentElement.classList.remove("typing");
      const msg = err?.message || String(err);
      contentEl.innerHTML = formatMarkdown(
        `❌ **Lỗi:** ${msg}\n\n` +
          `Gợi ý khi gửi **ảnh**:\n` +
          `- ⚙️ Preset **Groq vision**\n` +
          `- Model: \`meta-llama/llama-4-scout-17b-16e-instruct\`\n` +
          `- Ảnh ≤ 4 tấm, tự nén JPEG\n` +
          `- Key Groq free: https://console.groq.com`
      );
      els.statusDot.classList.add("err");
      els.statusDot.classList.remove("ok");
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
    const ta = els.input;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
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

  // Paste image from clipboard
  els.input.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });

  // Drag & drop on composer
  els.form.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.form.classList.add("drag");
  });
  els.form.addEventListener("dragleave", () => els.form.classList.remove("drag"));
  els.form.addEventListener("drop", (e) => {
    e.preventDefault();
    els.form.classList.remove("drag");
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  // + menu: open options (image from device, …)
  els.btnPlus?.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlusMenu();
  });
  els.menuPickImage?.addEventListener("click", () => {
    closePlusMenu();
    els.fileImage?.click();
  });
  els.fileImage?.addEventListener("change", () => {
    if (els.fileImage.files?.length) addFiles(els.fileImage.files);
    els.fileImage.value = "";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("#plusWrap")) closePlusMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePlusMenu();
  });

  els.btnNew.addEventListener("click", newChat);
  els.btnSettings.addEventListener("click", openSettings);
  els.btnTopSettings.addEventListener("click", openSettings);
  els.btnOpenSidebar?.addEventListener("click", openSidebar);
  els.btnCloseSidebar?.addEventListener("click", closeSidebar);
  els.backdrop?.addEventListener("click", closeSidebar);

  els.cfgPreset.addEventListener("change", () => applyPreset(els.cfgPreset.value));

  els.btnSave.addEventListener("click", () => {
    saveCfg({
      preset: els.cfgPreset.value,
      base: els.cfgBase.value.trim().replace(/\/$/, ""),
      key: els.cfgKey.value.trim(),
      model: els.cfgModel.value.trim(),
      system: els.cfgSystem.value.trim() || DEFAULT_SYSTEM,
      stream: els.cfgStream.checked,
    });
    els.testOut.hidden = false;
    els.testOut.className = "test-out ok";
    els.testOut.textContent = "Đã lưu trên trình duyệt này.";
    setTimeout(() => els.modal.close(), 400);
  });

  els.btnTest.addEventListener("click", async () => {
    saveCfg({
      preset: els.cfgPreset.value,
      base: els.cfgBase.value.trim().replace(/\/$/, ""),
      key: els.cfgKey.value.trim(),
      model: els.cfgModel.value.trim(),
      system: els.cfgSystem.value.trim() || DEFAULT_SYSTEM,
      stream: false,
    });
    els.testOut.hidden = false;
    els.testOut.className = "test-out";
    els.testOut.textContent = "Đang test…";
    try {
      const res = await chatCompletion(
        [{ role: "user", content: "Trả lời đúng 1 từ: OK" }],
        { stream: false }
      );
      const data = await res.json();
      const t = data.choices?.[0]?.message?.content || "";
      els.testOut.className = "test-out ok";
      els.testOut.textContent = `OK — ${t.slice(0, 80)}`;
    } catch (err) {
      els.testOut.className = "test-out err";
      els.testOut.textContent = err.message || String(err);
    }
  });

  // Boot
  loadChats();
  activeId = chats[0]?.id || null;
  refreshModelChip();
  renderHistory();
  renderMessages();
  bindSuggestions();

  if (!getCfg().key && !localStorage.getItem("jarvis_pages_seen_settings")) {
    localStorage.setItem("jarvis_pages_seen_settings", "1");
    setTimeout(openSettings, 400);
  }
})();
