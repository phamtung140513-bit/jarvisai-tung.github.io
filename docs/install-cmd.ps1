# TungDevAI CMD 1-Click Installer for Windows
# Run: irm https://tungai.fun/install-cmd.ps1 | iex

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "  ╭────────────────────────────────────────────────────────────────────────╮" -ForegroundColor Green
Write-Host "  │   ████████╗██╗   ██╗███╗   ██╗ ██████╗ ██████╗ ███████╗██╗   ██╗ █████╗ │" -ForegroundColor Cyan
Write-Host "  │   ╚══██╔══╝██║   ██║████╗  ██║██╔════╝ ██╔══██╗██╔════╝██║   ██║██╔══██╗│" -ForegroundColor Cyan
Write-Host "  │      ██║   ██║   ██║██╔██╗ ██║██║  ███╗██║  ██║█████╗  ██║   ██║███████│" -ForegroundColor Green
Write-Host "  │      ██║   ██║   ██║██║╚██╗██║██║   ██║██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══██│" -ForegroundColor Green
Write-Host "  │      ██║   ╚██████╔╝██║ ╚████║╚██████╔╝██████╔╝███████╗ ╚████╔╝ ██║  ██│" -ForegroundColor DarkGreen
Write-Host "  │      ╚═╝    ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═│" -ForegroundColor DarkGreen
Write-Host "  │          ✦ TUNGDEVAI STUDIO · QUANTUM ARCHITECT TERMINAL ✦             │" -ForegroundColor Magenta
Write-Host "  ╰────────────────────────────────────────────────────────────────────────╯" -ForegroundColor Green
Write-Host ""

# 1. Check Python
Write-Host "  [1/4] Kiểm tra môi trường Python..." -ForegroundColor Cyan
$hasPython = $false
try {
    $pyVer = & python --version 2>&1
    if ($pyVer -like "*Python*") {
        Write-Host "   => Đã tìm thấy $pyVer" -ForegroundColor Green
        $hasPython = $true
    }
} catch {}

if (-not $hasPython) {
    Write-Host "   => Chưa phát hiện Python. Đang tiến hành cài đặt tự động qua winget..." -ForegroundColor Yellow
    try {
        winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        Write-Host "   => Cài đặt Python 3.12 thành công!" -ForegroundColor Green
    } catch {
        Write-Host "   [!] Vui lòng tải Python tại: https://www.python.org/downloads/" -ForegroundColor Red
        Write-Host "       (Nhớ tích chọn 'Add python.exe to PATH' khi cài đặt)" -ForegroundColor Yellow
        Pause
        Exit 1
    }
}

# 2. Download and Extract TungDevAI CMD Package
$installDir = Join-Path $env:USERPROFILE "TungDevAI"
$zipUrl = "https://tungai.fun/downloads/TungDevAI-CMD.zip"
$tempZip = Join-Path $env:TEMP "TungDevAI-CMD.zip"

Write-Host "  [2/4] Đang tải gói phần mềm TungDevAI CMD từ máy chủ..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing

if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

Write-Host "  [3/4] Đang giải nén mã nguồn vào $installDir..." -ForegroundColor Cyan
Expand-Archive -Path $tempZip -DestinationPath $installDir -Force
Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue

# 3. Install dependencies
Write-Host "  [4/4] Đang cài đặt các thư viện bổ trợ (rich, httpx...)..." -ForegroundColor Cyan
$reqFile = Join-Path $installDir "requirements-cli.txt"
if (Test-Path $reqFile) {
    & python -m pip install -q -r $reqFile
} else {
    & python -m pip install -q rich httpx prompt_toolkit
}

# 4. Create Desktop Shortcut
$desktop = [System.Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "TungDevAI CMD.bat"
$cmdFile = Join-Path $installDir "tungdev.cmd"
$batContent = "@echo off`r`ncd /d `"" + $installDir + "`"`r`ncall `"" + $cmdFile + "`" %*`r`n"
[System.IO.File]::WriteAllText($shortcutPath, $batContent, [System.Text.Encoding]::ASCII)

# Add installDir to User PATH if not exists
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
}

Write-Host ""
Write-Host "  ╭────────────────────────────────────────────────────────────────────────╮" -ForegroundColor Green
Write-Host "  │  🎉 CÀI ĐẶT THÀNH CÔNG TUNGDEVAI CMD TRÊN MÁY TÍNH CỦA BẠN!            │" -ForegroundColor Green
Write-Host "  │  • Biểu tượng Desktop: TungDevAI CMD.bat                               │" -ForegroundColor Yellow
Write-Host "  │  • Hoặc mở CMD / PowerShell gõ: tungdev                                │" -ForegroundColor Yellow
Write-Host "  │  • Kích hoạt key bản quyền: /activate MA_KEY                           │" -ForegroundColor Cyan
Write-Host "  ╰────────────────────────────────────────────────────────────────────────╯" -ForegroundColor Green
Write-Host ""
Write-Host "  🚀 Đang khởi chạy TungDevAI CMD ngay bây giờ..." -ForegroundColor Magenta
Start-Sleep -Seconds 1

Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "`"$cmdFile`"")
