#!/bin/bash
# TungDevAI — chay bot + web 24/7 tren VPS (khong can bat may nha)
# Chay tren VPS: bash /opt/Jarvis-AI/deploy/setup_24h.sh
set -e
cd /opt/Jarvis-AI

echo "=== 1) Python venv + deps ==="
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
. .venv/bin/activate
pip install -U pip -q
pip install -r requirements.txt -q

if [ ! -f .env ]; then
  echo "THIEU /opt/Jarvis-AI/.env — copy tu may nha roi chay lai."
  exit 1
fi

echo "=== 2) Systemd bot + web ==="
cp -f deploy/jarvis-bot.service /etc/systemd/system/tungdevai-bot.service
cp -f deploy/jarvis-web.service /etc/systemd/system/tungdevai-web.service
systemctl daemon-reload
systemctl enable tungdevai-bot tungdevai-web
systemctl restart tungdevai-bot tungdevai-web
sleep 2
systemctl --no-pager --full status tungdevai-bot tungdevai-web || true

echo "=== 2b) vietqr-pay (QR + SePay) neu co /opt/vietqr-pay ==="
if [ -d /opt/vietqr-pay ]; then
  if [ -f deploy/vietqr.service ]; then
    cp -f deploy/vietqr.service /etc/systemd/system/vietqr-pay.service
  fi
  if command -v node >/dev/null 2>&1; then
    (cd /opt/vietqr-pay && npm install --omit=dev 2>/dev/null || npm install) || true
    systemctl daemon-reload
    systemctl enable vietqr-pay 2>/dev/null || true
    systemctl restart vietqr-pay 2>/dev/null || true
    sleep 1
    curl -s http://127.0.0.1:3000/api/health || echo "vietqr-pay health fail"
  else
    echo "Chua co node — cai: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
  fi
else
  echo "Khong co /opt/vietqr-pay — copy tu may nha: scp -r vietqr-pay root@VPS:/opt/vietqr-pay"
fi

echo ""
echo "=== 3) Local check ==="
curl -s -o /dev/null -w "web local: HTTP %{http_code}\n" http://127.0.0.1:7860/ || true
curl -s -o /dev/null -w "telegram API: HTTP %{http_code}\n" -I https://api.telegram.org || true

echo ""
echo "=== 4) Cloudflare quick tunnel (URL public, khong can mo port shop) ==="
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Cai cloudflared..."
  curl -fsSL -o /tmp/cloudflared.deb \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  dpkg -i /tmp/cloudflared.deb || apt-get install -f -y
fi

# Service tunnel -> 7860
cat >/etc/systemd/system/tungdevai-tunnel.service <<'EOF'
[Unit]
Description=TungDevAI Cloudflare Tunnel -> 7860
After=network-online.target tungdevai-web.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --url http://127.0.0.1:7860 --no-autoupdate
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable tungdevai-tunnel
systemctl restart tungdevai-tunnel
sleep 5

echo ""
echo "Log tunnel (tim dong https://....trycloudflare.com):"
journalctl -u tungdevai-tunnel -n 40 --no-pager || true

echo ""
echo "====================================================="
echo " XONG — may nha CO THE TAT"
echo "  Bot Telegram: chay 24/7 (systemctl status tungdevai-bot)"
echo "  Web:          http://127.0.0.1:7860 tren VPS"
echo "  Public:       URL trycloudflare trong log tunnel"
echo ""
echo " Lay URL public:"
echo "   journalctl -u tungdevai-tunnel -n 50 --no-pager | grep trycloudflare"
echo ""
echo " Luu y: quick tunnel DOI URL moi lan restart tunnel."
echo " Can URL co dinh: dung Cloudflare named tunnel + domain."
echo "====================================================="
