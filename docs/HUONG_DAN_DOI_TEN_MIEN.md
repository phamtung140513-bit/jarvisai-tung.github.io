# Đổi “tên miền” web TungDevAI

## Miền tĩnh đang dùng (CHỐT)

```text
https://jarvisai-tung.github.io/
https://jarvisai-tung.github.io/landing.html
https://jarvisai-tung.github.io/login.html
https://jarvisai-tung.github.io/register.html
```

Org: https://github.com/jarvisai-tung  
Repo site: `jarvisai-tung/jarvisai-tung.github.io` (Pages folder `/docs`)

- **UI (HTML/CSS/JS)**: GitHub Pages free — `jarvisai-tung.github.io`  
- **API chat**: máy bạn / tunnel / **VPS** (`docs/config.json` → `apiBase`)  
- **Sau VPS**: trỏ domain riêng hoặc `http://IP:7860` — UI github.io vẫn giữ làm landing nếu muốn

Backup (cũ, vẫn chạy được):
```text
https://phamtung140513-bit.github.io/jarvis-ai/
```

---

## (Tuỳ chọn) Đổi miền khác — chỉ khi thật sự cần

Hiện tại web free là:

```text
https://phamtung140513-bit.github.io/jarvis-ai/
```


## Quan trọng

Trên GitHub, tên **`TungDevAI` đã bị người khác chiếm**  
(user: https://github.com/TungDevAI) → **không** tạo được `https://TungDevAI.github.io/` free.

---

## Cách 1 — Free: `jarvisai-tung.github.io` (tên bạn đã chọn)

Org/user: **`jarvisai-tung`**

### Bước A — Đã tạo tên

- Profile: https://github.com/jarvisai-tung  

### Bước B — Repo site gốc

1. Tạo repo tên **đúng**:  
   **`jarvisai-tung.github.io`**  
   (public, không README)

2. Trên máy: double-click `SETUP_JARVISAI_DOMAIN.cmd`  
   hoặc PowerShell:

```powershell
cd C:\Users\Admin\Jarvis-AI
$env:Path = "C:\Program Files\Git\bin;C:\Program Files\GitHub CLI;" + $env:Path

git remote remove origin-org 2>$null
git remote add origin-org https://github.com/jarvisai-tung/jarvisai-tung.github.io.git
git push -u origin-org main
```

3. Repo → **Settings → Pages**  
   - Source: **Deploy from a branch**  
   - Branch: `main`  
   - Folder: **`/docs`**  
   - Save  

4. URL free:

```text
https://jarvisai-tung.github.io/
https://jarvisai-tung.github.io/landing.html
```

---

## Cách 2 — Domain riêng `TungDevAI.com` / `.vn` (trả phí)

1. Mua domain (Namecheap, Cloudflare, Nhà đăng ký VN…)  
   Ví dụ: `TungDevAI.com` hoặc `jarvisai.vn`

2. Trong repo đang có Pages (`phamtung140513-bit/jarvis-ai`):  
   **Settings → Pages → Custom domain** → nhập `TungDevAI.com`

3. DNS (Cloudflare/DNS provider):

| Type  | Name | Value |
|-------|------|--------|
| CNAME | `@` hoặc `www` | `phamtung140513-bit.github.io` |

Với apex `@` nhiều nhà cung cấp cần **A record** theo docs GitHub:

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

4. File `docs/CNAME` (sau khi set custom domain GitHub có thể tự tạo):

```text
TungDevAI.com
```

5. Bật **Enforce HTTPS** khi DNS xanh.

URL:

```text
https://TungDevAI.com/
```

---

## Cách 3 — Giữ link hiện tại (không đổi)

```text
https://phamtung140513-bit.github.io/jarvis-ai/
```

Vẫn free, ổn định. Có thể rút gọn bằng bit.ly / t.me link.

---

## Gợi ý

| Muốn | Làm |
|------|-----|
| Free, ngắn | Org **`jarvisai`** → `https://jarvisai.github.io/` |
| Đúng chữ TungDevAI | Mua domain **`TungDevAI.com`** |
| Nhanh nhất | Dùng link hiện tại |

Nhắn mình chọn **1 / 2 / 3** để cấu hình tiếp (CNAME, push org…).
