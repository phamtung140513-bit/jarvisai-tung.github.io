"""
TungDevAI CMD — Giao Diện Terminal Hologram Siêu Đa Sắc (Ultra-Vibrant Multi-Color Edition).
"""

from __future__ import annotations

import argparse
import asyncio
import io
import logging
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# Force UTF-8 console
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

if sys.platform == "win32":
    try:
        os.system("chcp 65001 >nul 2>&1")
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

utf8_stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from rich.console import Console
    from rich.markdown import Markdown
    from rich.panel import Panel
    from rich.theme import Theme
    from rich.text import Text
    from rich.box import ROUNDED, HEAVY, DOUBLE
except ImportError:
    Console = None; Theme = None; Panel = None; Markdown = None  # type: ignore

from ai.coder import CoderAgent
from ai.debugger import DebuggerAgent
from ai.grok import GrokClient, GrokError
from ai.memory import ConversationMemory
from ai.modes import (
    MODES,
    get_user_mode,
    list_modes_text,
    merge_prompt_layers,
    set_user_mode,
)
from ai.pipeline import AgentPipeline
from ai.planner import PlannerAgent
from ai.reviewer import ReviewerAgent
from ai.routing import resolve_cli_strongest_route, ModelRoute, _provider_defaults, _key_for_provider
from config import ensure_directories, get_settings
from database.sqlite import Database, set_db
from plugins.files import FilesPlugin
from product.cmd_keys import (
    activate_cmd_key,
    clear_local_license,
    local_license_status,
    verify_local_against_db,
    verify_remote_cmd_license,
    activate_remote_cmd_key,
)
from product.teachings import format_teachings_for_prompt, owner_teachings

CLI_USER_ID = 0
CLI_PLAN_ID = "owner"

# TrueColor ANSI Palette
C_RESET = "\033[0m"
C_BOLD = "\033[1m"
C_DIM = "\033[2m"

# Neon Cyber Colors
C_CYAN = "\033[38;2;56;189;248m"       # #38bdf8
C_MINT = "\033[38;2;52;211;153m"       # #34d399
C_EMERALD = "\033[38;2;16;185;129m"    # #10b981
C_PURPLE = "\033[38;2;192;132;252m"    # #c084fc
C_AMBER = "\033[38;2;251;191;36m"      # #fbbf24
C_ROSE = "\033[38;2;251;113;133m"      # #fb7185
C_WHITE = "\033[38;2;248;250;252m"     # #f8fafc
C_GRAY = "\033[38;2;148;163;184m"      # #94a3b8
C_BORDER = "\033[38;2;74;222;128m"     # Neon Green #4ade80
C_BOX_GRAY = "\033[38;2;100;116;139m"  # #64748b

custom_theme = Theme({
    "info": "bold cyan",
    "warning": "bold yellow",
    "error": "bold red",
    "success": "bold spring_green3",
    "prompt": "bold cyan",
}) if Theme else None
console = Console(file=utf8_stdout, theme=custom_theme, force_terminal=True, legacy_windows=False, color_system="truecolor") if Console else None

BANNER_ASCII_LINES = [
    r"  ████████╗██╗   ██╗███╗   ██╗ ██████╗ ██████╗ ███████╗██╗   ██╗ █████╗ ██╗",
    r"  ╚══██╔══╝██║   ██║████╗  ██║██╔════╝ ██╔══██╗██╔════╝██║   ██║██╔══██╗██║",
    r"     ██║   ██║   ██║██╔██╗ ██║██║  ███╗██║  ██║█████╗  ██║   ██║███████║██║",
    r"     ██║   ██║   ██║██║╚██╗██║██║   ██║██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══██║██║",
    r"     ██║   ╚██████╔╝██║ ╚████║╚██████╔╝██████╔╝███████╗ ╚████╔╝ ██║  ██║██║",
    r"     ╚═╝    ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝",
]

FLAGSHIP_MODELS = {
    "1": {
        "id": "gemini-3.8",
        "alias": ["1", "3.8", "gemini", "gemini-3.8", "high", "default", "coder"],
        "name": "🧠 Google Gemini 3.8 High (Deep Reasoning ⚡)",
        "provider": "gemini",
        "model": "gemini-3.8-flash",
        "desc": "Siêu cụm Google Gemini 3.8 High độc quyền cho CMD (Deep Reasoning 2026)",
    },
}

def _render_vibrant_banner(cli_route, mode, lic_msg, ws_path) -> None:
    """Render Ultra-Vibrant Multi-Color Banner."""
    if not console:
        for line in BANNER_ASCII_LINES:
            utf8_stdout.write(f"{C_BOLD}{C_MINT}{line}{C_RESET}\n")
        utf8_stdout.flush()
        return

    # Multi-color gradient title
    banner_text = Text()
    grad_styles = ["bold cyan", "bold sky_blue1", "bold spring_green3", "bold spring_green2", "bold spring_green1", "bold green1"]
    for i, line in enumerate(BANNER_ASCII_LINES):
        banner_text.append(line + "\n", style=grad_styles[min(i, len(grad_styles)-1)])

    subtitle = Text("✦ TUNGDEVAI STUDIO · QUANTUM ARCHITECT TERMINAL ✦", style="bold medium_purple1 justify=center")

    # Vibrant Dashboard Content
    body = Text()
    body.append("⚡ Siêu Cụm AI: ", style="bold bright_yellow")
    body.append(f"{cli_route.label} ", style="bold bright_white")
    body.append(f"({cli_route.model})\n", style="bold cyan")
    
    body.append("🛠️  Chế Độ:     ", style="bold bright_yellow")
    body.append(f"{mode.name} ({mode.id})   ·   ", style="bold medium_purple1")
    body.append("Bản Quyền: ", style="bold bright_yellow")
    body.append(f"{lic_msg}\n", style="bold green1")
    
    body.append("📁 Workspace:  ", style="bold bright_yellow")
    body.append(f"{ws_path}", style="italic bright_white")

    panel = Panel(
        Text.assemble(banner_text, "\n", subtitle, "\n\n", body),
        border_style="spring_green3",
        box=ROUNDED,
        subtitle="[bold spring_green2]Gõ câu hỏi trực tiếp hoặc:[/bold spring_green2] [bold cyan]/model[/bold cyan] · [bold cyan]/plan[/bold cyan] · [bold cyan]/code[/bold cyan] · [bold cyan]/review[/bold cyan] · [bold cyan]/debug[/bold cyan] · [bold cyan]/help[/bold cyan] · [bold cyan]/exit[/bold cyan]",
        subtitle_align="center",
        padding=(1, 2),
    )
    console.print(panel)
    console.print()


def _render_input_box_top() -> None:
    """Draw top rounded border for input box with neon glow."""
    w = 80
    if console:
        w = max(60, min(console.width - 2, 100))
    utf8_stdout.write(f"{C_BOX_GRAY}╭{'─' * (w - 2)}╮{C_RESET}\n")
    utf8_stdout.flush()


def _render_input_box_bottom(model_badge: str = "🧠 Google Gemini 3.8 High (Deep Reasoning ⚡) · always-approve") -> None:
    """Draw bottom rounded border with right-aligned model badge in color."""
    w = 80
    if console:
        w = max(60, min(console.width - 2, 100))
    badge_str = f" {model_badge} "
    badge_len = len(badge_str)
    dash_count = max(4, w - 2 - badge_len - 1)
    
    bottom_line = (
        f"{C_BOX_GRAY}╰{'─' * dash_count}"
        f"{C_GRAY}{badge_str}"
        f"{C_BOX_GRAY}╯{C_RESET}\n"
    )
    utf8_stdout.write(bottom_line)
    utf8_stdout.flush()


async def _owner_system_extra(session_factory, settings, user_mode_prompt: str | None) -> str | None:
    try:
        async with session_factory() as session:
            rows = await owner_teachings(session, settings.owner_ids)
            teach = format_teachings_for_prompt(rows)
    except Exception:
        teach = None
    return merge_prompt_layers(mode_prompt=user_mode_prompt, teachings=teach)


async def run_repl(one_shot: str | None = None) -> int:
    settings = get_settings()
    ensure_directories(settings)
    
    logging.getLogger().setLevel(logging.WARNING)
    logging.getLogger("ai.grok").setLevel(logging.WARNING)
    logging.getLogger("ai.memory").setLevel(logging.WARNING)
    logging.getLogger("database.sqlite").setLevel(logging.WARNING)

    db = Database(settings)
    await db.init()
    set_db(db)

    def render_license_warning(reason_msg: str, payment_url: str = "https://tungai.fun/cmd-pricing.html"):
        warn_text = f"""
### ⚠️ BẠN CẦN GIA HẠN THÊM KEY BẢN QUYỀN ĐỂ TIẾP TỤC SỬ DỤNG TUNGDEVAI CMD

- ❌ **Trạng thái:** {reason_msg}
- 👉 **Vui lòng truy cập để gia hạn hoặc mua key mới:** [{payment_url}]({payment_url})
- 💡 **Sau khi có key, kích hoạt ngay tại đây:**
  Gõ lệnh: `/activate <MÃ_KEY>` (Ví dụ: `/activate CMD-XXXX-YYYY`)
"""
        if console:
            console.print(Panel(Markdown(warn_text.strip()), title="[bold red]YÊU CẦU GIA HẠN BẢN QUYỀN CMD[/bold red]", border_style="red", box=ROUNDED))
        else:
            utf8_stdout.write(f"\n{'='*70}\n⚠️ BẠN CẦN GIA HẠN THÊM KEY BẢN QUYỀN ĐỂ TIẾP TỤC SỬ DỤNG\n❌ {reason_msg}\n👉 Trang thanh toán & gia hạn: {payment_url}\n💡 Kích hoạt ngay: Gõ /activate <MÃ_KEY>\n{'='*70}\n\n")
            utf8_stdout.flush()

    licensed = False
    lic_str = "Đang kiểm tra..."

    async def refresh_license() -> dict:
        nonlocal licensed, lic_str
        server_url = getattr(settings, "server_url", "https://tungai.fun")
        st = await asyncio.to_thread(verify_remote_cmd_license, server_url)
        licensed = bool(st.get("ok"))
        if licensed:
            days = st.get("days_left", 30)
            lic_str = f"Executive VIP Pro (Còn {days} ngày)"
        else:
            lic_str = "Hết hạn / Cần gia hạn"
        return st

    lic = await refresh_license()

    grok = GrokClient(settings)
    cli_route = resolve_cli_strongest_route(settings)
    grok.force_single_route(cli_route)

    memory = ConversationMemory(settings)
    files = FilesPlugin(settings.workspace_dir)
    await files.setup()

    planner = PlannerAgent(grok)
    coder = CoderAgent(grok)
    reviewer = ReviewerAgent(grok)
    debugger = DebuggerAgent(grok)
    pipeline = AgentPipeline(grok)

    async with db.session() as session:
        await memory.ensure_hydrated(session, CLI_USER_ID)

    mode = get_user_mode(CLI_USER_ID)

    lic_str = "Executive VIP Pro (Active)" if licensed else "Cần kích hoạt key"

    if not one_shot:
        _render_vibrant_banner(cli_route, mode, lic_str, settings.workspace_dir)
        if not licensed:
            render_license_warning(lic.get("message", "Key bản quyền đã hết hạn hoặc đã bị xóa trên hệ thống!"), lic.get("payment_url", "https://tungai.fun/cmd-pricing.html"))

    async def chat_once(text: str) -> None:
        nonlocal mode, licensed, lic
        lic = await refresh_license()
        if not licensed:
            render_license_warning(lic.get("message", "Key bản quyền đã hết hạn hoặc đã bị xóa trên hệ thống!"), lic.get("payment_url", "https://tungai.fun/cmd-pricing.html"))
            return

        mode = get_user_mode(CLI_USER_ID)
        system = await _owner_system_extra(db.session, settings, mode.prompt or None)
        async with db.session() as session:
            await memory.add_persist(session, CLI_USER_ID, "user", text)
            
        utf8_stdout.write(f"\n{C_GRAY}⚡ TungDevAI đang tư duy thuật toán & thực thi…{C_RESET}\r")
        utf8_stdout.flush()
        
        t0 = time.time()
        full_reply = []
        
        try:
            async for delta in grok.chat_stream(
                memory.get_messages(CLI_USER_ID),
                system=system,
                temperature=mode.temperature,
                plan_id=CLI_PLAN_ID,
            ):
                if not full_reply:
                    utf8_stdout.write(" " * 65 + "\r")
                    utf8_stdout.flush()
                full_reply.append(delta)
                utf8_stdout.write(delta)
                utf8_stdout.flush()
                
            elapsed = time.time() - t0
        except GrokError as exc:
            if console:
                console.print(f"\n[bold red]❌ Lỗi AI:[/bold red] {exc}\n")
            else:
                utf8_stdout.write(f"\n❌ Lỗi AI: {exc}\n")
                utf8_stdout.flush()
            return
            
        final_text = "".join(full_reply)
        async with db.session() as session:
            await memory.add_persist(session, CLI_USER_ID, "assistant", final_text)
            
        utf8_stdout.write(f"\n\n{C_BOX_GRAY}[Hoàn tất trong {elapsed:.2f}s · {grok.active_model}]{C_RESET}\n\n")
        utf8_stdout.flush()

    badge_name = f"{cli_route.label} · always-approve"

    async def handle_slash(line: str) -> bool:
        nonlocal mode, licensed, lic, badge_name, lic_str
        parts = line.strip().split(maxsplit=1)
        cmd = parts[0].lower().lstrip("/")
        arg = parts[1].strip() if len(parts) > 1 else ""

        if cmd == "activate":
            if not arg:
                msg = "\n⚠️ Vui lòng nhập mã key. Cú pháp: /activate <MÃ_KEY>\nVí dụ: /activate CMD-A1B2-C3D4\n"
                if console:
                    console.print(f"[bold yellow]{msg}[/bold yellow]")
                else:
                    utf8_stdout.write(msg)
                    utf8_stdout.flush()
                return False
            server_url = getattr(settings, "server_url", "https://tungai.fun")
            ok, msg, payload = await asyncio.to_thread(activate_remote_cmd_key, arg, server_url)
            if ok:
                await refresh_license()
                success_msg = f"\n🎉 [KÍCH HOẠT THÀNH CÔNG] {msg}\nChào mừng bạn tiếp tục sử dụng TungDevAI CMD!\n"
                if console:
                    console.print(f"[bold spring_green3]{success_msg}[/bold spring_green3]")
                else:
                    utf8_stdout.write(success_msg)
                    utf8_stdout.flush()
            else:
                fail_msg = f"\n❌ [KÍCH HOẠT THẤT BẠI] {msg}\n👉 Mua hoặc gia hạn key mới tại: https://tungai.fun/cmd-pricing.html\n"
                if console:
                    console.print(f"[bold red]{fail_msg}[/bold red]")
                else:
                    utf8_stdout.write(fail_msg)
                    utf8_stdout.flush()
            return False
        parts = line.strip().split(maxsplit=1)
        cmd = parts[0].lower().lstrip("/")
        arg = parts[1].strip() if len(parts) > 1 else ""

        if cmd in {"exit", "quit", "q"}:
            if console:
                console.print("\n[bold spring_green3]⚡ Tạm biệt! Hẹn gặp lại bạn trong phiên làm việc tiếp theo.[/bold spring_green3]\n")
            else:
                utf8_stdout.write("\n⚡ Tạm biệt! Hẹn gặp lại bạn.\n")
                utf8_stdout.flush()
            return True

        if cmd in {"model", "models", "setmodel"}:
            if not arg:
                menu_text = """
### ⚡ HỆ THỐNG MÔ HÌNH TRÍ TUỆ NHÂN TẠO TUNGDEVAI CMD 2026

TungDevAI CMD được **khóa độc quyền** hoạt động trên **Google Gemini 3.8 High (Quantum Deep Reasoning ⚡)** để mang lại năng lực lập trình và suy luận logic sâu sắc nhất:

| Phím | Tên Mô Hình | Động Cơ AI Cốt Lõi | Đặc Tính Nổi Bật |
| :---: | :--- | :--- | :--- |
| **1** | **🧠 Google Gemini 3.8 High** | **Gemini 3.8 Flash Deep Reasoning** | Phản biện đa tầng, giải thuật vi mô $O(1)$ & kiến trúc Enterprise |

👉 **Mặc định:** Toàn bộ lệnh lập trình, `/plan`, `/code`, `/review`, `/debug` đều được xử lý trực tiếp bởi **Gemini 3.8 High**.
"""
                if console:
                    console.print(Panel(Markdown(menu_text), title="[bold green1]HỆ THỐNG MÔ HÌNH TUNGDEVAI[/bold green1]", border_style="spring_green3", box=ROUNDED))
                else:
                    utf8_stdout.write(menu_text + "\n")
                    utf8_stdout.flush()
                return False

            matched = None
            for k, m in FLAGSHIP_MODELS.items():
                if arg.lower() in m["alias"] or arg.lower() == m["id"]:
                    matched = m
                    break

            if matched:
                prov = matched["provider"]
                mid = matched["model"]
                defaults = _provider_defaults(prov)
                key = _key_for_provider(settings, prov)
                new_route = ModelRoute(
                    provider=prov,
                    model=mid,
                    base_url=defaults["base_url"].rstrip("/"),
                    api_key=key,
                    label=matched["name"],
                    tier="pro",
                )
                grok.force_single_route(new_route)
                badge_name = f"{matched['name']} · always-approve"
                if console:
                    console.print(f"\n[bold spring_green3]✅ [THÀNH CÔNG] Đã chuyển sang mô hình: {matched['name']}[/bold spring_green3]\n")
                else:
                    utf8_stdout.write(f"\n✅ [THÀNH CÔNG] Đã chuyển sang mô hình: {matched['name']}\n")
                    utf8_stdout.flush()
            else:
                msg = f"\n⚠️ Không tìm thấy model '{arg}'. Gõ /model để xem danh sách.\n"
                if console:
                    console.print(f"[bold yellow]{msg}[/bold yellow]")
                else:
                    utf8_stdout.write(msg + "\n")
                    utf8_stdout.flush()
            return False

        if cmd in {"help", "h", "?"}:
            help_content = """
| Lệnh | Chức Năng |
| :--- | :--- |
| `/help` | Hiển thị bảng hướng dẫn này |
| `/model` | Danh sách & chọn đổi 4 siêu mô hình AI đỉnh cao |
| `/status` | Kiểm tra trạng thái: Model, Mode, Memory, Workspace |
| `/mode <id>` | Đổi chế độ: `coder` · `security` · `marketing` · `business` · `tutor` · `data` |
| `/plan <task>` | Agent Planner — lập kế hoạch kiến trúc dự án chi tiết |
| `/code <spec>` | Agent Coder — sinh mã nguồn chuẩn production |
| `/review <code>` | Agent Reviewer — đánh giá, tối ưu hiệu năng & bảo mật |
| `/debug <log>` | Agent Debugger — phân tích log lỗi và xuất bản vá (Patch) |
| `/build <task>` | Pipeline tự động hóa: Plan ➔ Code ➔ Review |
| `/ls · /read` | Thao tác trực tiếp với file trong `workspace/` |
| `/clear` | Xóa bộ nhớ ngữ cảnh của phiên hiện tại |
| `/exit` | Thoát chương trình |
"""
            if console:
                console.print(Panel(Markdown(help_content), title="[bold cyan]BẢNG LỆNH ĐIỀU KHIỂN TUNGDEVAI CMD[/bold cyan]", border_style="cyan", box=ROUNDED))
            return False

        if cmd in {"status", "st"}:
            st_content = f"""
- **Siêu Model:** `{badge_name}`
- **Chế Độ:** `{mode.name}` (`{mode.id}`)
- **Bộ Nhớ Ngữ Cảnh:** `{len(memory.get_messages(CLI_USER_ID))}/40` tin nhắn
- **Workspace:** `{settings.workspace_dir}`
- **Bản Quyền:** `{lic_str}`
"""
            if console:
                console.print(Panel(Markdown(st_content), title="[bold cyan]TRẠNG THÁI HỆ THỐNG CMD[/bold cyan]", border_style="cyan", box=ROUNDED))
            return False

        if cmd == "mode":
            if not arg:
                utf8_stdout.write(list_modes_text(mode.id) + "\n")
                utf8_stdout.flush()
                return False
            m = set_user_mode(CLI_USER_ID, arg)
            if m:
                mode = m
                if console:
                    console.print(f"\n[bold green1]✅ Đã chuyển sang chế độ:[/bold green1] [bold cyan]{m.name}[/bold cyan] ({m.id})\n[dim]{m.description}[/dim]\n")
            else:
                utf8_stdout.write(f"Mode không hợp lệ. Chọn: {', '.join(MODES.keys())}\n")
                utf8_stdout.flush()
            return False

        if cmd == "clear":
            async with db.session() as session:
                await memory.clear(session, CLI_USER_ID)
            if console:
                console.print("\n[bold green1]🧹 Đã dọn sạch bộ nhớ ngữ cảnh phiên làm việc.[/bold green1]\n")
            return False

        if cmd == "pwd":
            utf8_stdout.write(f"Workspace: {settings.workspace_dir}\n")
            utf8_stdout.flush()
            return False

        if cmd == "ls":
            out = await files.execute("list", {"path": arg or "."})
            if console:
                console.print(Panel(str(out), title=f"[cyan]Danh sách file ({arg or '.'})[/cyan]", border_style="cyan", box=ROUNDED))
            return False

        if cmd == "read":
            if not arg:
                utf8_stdout.write("Dùng: /read <đường_dẫn_file>\n")
                utf8_stdout.flush()
                return False
            out = await files.execute("read", {"path": arg})
            if console:
                console.print(Panel(Markdown(f"```\n{out}\n```"), title=f"[cyan]Nội dung file ({arg})[/cyan]", border_style="cyan", box=ROUNDED))
            return False

        if cmd == "plan":
            if not arg:
                utf8_stdout.write("Dùng: /plan <mục tiêu dự án>\n")
                utf8_stdout.flush()
                return False
            utf8_stdout.write(f"\n{C_GRAY}🧠 Agent Planner đang lập kế hoạch kiến trúc…{C_RESET}\n\n")
            utf8_stdout.flush()
            out = await planner.plan(arg, plan_id=CLI_PLAN_ID)
            if console:
                console.print(Markdown(out))
            return False

        if cmd == "code":
            if not arg:
                utf8_stdout.write("Dùng: /code <yêu cầu mã nguồn>\n")
                utf8_stdout.flush()
                return False
            utf8_stdout.write(f"\n{C_GRAY}⚡ Agent Coder đang viết mã nguồn tối ưu…{C_RESET}\n\n")
            utf8_stdout.flush()
            out = await coder.code(arg, plan_id=CLI_PLAN_ID)
            if console:
                console.print(Markdown(out))
            return False

        if cmd == "review":
            if not arg:
                utf8_stdout.write("Dùng: /review <đoạn mã nguồn>\n")
                utf8_stdout.flush()
                return False
            utf8_stdout.write(f"\n{C_GRAY}🔎 Agent Reviewer đang phân tích & quét bảo mật…{C_RESET}\n\n")
            utf8_stdout.flush()
            out = await reviewer.review(arg, plan_id=CLI_PLAN_ID)
            if console:
                console.print(Markdown(out))
            return False

        if cmd == "debug":
            if not arg:
                utf8_stdout.write("Dùng: /debug <log lỗi hoặc traceback>\n")
                utf8_stdout.flush()
                return False
            utf8_stdout.write(f"\n{C_GRAY}🛠️ Agent Debugger đang truy vết nguyên nhân gốc rễ…{C_RESET}\n\n")
            utf8_stdout.flush()
            out = await debugger.debug(arg, plan_id=CLI_PLAN_ID)
            if console:
                console.print(Markdown(out))
            return False

        if cmd == "build":
            if not arg:
                utf8_stdout.write("Dùng: /build <mục tiêu tổng thể>\n")
                utf8_stdout.flush()
                return False
            utf8_stdout.write(f"\n{C_GRAY}🚀 Bắt đầu chu trình tự động hóa Pipeline: Plan ➔ Code ➔ Review…{C_RESET}\n\n")
            utf8_stdout.flush()
            res = await pipeline.run(arg, do_plan=True, do_code=True, do_review=True, plan_id=CLI_PLAN_ID)
            if console:
                console.print(Markdown(res.format_web()))
            return False

        return False

    if one_shot:
        lic = await refresh_license()
        if one_shot.startswith("/"):
            await handle_slash(one_shot)
        elif not licensed:
            render_license_warning(lic.get("message", "Key bản quyền đã hết hạn hoặc đã bị xóa trên hệ thống!"), lic.get("payment_url", "https://tungai.fun/cmd-pricing.html"))
            return 1
        else:
            await chat_once(one_shot)
        return 0

    while True:
        try:
            # Render Top Box Border
            _render_input_box_top()
            
            # Draw boxed prompt line
            prompt_prefix = f"{C_BOX_GRAY}│{C_RESET} {C_WHITE}>{C_RESET} "
            
            try:
                utf8_stdout.write(prompt_prefix)
                utf8_stdout.flush()
                line = await asyncio.to_thread(input)
            except (KeyboardInterrupt, asyncio.CancelledError):
                _render_input_box_bottom(badge_name)
                utf8_stdout.write("\n(Nhấn /exit để thoát)\n")
                utf8_stdout.flush()
                continue
            except EOFError:
                _render_input_box_bottom(badge_name)
                break

            # Render Bottom Box Border with Model Badge
            _render_input_box_bottom(badge_name)

            line = (line or "").strip()
            if not line:
                continue
            if line.startswith("/"):
                stop = await handle_slash(line)
                if stop:
                    break
                continue

            # Verify license before answering
            lic = await refresh_license()
            if not licensed:
                render_license_warning(lic.get("message", "Key bản quyền đã hết hạn hoặc đã bị xóa trên hệ thống!"), lic.get("payment_url", "https://tungai.fun/cmd-pricing.html"))
                continue

            await chat_once(line)
        except Exception as exc:
            if console:
                console.print(f"[bold red]Lỗi:[/bold red] {exc}")
            else:
                utf8_stdout.write(f"Lỗi: {exc}\n")
                utf8_stdout.flush()

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="TungDevAI CMD — Ultra-Vibrant Multi-Color Terminal")
    parser.add_argument("prompt", nargs="*", help="Câu hỏi hoặc lệnh trực tiếp")
    args = parser.parse_args()
    one_shot = " ".join(args.prompt).strip() or None
    raise SystemExit(asyncio.run(run_repl(one_shot)))


if __name__ == "__main__":
    main()
