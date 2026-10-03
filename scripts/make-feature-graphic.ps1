# make-feature-graphic.ps1 - draws the Play Store feature graphic (1024x500) with the Kinest name.
# Output: docs\play-store-assets\feature-graphic-kinest-1024x500.png
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$icon = Join-Path $root 'docs\play-store-assets\app-icon-512x512.png'
$out  = Join-Path $root 'docs\play-store-assets\feature-graphic-kinest-1024x500.png'

$W = 1024; $H = 500
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.InterpolationMode = 'HighQualityBicubic'

# Background: maroon diagonal gradient, same family of colours as the app.
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(139, 13, 61)), ([System.Drawing.Color]::FromArgb(72, 6, 31)), 20
$g.FillRectangle($grad, $rect)

# Icon: rounded square with a soft light outline.
function RoundedRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}
$size = 230; $ix = 96; $iy = ($H - $size) / 2
$path = RoundedRect $ix $iy $size $size 38
$g.SetClip($path)
$img = [System.Drawing.Image]::FromFile($icon)
$g.DrawImage($img, $ix, $iy, $size, $size)
$g.ResetClip()
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 255, 255, 255)), 3
$g.DrawPath($pen, $path)

# Text.
$white = [System.Drawing.Brushes]::White
$soft  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(225, 255, 255, 255))
$fontName = New-Object System.Drawing.Font 'Segoe UI Semibold', 84, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fontTag  = New-Object System.Drawing.Font 'Segoe UI', 31, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$tx = 372
$g.DrawString('Kinest', $fontName, $white, ($tx - 10), 150)
$g.DrawString("Keep your family connected,", $fontTag, $soft, ($tx + 4), 262)
$g.DrawString("located and safe.", $fontTag, $soft, ($tx + 4), 304)

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()
"saved $out"
(Get-Item $out).Length
