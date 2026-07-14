# Jarvis-AI

Trợ lý coding qua **Telegram** — hỗ trợ **bán gói (SaaS)** + **white-label**.

Xem cách bán: **[SELL.md](SELL.md)**

## Tính năng thương mại

- Multi-user + gói (trial/basic/pro/business)
- Mã kích hoạt `/activate` + admin `/gencode`
- Quota tin nhắn / ngày
- White-label: tên bot, support, thanh toán
- License key khi bán source (`tools/gen_license.py`)

## Web chat kiểu ChatGPT + GitHub Pages (free)

Thư mục **`docs/`** — 100% tĩnh:

| URL local | Nội dung |
|-----------|----------|
| http://127.0.0.1:8080/ | **Web chat** (sidebar, stream, markdown) |
| http://127.0.0.1:8080/landing.html | Landing + bảng giá |

```powershell
cd C:\Users\Admin\Jarvis-AI\docs
python -m http.server 8080
```

Lần đầu chat: ⚙️ → preset **Groq** → dán key free tại [console.groq.com](https://console.groq.com)  
Key chỉ lưu trình duyệt (localStorage), không commit GitHub.

Deploy free: push repo → **Settings → Pages** → Actions hoặc `/docs`.  
Chi tiết: [docs/README.md](docs/README.md) · [docs/HUONG_DAN_GITHUB_PAGES.md](docs/HUONG_DAN_GITHUB_PAGES.md)

## Core

- Chat AI (Groq free / OpenRouter / xAI / Ollama)
- Multi-user admin + SQLite users/usage
- **Memory hybrid**: RAM + SQLite (`conversation_messages`) — sống qua restart
- **Project notes**: `/project` · `/projects`
- **Agent pipeline**: `/plan` `/code` `/review` `/debug` `/build`
- Plugin scaffold: files / github / docker / …
- Log `logs/jarvis.log`

## Cài đặt (Windows)

```powershell
cd C:\Users\Admin\Jarvis-AI
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Sửa `.env`:

| Biến | Lấy ở đâu |
|------|-----------|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `ALLOWED_TELEGRAM_IDS` | [@userinfobot](https://t.me/userinfobot) |
| `XAI_API_KEY` | [console.x.ai](https://console.x.ai/) |

## Chạy

### Telegram bot

```powershell
python launcher.py
# hoặc
python bot.py
```

Trong Telegram: `@grokapiai_bot` → `/start`.

### Web chat (cùng AI với bot)

```powershell
python -m webapp.server
```

Mở trình duyệt: **http://127.0.0.1:7860**

- Dùng chung `.env` → cùng `AI_PROVIDER` / key / model với Telegram.
- Stream trả lời (SSE), giao diện tối kiểu Grok.
- Tuỳ chọn: `WEB_ACCESS_TOKEN` trong `.env` để khóa web.

### Bật tất cả (bot + pay + web)

```powershell
.\start-services.ps1
# hoặc double-click BAT_DAU_BOT.cmd
```

### CLI / CMD (giống agent terminal)

Chat Jarvis ngay trong Command Prompt / PowerShell — **cùng model + .env + luật owner** với bot Telegram:

```powershell
cd C:\Users\Admin\Jarvis-AI
.\jarvis.cmd
# hoặc
python -m cli
# one-shot
python -m cli --mode coder "viết API FastAPI hello"
```

Trong CLI: `/help` `/mode coder` `/plan` `/code` `/build` `/ls` `/read` `/write` `/exit`  
File chỉ ghi trong thư mục `workspace/` (an toàn).

> CLI **chưa** bằng full Grok Build (không tự edit repo ngoài workspace, không multi-tool agent đầy đủ). Muốn mạnh hơn: model trả phí + sau này mở tool shell sandbox.

### Chạy 24/7 không cần bật máy (VPS)

Xem **[DEPLOY_VPS.md](DEPLOY_VPS.md)** — thuê VPS Ubuntu (~50–120k/tháng) + Docker.

### Lệnh

| Lệnh | Mô tả |
|------|--------|
| `/start` | Chào + menu |
| `/help` | Trợ giúp |
| `/status` | Model, memory RAM/DB, projects |
| `/clear` | Xóa memory (RAM + DB) |
| `/plan <task>` | Planner agent |
| `/code <spec>` | Coder agent |
| `/review <code>` | Reviewer agent |
| `/debug <error>` | Debugger agent |
| `/build <task>` | Pipeline plan→code→review |
| `/projects` | Danh sách project notes |
| `/project new|show|note|del` | Quản lý project |
| `/model` | Model đang dùng |

## Kiến trúc

```
Jarvis-AI/
├── bot.py / launcher.py / config.py
├── ai/          # LLM client + memory + agents (dùng chung bot & web)
├── webapp/      # Web chat UI + FastAPI
├── database/    # SQLAlchemy + SQLite
├── telegram/    # handlers, commands, keyboards
├── plugins/     # github, docker, files, …
├── workspace/   # code workspace
├── logs/        # jarvis.log
└── cache/       # sqlite db
```

## Lộ trình

| Phase | Nội dung | Trạng thái |
|-------|----------|------------|
| 1 | Config + Telegram + Grok chat + auth | ✅ |
| 2 | Memory/DB đầy đủ, project notes | ✅ |
| 3 | Agent pipeline planner→coder→reviewer→debugger | ✅ (text agents; tool-calling phase sau) |
| 4 | Workspace multi-file read/write | 🔜 (plugin files đã có API cơ bản) |
| 5 | Docker sandbox + unit test | 🔜 |
| 6 | Git plugins | 🔜 |
| 7 | Tối ưu + tài liệu | 🔜 |

## Docker (tuỳ chọn)

```bash
docker compose up --build
```

> Máy bạn hiện chưa cài Docker CLI — bot vẫn chạy native bằng Python.

## Bảo mật

- Không commit `.env`
- Chỉ whitelist Telegram ID
- Không chạy lệnh host tùy ý (terminal plugin tắt mặc định)

## License

Private / personal use.
