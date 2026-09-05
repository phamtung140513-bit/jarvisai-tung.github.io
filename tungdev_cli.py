"""TungDevAI CMD 2026 - Powered Exclusively by Google Gemini 3.8 High."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Force UTF-8 environment and console
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

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import get_settings
from ai.grok import GrokClient
from ai.prompts import build_system_prompt
from ai.modes import get_mode
from ai.routing import ModelRoute, _provider_defaults, _key_for_provider
from product.cmd_keys import verify_remote_cmd_license, activate_remote_cmd_key

def safe_write(text: str) -> None:
    """Safely print text/tokens to console with zero UnicodeEncodeError risk."""
    try:
        sys.stdout.write(text)
        sys.stdout.flush()
    except Exception:
        try:
            sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
            sys.stdout.buffer.flush()
        except Exception:
            pass

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

BANNER = """
  +=======================================================================+
  |    [TUNGDEVAI CMD 2026] -- EXCLUSIVELY GEMINI 3.8 HIGH REASONING       |
  |   AI Software Architect & Full-Stack Engineer * Powered by Gemini    |
  |   Commands: /model * /code * /plan * /review * /debug * /clear * /exit|
  +=======================================================================+
"""

def print_model_menu(current_key: str) -> None:
    menu = "\n  +=======================================================================+\n"
    menu += "  |             👑 DANH SÁCH MÔ HÌNH ĐỈNH CAO TUNGDEVAI                   |\n"
    menu += "  +=======================================================================+\n"
    for k, m in FLAGSHIP_MODELS.items():
        active_mark = " [* ĐANG DÙNG]" if k == current_key else ""
        menu += f"   [{k}] {m['name']}{active_mark}\n"
        menu += f"       -> {m['desc']}\n"
    menu += "  +-----------------------------------------------------------------------+\n"
    menu += "   💡 Chọn model: Gõ /model 1 | /model 2 | /model 3 | /model 4\n"
    menu += "  +=======================================================================+\n\n"
    safe_write(menu)

def build_client_for_model(settings, model_info):
    prov = model_info["provider"]
    mid = model_info["model"]
    defaults = _provider_defaults(prov)
    key = _key_for_provider(settings, prov)
    route = ModelRoute(
        provider=prov,
        model=mid,
        base_url=defaults["base_url"].rstrip("/"),
        api_key=key,
        label=model_info["name"],
        tier="pro",
    )
    client = GrokClient(settings)
    client._forced_route = route
    return client

async def main_cli() -> None:
    safe_write(BANNER + "\n")
    try:
        settings = get_settings()
    except Exception as e:
        safe_write(f"[X] Loi khoi dong cau hinh: {e}\n")
        return

    current_model_key = "1"
    current_model_info = FLAGSHIP_MODELS[current_model_key]
    client = build_client_for_model(settings, current_model_info)

    safe_write(f"  [Engine]: {current_model_info['name']}\n")
    safe_write("  [Mode  ]: Coder Pro (Active)\n\n")

    def print_license_warning(reason_msg: str):
        safe_write(f"\n{'='*70}\n")
        safe_write("  [!] BAN CAN GIA HAN THEM KEY BAN QUYEN DE TIEP TUC SU DUNG TUNGDEVAI CMD\n")
        safe_write(f"  [X] Trang thai: {reason_msg}\n")
        safe_write("  [>] Trang thanh toan & gia han: https://tungai.fun/cmd-pricing.html\n")
        safe_write("  [>] Kich hoat key: Go /activate <MA_KEY>\n")
        safe_write(f"{'='*70}\n\n")

    # Initial license verification
    server_url = getattr(settings, "server_url", "https://tungai.fun")
    st = verify_remote_cmd_license(server_url)
    licensed = bool(st.get("ok"))
    if not licensed:
        print_license_warning(st.get("message", "Key ban quyen da het han hoac bi thu hoi!"))

    safe_write("  Nhap yeu cau lap trinh (Go /model de doi model, /exit de thoat):\n\n")

    history: list[dict[str, str]] = []
    current_mode = "coder"

    while True:
        try:
            user_input = input(f"TungDevAI [{current_mode}|{current_model_info['id']}] > ").strip()
        except (KeyboardInterrupt, EOFError):
            safe_write("\n\nTam biet! Hen gap lai ban cung TungDevAI Coder v1.0!\n\n")
            break

        if not user_input:
            continue

        if user_input.lower() in ("/exit", "/quit", "exit", "quit"):
            safe_write("\nTam biet! Hen gap lai ban cung TungDevAI Coder v1.0!\n\n")
            break

        if user_input.lower() == "/clear":
            history.clear()
            safe_write("Da lam moi bo nho hoi thoai.\n\n")
            continue

        if user_input.lower().startswith("/activate"):
            parts = user_input.split(maxsplit=1)
            if len(parts) < 2:
                safe_write("\n[!] Cu phap: /activate <MA_KEY>\n    Vi du: /activate CMD-XXXX-YYYY\n\n")
                continue
            act_code = parts[1].strip()
            ok, msg, payload = activate_remote_cmd_key(act_code, server_url)
            if ok:
                licensed = True
                safe_write(f"\n[OK] Kich hoat thanh cong: {msg}\n\n")
            else:
                safe_write(f"\n[X] Kich hoat that bai: {msg}\n    Mua key tai: https://tungai.fun/cmd-pricing.html\n\n")
            continue

        # Handle /model or /models
        if user_input.lower().startswith(("/model", "/models", "/setmodel")):
            parts = user_input.split()
            if len(parts) == 1:
                print_model_menu(current_model_key)
            else:
                arg = parts[1].lower().strip()
                matched_key = None
                for k, m in FLAGSHIP_MODELS.items():
                    if arg in m["alias"] or arg == m["id"]:
                        matched_key = k
                        break
                if matched_key:
                    current_model_key = matched_key
                    current_model_info = FLAGSHIP_MODELS[current_model_key]
                    client = build_client_for_model(settings, current_model_info)
                    safe_write(f"\n✅ [THÀNH CÔNG] Đã chuyển sang mô hình: {current_model_info['name']}\n\n")
                else:
                    safe_write(f"\n⚠️ Không tìm thấy model '{arg}'. Gõ /model để xem danh sách.\n\n")
            continue

        if user_input.lower().startswith("/mode"):
            parts = user_input.split()
            if len(parts) > 1:
                current_mode = parts[1].lower()
                safe_write(f"Da chuyen sang che do: {current_mode}\n\n")
            else:
                safe_write(f"Che do hien tai: {current_mode} (Go: /mode coder | /mode default | /mode security | /mode research)\n\n")
            continue

        # Verify license before answering
        st = verify_remote_cmd_license(server_url)
        licensed = bool(st.get("ok"))
        if not licensed:
            print_license_warning(st.get("message", "Key ban quyen da het han hoac bi xoa!"))
            continue

        mode_obj = get_mode(current_mode)
        system_prompt = build_system_prompt(extra=mode_obj.prompt if mode_obj else None, paid=True)

        history.append({"role": "user", "content": user_input})

        safe_write(f"\n[{current_model_info['name']}]:\n" + "-" * 60 + "\n")
        try:
            full_response = ""
            async for token in client.chat_stream(history, system=system_prompt, plan_id="owner"):
                safe_write(token)
                full_response += token
            safe_write("\n" + "-" * 60 + "\n\n")
            history.append({"role": "assistant", "content": full_response})
        except Exception as exc:
            safe_write(f"\n[X] Loi phan hoi: {exc}\n\n")

if __name__ == "__main__":
    asyncio.run(main_cli())
