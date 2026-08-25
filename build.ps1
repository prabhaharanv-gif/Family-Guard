# ─────────────────────────────────────────────────────────────────────────────
#  FamilyGuard — Clean Build Script
#  Place this file in: C:\Users\Public\family-guard-web\
#  Run with:  .\build.ps1
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$ProjectRoot  = "C:\Users\Public\family-guard-web"
$AndroidAssets = "$ProjectRoot\android\app\src\main\assets\public"

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  FamilyGuard Clean Build" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Set-Location $ProjectRoot

# ── STEP 1: Wipe old Vite output ─────────────────────────────────────────────
Write-Host "[ 1/5 ] Cleaning old dist..." -ForegroundColor Yellow
if (Test-Path "$ProjectRoot\dist") {
    Remove-Item "$ProjectRoot\dist" -Recurse -Force
    Write-Host "        dist\ deleted" -ForegroundColor Gray
} else {
    Write-Host "        dist\ not found (skipping)" -ForegroundColor Gray
}

# ── STEP 2: Wipe the android assets folder so no stale hashed files linger ───
Write-Host "[ 2/5 ] Cleaning android assets..." -ForegroundColor Yellow
if (Test-Path $AndroidAssets) {
    Remove-Item $AndroidAssets -Recurse -Force
    Write-Host "        $AndroidAssets deleted" -ForegroundColor Gray
} else {
    Write-Host "        Assets folder not found (skipping)" -ForegroundColor Gray
}

# ── STEP 3: Fresh Vite build ──────────────────────────────────────────────────
Write-Host "[ 3/5 ] Building React app (Vite)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] npm run build failed. Stopping." -ForegroundColor Red
    exit 1
}
Write-Host "        Build complete" -ForegroundColor Green

# ── STEP 4: Capacitor sync — copies fresh dist into android assets ────────────
Write-Host "[ 4/5 ] Syncing to Android (cap sync)..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] cap sync failed. Stopping." -ForegroundColor Red
    exit 1
}
Write-Host "        Sync complete" -ForegroundColor Green

# ── STEP 5: Set JAVA_HOME for Gradle ─────────────────────────────────────────
Write-Host "[ 5/5 ] Building APK (Gradle)..." -ForegroundColor Yellow

# Update this path if your JDK is installed elsewhere
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

Set-Location "$ProjectRoot\android"
.\gradlew.bat assembleDebug --no-build-cache
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Gradle build failed." -ForegroundColor Red
    Set-Location $ProjectRoot
    exit 1
}

Set-Location $ProjectRoot

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  BUILD COMPLETE" -ForegroundColor Green
Write-Host ""
Write-Host "  APK:  android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
