# Dang nhap Google (Sign in with Google)

Giong ChatGPT / Claude: user bam **Sign in with Google** tren web.

## 1) Tao OAuth Client tren Google Cloud

1. Vao: https://console.cloud.google.com/apis/credentials  
2. Tao project (hoac chon project co san)  
3. **Configure OAuth consent screen**  
   - User type: **External**  
   - App name: TungDevAI  
   - Support email: email ban  
   - Save  
4. **Credentials → Create credentials → OAuth client ID**  
   - Application type: **Web application**  
   - Name: TUNGDEVAI WEB  
   - **Authorized JavaScript origins**:
     ```
     http://127.0.0.1:7860
     http://localhost:7860
     https://phamtung140513-bit.github.io
     ```
   - **Authorized redirect URIs** (BAT BUOC):
     ```
     http://127.0.0.1:7860/google-callback.html
     http://localhost:7860/google-callback.html
     http://127.0.0.1:7860/
     http://localhost:7860/
     ```
5. Copy **Client ID** (dang `xxxxx.apps.googleusercontent.com`)

## 2) Gan vao .env

```env
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_AUTH_REQUIRED=true
```

- `GOOGLE_AUTH_REQUIRED=true` → bat buoc dang nhap Google moi chat  
- `false` → co the chat khong can Google (dev)

## 3) Cai package + restart

```powershell
cd C:\Users\Admin\Jarvis-AI
.\.venv\Scripts\pip.exe install google-auth
.\.venv\Scripts\python.exe -m webapp.server
```

## 4) Mo web

- Dang nhap: http://127.0.0.1:7860/login.html  
- Dang ky: http://127.0.0.1:7860/register.html  

→ Bam nut **Continue with Google** → chon tai khoan → vao chat.

## Luu y

- Client ID **duoc public** tren frontend (binh thuong).  
- **Khong** put Client Secret vao GitHub Pages.  
- Verify token o server (`/api/auth/google`).  
- Admin van o: `/j-panel.html` (WEB_ADMIN_KEY).
