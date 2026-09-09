# Run this AFTER "npx cap sync android" every time you build
# It patches the icon files that cap sync keeps restoring

$res = "C:\Users\Public\family-guard-web\android\app\src\main\res"

# 1. Replace ic_launcher_foreground.webp in all mipmap folders with transparent 1x1
#    so MIUI has nothing to render as a second icon
$transparent = [byte[]](0x52,0x49,0x46,0x46,0x40,0x00,0x00,0x00,0x57,0x45,0x42,0x50,
    0x56,0x50,0x38,0x58,0x0a,0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x41,0x4c,0x50,0x48,0x02,0x00,0x00,0x00,0x00,0x00,0x56,0x50,0x38,0x20,
    0x18,0x00,0x00,0x00,0x30,0x01,0x00,0x9d,0x01,0x2a,0x01,0x00,0x01,0x00,0x01,0x40,
    0x26,0x25,0xa4,0x00,0x03,0x70,0x00,0xfe,0xfd,0x36,0x68,0x00)

$densities = @("mdpi","hdpi","xhdpi","xxhdpi","xxxhdpi")
foreach ($d in $densities) {
    $path = "$res\mipmap-$d\ic_launcher_foreground.webp"
    if (Test-Path $path) {
        [System.IO.File]::WriteAllBytes($path, $transparent)
        Write-Host "Patched: $path"
    }
}

# 2. Fix adaptive icon XMLs to use @drawable instead of @mipmap
$xmlContent = @'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
'@

Set-Content -Path "$res\mipmap-anydpi-v26\ic_launcher.xml" -Value $xmlContent -Encoding UTF8
Set-Content -Path "$res\mipmap-anydpi-v26\ic_launcher_round.xml" -Value $xmlContent -Encoding UTF8
Write-Host "Patched: ic_launcher.xml and ic_launcher_round.xml"

Write-Host ""
Write-Host "All icon patches applied. Now run: .\gradlew.bat assembleDebug"
