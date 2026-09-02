# ─────────────────────────────────────────────────────────────────────────────
#  FamilyGuard — Clean Build Script
#  Place this file in: C:\Users\Public\family-guard-web\
#  Run with:  .\build.ps1                  -> debug APK, for local testing
#             .\build.ps1 -Release         -> signed .aab, for Google Play
#             .\build.ps1 -Release -Bump   -> same, but versionCode +1 first
#
#  Play rejects an upload whose versionCode is not higher than the last one
#  you uploaded, so use -Bump on the build you intend to ship. Release builds
#  print the versionCode either way, so you can check before uploading.
# ─────────────────────────────────────────────────────────────────────────────

param(
    # Build a signed release bundle (.aab) instead of a debug APK.
    [switch]$Release,
    # Increment versionCode in android/app/build.gradle before building.
    [switch]$Bump
)

$ErrorActionPreference = "Stop"
$ProjectRoot  = "C:\Users\Public\family-guard-web"
$AndroidAssets = "$ProjectRoot\android\app\src\main\assets\public"
$KeystoreProps = "$ProjectRoot\android\keystore.properties"
$GradleFile    = "$ProjectRoot\android\app\build.gradle"

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
if ($Release) {
    Write-Host "  FamilyGuard Clean Build - RELEASE BUNDLE" -ForegroundColor Cyan
} else {
    Write-Host "  FamilyGuard Clean Build - DEBUG APK" -ForegroundColor Cyan
}
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Set-Location $ProjectRoot

# Without keystore.properties, Gradle still reports BUILD SUCCESSFUL but emits
# an UNSIGNED bundle that Play rejects on upload. Fail here, where the reason
# is obvious, rather than at the end of a browser upload.
if ($Release -and -not (Test-Path $KeystoreProps)) {
    Write-Host "[ERROR] android\keystore.properties not found." -ForegroundColor Red
    Write-Host "        Release builds need it, or the bundle comes out unsigned." -ForegroundColor Red
    Write-Host "        It is git-ignored, so each machine needs its own copy." -ForegroundColor Red
    exit 1
}

$gradleText = [System.IO.File]::ReadAllText($GradleFile)
if ($gradleText -notmatch 'versionCode\s+(\d+)') {
    Write-Host "[ERROR] Could not find versionCode in $GradleFile" -ForegroundColor Red
    exit 1
}
$VersionCode = [int]$Matches[1]
$VersionName = if ($gradleText -match 'versionName\s+"([^"]+)"') { $Matches[1] } else { "?" }

if ($Bump) {
    $NewVersionCode = $VersionCode + 1
    $gradleText = $gradleText -replace "versionCode\s+$VersionCode\b", "versionCode $NewVersionCode"
    # BOM-less UTF-8: a BOM at the top of build.gradle breaks the Groovy parser.
    [System.IO.File]::WriteAllText($GradleFile, $gradleText, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  versionCode  $VersionCode -> $NewVersionCode  (bumped)" -ForegroundColor Green
    $VersionCode = $NewVersionCode
} elseif ($Release) {
    Write-Host "  versionCode  $VersionCode  (use -Bump to increment)" -ForegroundColor Gray
}
if ($Release) {
    Write-Host "  versionName  $VersionName" -ForegroundColor Gray
    Write-Host ""
}

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
if ($Release) {
    Write-Host "[ 5/5 ] Building signed bundle (Gradle)..." -ForegroundColor Yellow
} else {
    Write-Host "[ 5/5 ] Building APK (Gradle)..." -ForegroundColor Yellow
}

# Android Studio's bundled JBR moved to Java 25, which Gradle 8.x rejects with
# "Unsupported class file major version 69". Prefer a JDK 17-21 and only fall
# back to the JBR, so this keeps working across Android Studio updates.
$JdkCandidates = @(
    "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot",
    "C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot",
    "C:\Program Files\Android\Android Studio\jbr"
)
$env:JAVA_HOME = $null
foreach ($candidate in $JdkCandidates) {
    if (Test-Path "$candidate\bin\java.exe") { $env:JAVA_HOME = $candidate; break }
}
if (-not $env:JAVA_HOME) {
    Write-Host "`n[ERROR] No usable JDK found. Install a JDK 21 or set JAVA_HOME." -ForegroundColor Red
    exit 1
}
Write-Host "        JDK: $env:JAVA_HOME" -ForegroundColor Gray
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

Set-Location "$ProjectRoot\android"
if ($Release) {
    .\gradlew.bat bundleRelease --no-build-cache
} else {
    .\gradlew.bat assembleDebug --no-build-cache
}
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
if ($Release) {
    Write-Host "  AAB:  android\app\build\outputs\bundle\release\app-release.aab" -ForegroundColor White
    Write-Host "        versionCode $VersionCode / versionName $VersionName" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Confirm it is signed with your key before uploading:" -ForegroundColor Gray
    Write-Host "    keytool -printcert -jarfile android\app\build\outputs\bundle\release\app-release.aab" -ForegroundColor Gray
} else {
    Write-Host "  APK:  android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor White
}
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
