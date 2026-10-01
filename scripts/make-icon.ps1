# Draws the Notenpult app icon (brass tile with a white double note) into build/icon.ico.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$images = @()
foreach ($s in $sizes) {
  $k = $s / 256.0
  $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = 8 * $k
  $tile = New-RoundedRect $pad $pad (256 * $k - 2 * $pad) (256 * $k - 2 * $pad) (54 * $k)
  $rect = New-Object System.Drawing.RectangleF 0, 0, $s, $s
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 0xE3, 0xB0, 0x4B)), ([System.Drawing.Color]::FromArgb(255, 0x8E, 0x5E, 0x0E)), 50.0
  $g.FillPath($grad, $tile)

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  # Beam
  $beam = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pts = @(
    (New-Object System.Drawing.PointF (100 * $k), (74 * $k)),
    (New-Object System.Drawing.PointF (196 * $k), (52 * $k)),
    (New-Object System.Drawing.PointF (196 * $k), (84 * $k)),
    (New-Object System.Drawing.PointF (100 * $k), (106 * $k))
  )
  $beam.AddPolygon($pts)
  $g.FillPath($white, $beam)
  # Stems
  $g.FillRectangle($white, (100 * $k), (80 * $k), (13 * $k), (104 * $k))
  $g.FillRectangle($white, (183 * $k), (58 * $k), (13 * $k), (104 * $k))
  # Note heads (tilted ellipses)
  foreach ($c in @(@(80, 186), @(163, 164))) {
    $g.TranslateTransform(($c[0] * $k), ($c[1] * $k))
    $g.RotateTransform(-22)
    $g.FillEllipse($white, (-33 * $k), (-23 * $k), (66 * $k), (46 * $k))
    $g.ResetTransform()
  }
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += , @{ Size = $s; Bytes = $ms.ToArray() }
  if ($s -eq 256) { $bmp.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
}

$fs = [System.IO.File]::Create((Join-Path $outDir 'icon.ico'))
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($img in $images) {
  $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
  $bw.Write([Byte]$dim); $bw.Write([Byte]$dim); $bw.Write([Byte]0); $bw.Write([Byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$img.Bytes.Length); $bw.Write([UInt32]$offset)
  $offset += $img.Bytes.Length
}
foreach ($img in $images) { $bw.Write($img.Bytes) }
$bw.Close()
Write-Output "icon written: $(Join-Path $outDir 'icon.ico')"
