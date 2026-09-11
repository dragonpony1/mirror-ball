# Composites the join QR onto a branded Mirror Ball card that Matt can text out.
# Run: powershell -ExecutionPolicy Bypass -File icons\make-qr-card.ps1
Add-Type -AssemblyName System.Drawing

$dir  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$qr   = [System.Drawing.Image]::FromFile((Join-Path $dir "qr.gif"))
$W = 900; $H = 1200
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor

# velvet background
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 74, 18, 100),
  [System.Drawing.Color]::FromArgb(255, 18, 4, 26),
  90.0)
$g.FillRectangle($bg, $rect)

# gold frame
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 210, 74), 8)
$g.DrawRectangle($pen, 22, 22, $W - 44, $H - 44)

$gold  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 210, 74))
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 243, 224))
$dim   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 201, 174, 218))
$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center

$fTitle = New-Object System.Drawing.Font("Impact", 74, [System.Drawing.FontStyle]::Regular)
$fSub   = New-Object System.Drawing.Font("Segoe UI", 25, [System.Drawing.FontStyle]::Regular)
$fLabel = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Regular)
$fCode  = New-Object System.Drawing.Font("Segoe UI", 40, [System.Drawing.FontStyle]::Bold)
$fUrl   = New-Object System.Drawing.Font("Segoe UI", 19, [System.Drawing.FontStyle]::Regular)

$g.DrawString("MIRROR BALL", $fTitle, $gold, ($W / 2), 70, $center)
$g.DrawString("Fantasy Dancing with the Stars", $fSub, $white, ($W / 2), 182, $center)
$g.DrawString("Point your camera here", $fLabel, $dim, ($W / 2), 238, $center)

# QR on a white plate
$qrSize = 520
$qx = [int](($W - $qrSize) / 2); $qy = 300
$plate = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillRectangle($plate, ($qx - 18), ($qy - 18), ($qrSize + 36), ($qrSize + 36))
$g.DrawImage($qr, $qx, $qy, $qrSize, $qrSize)

$g.DrawString("League passcode", $fLabel, $dim, ($W / 2), 880, $center)
$g.DrawString("mball", $fCode, $gold, ($W / 2), 918, $center)
$g.DrawString("dragonpony1.github.io/mirror-ball", $fUrl, $white, ($W / 2), 1000, $center)
$g.DrawString("Build a team of 5 couples under a `$50,000 cap.", $fLabel, $dim, ($W / 2), 1060, $center)
$g.DrawString("You score what the judges score.", $fLabel, $dim, ($W / 2), 1096, $center)

$out = Join-Path $dir "mirror-ball-invite.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $qr.Dispose()
Write-Output "wrote $out"
