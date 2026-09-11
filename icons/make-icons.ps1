# Draws the Mirror Ball app icon: a disco ball on velvet purple with gold sparkles.
# Run: powershell -ExecutionPolicy Bypass -File icons\make-icons.ps1
Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  # velvet background
  $bgRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect,
    [System.Drawing.Color]::FromArgb(255, 61, 14, 84),
    [System.Drawing.Color]::FromArgb(255, 20, 4, 28),
    90.0)
  $g.FillRectangle($bg, $bgRect)

  # the ball
  $pad = [int]($size * 0.17)
  $d = $size - ($pad * 2)
  $ballRect = New-Object System.Drawing.Rectangle($pad, $pad, $d, $d)

  $path2 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path2.AddEllipse($ballRect)
  $ball = New-Object System.Drawing.Drawing2D.PathGradientBrush($path2)
  $ball.CenterPoint = New-Object System.Drawing.PointF(($pad + $d * 0.34), ($pad + $d * 0.30))
  $ball.CenterColor = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
  $ball.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 108, 122, 158))
  $g.FillEllipse($ball, $ballRect)

  # mirror facets: a grid clipped to the ball
  $old = $g.Clip
  $g.SetClip($path2)
  $cell = [Math]::Max(3, [int]($d / 7))
  $rnd = New-Object System.Random(7)
  for ($y = $pad; $y -lt $pad + $d; $y += $cell) {
    for ($x = $pad; $x -lt $pad + $d; $x += $cell) {
      $v = $rnd.Next(70, 255)
      $c = [System.Drawing.Color]::FromArgb(150, $v, $v, [Math]::Min(255, $v + 25))
      $b = New-Object System.Drawing.SolidBrush($c)
      $g.FillRectangle($b, $x + 1, $y + 1, $cell - 2, $cell - 2)
      $b.Dispose()
    }
  }
  $g.Clip = $old

  # gold rim
  $penW = [Math]::Max(1.0, $size * 0.018)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(230, 255, 210, 74), $penW)
  $g.DrawEllipse($pen, $ballRect)

  # a couple of gold sparkles
  $spark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 255, 226, 130))
  foreach ($p in @(@(0.17, 0.20, 0.055), @(0.84, 0.30, 0.040), @(0.26, 0.85, 0.035))) {
    $cx = $size * $p[0]; $cy = $size * $p[1]; $r = $size * $p[2]
    $g.FillPolygon($spark, @(
      (New-Object System.Drawing.PointF($cx, ($cy - $r))),
      (New-Object System.Drawing.PointF(($cx + $r * 0.26), ($cy - $r * 0.26))),
      (New-Object System.Drawing.PointF(($cx + $r), $cy)),
      (New-Object System.Drawing.PointF(($cx + $r * 0.26), ($cy + $r * 0.26))),
      (New-Object System.Drawing.PointF($cx, ($cy + $r))),
      (New-Object System.Drawing.PointF(($cx - $r * 0.26), ($cy + $r * 0.26))),
      (New-Object System.Drawing.PointF(($cx - $r), $cy)),
      (New-Object System.Drawing.PointF(($cx - $r * 0.26), ($cy - $r * 0.26)))
    ))
  }

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "wrote $path"
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Icon 512 (Join-Path $dir "icon-512.png")
New-Icon 192 (Join-Path $dir "icon-192.png")
New-Icon 180 (Join-Path $dir "apple-touch-icon.png")
