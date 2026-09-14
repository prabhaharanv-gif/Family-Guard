# deploy-web.ps1 - publish the web app (privacy policy, delete-account page)
# to https://famora-family.vercel.app
#
#   .\deploy-web.ps1              build and publish to production
#   .\deploy-web.ps1 -NoDeploy    build and package only, publish nothing
#
# Why not `vercel build`: it always runs its own `npm install` first, and on
# this machine that step fails ("spawn cmd.exe ENOENT", or npm unable to open
# package-lock.json). The app's own `npm run build` works, so this script runs
# that, packages dist/ in Vercel's prebuilt format, and uploads only those
# finished files - never source code, .env or the keystores in this folder.
param([switch]$NoDeploy)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path '.vercel\project.json')) {
    throw 'This folder is not linked to Vercel. Run: vercel link --yes --project famora-family'
}

Write-Host '[1/3] Building the web app (npm run build)...' -ForegroundColor Cyan
# Vite prints a chunk-size warning on stderr; under PowerShell 5.1 that would
# abort the script, so judge success by the exit code instead.
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
cmd /c "npm run build 2>&1"
$code = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($code -ne 0 -or -not (Test-Path 'dist\index.html')) { throw "npm run build failed (exit $code)" }

Write-Host '[2/3] Packaging dist/ for Vercel...' -ForegroundColor Cyan
$out = '.vercel\output'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force "$out\static" | Out-Null
Copy-Item 'dist\*' "$out\static" -Recurse -Force

# Same behaviour as vercel.json: security headers on every response, real files
# served as-is, and every other path (/privacy, /delete-account...) handed to
# index.html so the app's router can show the right page.
$config = @'
{
  "version": 3,
  "routes": [
    {
      "src": "/(.*)",
      "headers": {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "geolocation=(self), camera=(self), microphone=(self)"
      },
      "continue": true
    },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
'@
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "$out\config.json"), $config, (New-Object Text.UTF8Encoding $false))

$files = Get-ChildItem "$out\static" -Recurse -File
$bad = $files | Where-Object { $_.Name -match '\.(jks|keystore|properties|env|pem|p12|zip)$' -or $_.Name -like '.env*' }
if ($bad) { throw "Refusing to publish: sensitive file in output: $($bad.Name -join ', ')" }
Write-Host "        $($files.Count) files ready in $out\static"

if ($NoDeploy) { Write-Host 'Skipped publishing (-NoDeploy).' -ForegroundColor Yellow; exit 0 }

Write-Host '[3/3] Publishing to production...' -ForegroundColor Cyan
vercel deploy --prebuilt --prod --yes
if ($LASTEXITCODE -ne 0) { throw "vercel deploy failed (exit $LASTEXITCODE)" }
Write-Host ''
Write-Host 'Done. Privacy policy:  https://famora-family.vercel.app/privacy' -ForegroundColor Green
Write-Host '      Delete account:  https://famora-family.vercel.app/delete-account' -ForegroundColor Green
