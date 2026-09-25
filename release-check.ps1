# release-check.ps1 - run before handing out a build, to catch an app that expects
# a backend piece which was never deployed.
#
#   .\release-check.ps1                 report
#   .\release-check.ps1 -MarkApplied    record that every migration file so far has
#                                       been run in the Supabase SQL Editor
#
# Two checks:
#   1. Edge functions: each folder in supabase\functions is probed on the live
#      project. HTTP 404 means it was never deployed. Any other status means it
#      exists (401/400 are normal for an unauthenticated probe). This does NOT
#      prove the deployed code is the latest - after a deploy, read the CLI
#      output for a 401 before believing it went through.
#   2. Migrations: SQL is run by hand, so nothing on the server says which files
#      were applied. supabase\migrations\.applied holds the newest version you
#      confirmed; anything newer is listed as still to run, oldest first.
param([switch]$MarkApplied)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$migDir  = 'supabase\migrations'
$marker  = "$migDir\.applied"
$files   = Get-ChildItem $migDir -Filter *.sql | Sort-Object Name
$latest  = ($files | Select-Object -Last 1).Name.Split('_')[0]

if ($MarkApplied) {
    [System.IO.File]::WriteAllText("$PSScriptRoot\$marker", $latest, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Marked applied through $latest." -ForegroundColor Green
    exit 0
}

$problems = 0

# ── 1. Migrations ────────────────────────────────────────────────────────────
Write-Host "`n[1/2] Migrations" -ForegroundColor Cyan
if (Test-Path $marker) {
    $applied = (Get-Content $marker -Raw).Trim()
    $pending = @($files | Where-Object { $_.Name.Split('_')[0] -gt $applied })
    Write-Host "  Last confirmed applied: $applied" -ForegroundColor Gray
} else {
    $pending = @($files | Select-Object -Last 10)
    Write-Host "  No $marker yet - showing the 10 newest. After running them in the" -ForegroundColor Yellow
    Write-Host "  SQL Editor, run: .\release-check.ps1 -MarkApplied" -ForegroundColor Yellow
}
if ($pending.Count -eq 0) {
    Write-Host "  Nothing pending." -ForegroundColor Green
} else {
    $problems += $pending.Count
    Write-Host "  Run these in the SQL Editor, in this order:" -ForegroundColor Yellow
    $pending | ForEach-Object { Write-Host "    $($_.Name)" }
}

# ── 2. Edge functions ────────────────────────────────────────────────────────
Write-Host "`n[2/2] Edge functions (live probe)" -ForegroundColor Cyan
$cfg = @{}
Get-Content .env | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim('"') } }
$url = $cfg["VITE_SUPABASE_URL"]; $key = $cfg["VITE_SUPABASE_ANON_KEY"]
if (-not $url -or -not $key) { throw '.env is missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY' }

foreach ($dir in Get-ChildItem 'supabase\functions' -Directory) {
    $status = 0
    try {
        $r = Invoke-WebRequest -Uri "$url/functions/v1/$($dir.Name)" -Method Post -Body '{}' `
             -ContentType 'application/json' -Headers @{ apikey = $key; Authorization = "Bearer $key" } `
             -UseBasicParsing -TimeoutSec 20
        $status = [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } else { $status = -1 }
    }
    if ($status -eq 404 -or $status -eq -1) {
        $problems++
        Write-Host ("  MISSING  {0}  (HTTP {1})" -f $dir.Name, $status) -ForegroundColor Red
    } else {
        Write-Host ("  ok       {0}  (HTTP {1})" -f $dir.Name, $status) -ForegroundColor Green
    }
}

Write-Host ""
if ($problems -eq 0) { Write-Host 'Backend matches the repo. Safe to release.' -ForegroundColor Green }
else { Write-Host "$problems item(s) need attention before releasing." -ForegroundColor Yellow }
exit ([int]($problems -gt 0))
