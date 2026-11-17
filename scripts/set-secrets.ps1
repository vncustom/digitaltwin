# Đặt secrets cho Worker "digitaltwin" trên Cloudflare.
# Chạy trong thư mục dự án:  powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1
# - BOT_TOKEN: bạn dán khi được hỏi (ẩn ký tự).
# - GEMINI_API_KEY: lấy từ .dev.vars nếu đã có, nếu không sẽ hỏi.
# - WEBHOOK_SECRET, OWNER_CLAIM_CODE, ADMIN_KEY: tự sinh ngẫu nhiên, lưu vào secrets.local.txt (đã gitignore).

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function New-RandomSecret([int]$len = 40) {
  $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] $len
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Put-Secret([string]$name, [string]$value) {
  Write-Host "→ $name" -ForegroundColor Cyan
  $value | npx wrangler secret put $name | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Không đặt được $name" }
}

function Read-Plain([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
}

# BOT_TOKEN
$bot = Read-Plain 'Dán BOT_TOKEN từ @BotFather'
if ($bot -notmatch '^\d+:[\w-]{30,}$') { throw 'BOT_TOKEN không đúng định dạng 123456:ABC...' }
Put-Secret 'BOT_TOKEN' $bot

# GEMINI_API_KEY
$gem = $null
if (Test-Path .dev.vars) {
  $line = Get-Content .dev.vars -Encoding utf8 | Where-Object { $_ -like 'GEMINI_API_KEY=*' } | Select-Object -First 1
  if ($line) { $gem = ($line -replace '^GEMINI_API_KEY=', '').Trim() }
}
if (-not $gem -or $gem -eq 'your-gemini-api-key') { $gem = Read-Plain 'Dán GEMINI_API_KEY' }
else { Write-Host 'Dùng GEMINI_API_KEY trong .dev.vars' }
Put-Secret 'GEMINI_API_KEY' $gem

# Sinh ngẫu nhiên
$webhook = New-RandomSecret 48
$claim = New-RandomSecret 32
$admin = New-RandomSecret 32
Put-Secret 'WEBHOOK_SECRET' $webhook
Put-Secret 'OWNER_CLAIM_CODE' $claim
Put-Secret 'ADMIN_KEY' $admin

@"
# Giữ bí mật. File này đã nằm trong .gitignore.
OWNER_CLAIM_CODE=$claim
ADMIN_KEY=$admin
"@ | Out-File -Encoding utf8 secrets.local.txt

Write-Host ''
Write-Host '✅ Đã đặt đủ 5 secrets.' -ForegroundColor Green
Write-Host 'OWNER_CLAIM_CODE và ADMIN_KEY đã lưu trong secrets.local.txt — bạn cần chúng cho bước /setup và /claim.'
