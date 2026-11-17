# FISCALPOINT - Genera los iconos del POS (public/icons/pos-*.png).
# Parte de los iconos de la app (public/icons/app-*.png) y les pone debajo de la marca una
# pastilla azul con "POS", para distinguir las dos apps cuando estan instaladas en la misma PC.
# Diseno: docs/superpowers/specs/2026-11-17-app-instalable-design.md
#
# Los iconos "any" de la app son una placa blanca de esquinas redondeadas con la marca al
# centro; el maskable es la marca sobre blanco a sangre completa. En los dos casos se deja la
# placa donde esta, se sube la marca y la pastilla entra debajo, con la marca y la pastilla
# centradas juntas en vertical.
#
# Uso, desde la raiz del repo (Windows PowerShell 5.1 trae System.Drawing):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-iconos-pos.ps1
# Se puede repetir: sobrescribe los pos-*.png. Si cambia el arte de la app se vuelve a
# correr, porque la marca se mide y se centra en cada pasada.
# Mantener este archivo en ASCII puro (PowerShell 5.1 lee .ps1 como ANSI).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$carpeta = Join-Path (Split-Path -Parent $PSScriptRoot) 'public\icons'
$azul    = [System.Drawing.ColorTranslator]::FromHtml('#0b5be0')

# Recorre los pixeles de un bitmap (bytes B, G, R, A) dentro de [margen, lado - margen).
# Visible = alfa > 16 y no casi blanco. Devuelve la caja de lo visible (x0, y0, x1, y1) y la
# distancia maxima de un pixel visible al centro del bitmap.
Add-Type -TypeDefinition @'
public static class Escaneo {
  public static double[] Visible(byte[] b, int ancho, int alto, int stride, int margen) {
    int x0 = ancho, y0 = alto, x1 = -1, y1 = -1;
    double c = (ancho - 1) / 2.0, r2 = 0;
    for (int y = margen; y < alto - margen; y++) {
      for (int x = margen; x < ancho - margen; x++) {
        int i = y * stride + 4 * x;
        if (b[i + 3] <= 16) continue;
        if (b[i] >= 245 && b[i + 1] >= 245 && b[i + 2] >= 245) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        double d2 = (x - c) * (x - c) + (y - c) * (y - c);
        if (d2 > r2) r2 = d2;
      }
    }
    return new double[] { x0, y0, x1, y1, System.Math.Sqrt(r2) };
  }
}
'@

function Get-Visible([System.Drawing.Bitmap]$bmp, [int]$margen) {
  $rect  = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $datos = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($datos.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($datos.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($datos)
  $r = [Escaneo]::Visible($bytes, $bmp.Width, $bmp.Height, $datos.Stride, $margen)
  [pscustomobject]@{ X0 = [int]$r[0]; Y0 = [int]$r[1]; X1 = [int]$r[2]; Y1 = [int]$r[3]; Radio = [double]$r[4] }
}

# Pastilla: rectangulo con los extremos semicirculares (radio = mitad del alto).
function New-Pastilla([single]$x, [single]$y, [single]$w, [single]$h) {
  $ruta = New-Object System.Drawing.Drawing2D.GraphicsPath
  $ruta.AddArc($x, $y, $h, $h, 180, 90)
  $ruta.AddArc($x + $w - $h, $y, $h, $h, 270, 90)
  $ruta.AddArc($x + $w - $h, $y, $h, $h, 0, 90)
  $ruta.AddArc($x, $y, $h, $h, 90, 90)
  $ruta.CloseFigure()
  return $ruta
}

# Un icono del POS. Las medidas estan dadas para 512 px y se escalan al lado del icono
# (192 = x0.375).
function New-IconoPos([string]$destino, [int]$lado, [bool]$maskable) {
  $origen = Join-Path $carpeta ($destino -replace '^pos-', 'app-')
  $salida = Join-Path $carpeta $destino
  $base = New-Object System.Drawing.Bitmap $origen
  try {
    if ($base.Width -ne $lado -or $base.Height -ne $lado) { throw "$origen no mide ${lado}x${lado}" }
    $k = $lado / 512.0
    if ($maskable) { $pw = 180 * $k; $ph = 56 * $k; $sep = 14 * $k } else { $pw = 220 * $k; $ph = 72 * $k; $sep = 16 * $k }

    # La marca es lo que no es blanco dentro de la placa. El margen deja fuera el borde
    # redondeado de la placa del icono "any" (el maskable no tiene placa).
    $margen = 0
    if (-not $maskable) { $margen = [int][math]::Round(0.06 * $lado) }
    $caja   = Get-Visible $base $margen
    $anchoM = $caja.X1 - $caja.X0 + 1
    $altoM  = $caja.Y1 - $caja.Y0 + 1
    $arriba = ($lado - ($altoM + $sep + $ph)) / 2          # marca + pastilla, centradas en vertical
    $dx = [int][math]::Round(($lado - $anchoM) / 2 - $caja.X0)
    $dy = [int][math]::Round($arriba - $caja.Y0)           # negativo: la marca sube

    # Rectangulo de la marca con un poco de aire (6 px a 512) para llevarse sus bordes suaves.
    $aire = [int][math]::Round(6 * $k)
    $rx  = [math]::Max($margen, $caja.X0 - $aire)
    $ry  = [math]::Max($margen, $caja.Y0 - $aire)
    $rx2 = [math]::Min($lado - $margen - 1, $caja.X1 + $aire)
    $ry2 = [math]::Min($lado - $margen - 1, $caja.Y1 + $aire)
    $marca = New-Object System.Drawing.Rectangle ([int]$rx), ([int]$ry), ([int]($rx2 - $rx + 1)), ([int]($ry2 - $ry + 1))
    $movida = New-Object System.Drawing.Rectangle ([int]($marca.X + $dx)), ([int]($marca.Y + $dy)), $marca.Width, $marca.Height
    $c = $base.GetPixel($marca.X, $marca.Y)                # color de la placa junto a la marca
    $placa = [System.Drawing.Color]::FromArgb(255, $c.R, $c.G, $c.B)

    $formato = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    if ($maskable) { $formato = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }   # opaco: PNG tipo de color 2
    $bmp = New-Object System.Drawing.Bitmap $lado, $lado, $formato
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      if ($maskable) { $g.Clear($placa) } else { $g.Clear([System.Drawing.Color]::Transparent) }

      $atributos = New-Object System.Drawing.Imaging.ImageAttributes
      $atributos.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
      $todo = New-Object System.Drawing.Rectangle 0, 0, $lado, $lado
      $g.DrawImage($base, $todo, 0, 0, $lado, $lado, [System.Drawing.GraphicsUnit]::Pixel, $atributos)
      # Se borra la marca de donde estaba (la placa es blanco liso) y se vuelve a poner mas arriba.
      $g.FillRectangle((New-Object System.Drawing.SolidBrush $placa), $marca)
      $g.DrawImage($base, $movida, $marca.X, $marca.Y, $marca.Width, $marca.Height, [System.Drawing.GraphicsUnit]::Pixel, $atributos)

      $px = ($lado - $pw) / 2
      $py = $arriba + $altoM + $sep
      $pastilla = New-Pastilla $px $py $pw $ph
      $g.FillPath((New-Object System.Drawing.SolidBrush $azul), $pastilla)

      # "POS" en blanco, centrado en la pastilla. GDI+ centra por la caja de la linea, y la
      # altura de las mayusculas queda un poco mas abajo: se sube 6 % del tamano de la letra.
      $em = [single](0.6 * $ph)
      $fuente = New-Object System.Drawing.Font 'Segoe UI', $em, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
      $centrado = New-Object System.Drawing.StringFormat
      $centrado.Alignment     = [System.Drawing.StringAlignment]::Center
      $centrado.LineAlignment = [System.Drawing.StringAlignment]::Center
      $area = New-Object System.Drawing.RectangleF ([single]$px), ([single]($py - 0.06 * $em)), ([single]$pw), ([single]$ph)
      $g.DrawString('POS', $fuente, [System.Drawing.Brushes]::White, $area, $centrado)
    } finally {
      $g.Dispose()
    }

    # Zona segura del maskable: todo lo dibujado dentro de un circulo de radio 40 % del lado.
    if ($maskable) {
      $medida = Get-Visible $bmp 0
      $limite = 0.4 * $lado
      if ($medida.Radio -gt $limite) { throw ("{0}: lo dibujado llega a {1:N1} px del centro, el limite es {2:N1}" -f $destino, $medida.Radio, $limite) }
      Write-Output ("  zona segura: radio maximo {0:N1} px, limite {1:N1}" -f $medida.Radio, $limite)
    }
    $bmp.Save($salida, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("{0}: {1}x{1}, {2} bytes" -f $destino, $lado, (Get-Item $salida).Length)
  } finally {
    $base.Dispose()
  }
}

New-IconoPos 'pos-192.png' 192 $false
New-IconoPos 'pos-512.png' 512 $false
New-IconoPos 'pos-maskable-512.png' 512 $true
