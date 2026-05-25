param(
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = if ([string]::IsNullOrWhiteSpace($OutDir)) {
  Join-Path $root "dist\CodexDockHelper"
} elseif ([System.IO.Path]::IsPathRooted($OutDir)) {
  $OutDir
} else {
  Join-Path $root $OutDir
}
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$wpfRefDir = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF"
if (!(Test-Path $csc)) {
  $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  $wpfRefDir = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\WPF"
}
if (!(Test-Path $csc)) {
  throw "未找到 .NET Framework C# 编译器 csc.exe"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$exe = Join-Path $outDir "CodexDockHelper.exe"
$source = Join-Path $PSScriptRoot "CodexPlusLocalHelper.cs"
$iconPath = Join-Path $outDir "CodexDockHelper.ico"

Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::new(64, 64)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$top = [System.Drawing.Drawing2D.GraphicsPath]::new()
$top.AddArc(11, 13, 8, 8, 180, 90)
$top.AddArc(45, 13, 8, 8, 270, 90)
$top.AddArc(45, 21, 8, 8, 0, 90)
$top.AddArc(11, 21, 8, 8, 90, 90)
$top.CloseFigure()
$bottom = [System.Drawing.Drawing2D.GraphicsPath]::new()
$bottom.AddArc(11, 35, 8, 8, 180, 90)
$bottom.AddArc(45, 35, 8, 8, 270, 90)
$bottom.AddArc(45, 43, 8, 8, 0, 90)
$bottom.AddArc(11, 43, 8, 8, 90, 90)
$bottom.CloseFigure()
$stroke = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(35, 44, 51), 4)
$stroke.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$dot = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(20, 181, 141))
$graphics.DrawPath($stroke, $top)
$graphics.DrawPath($stroke, $bottom)
$graphics.FillEllipse($dot, 18, 19, 5, 5)
$graphics.FillEllipse($dot, 18, 41, 5, 5)
$hIcon = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
try {
  $icon.Save($stream)
} finally {
  $stream.Dispose()
  $dot.Dispose()
  $stroke.Dispose()
  $bottom.Dispose()
  $top.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$args = @(
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/win32icon:$iconPath",
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.Management.dll",
  "/reference:System.Windows.Forms.dll",
  "/out:$exe",
  $source
)
& $csc @args
if ($LASTEXITCODE -ne 0) {
  throw "C# 编译失败，退出码 $LASTEXITCODE"
}

if ($env:BUILD_CODEX_PROXY -eq "1") {
  $proxyExe = Join-Path $outDir "CodexAppServerProxy.exe"
  $proxySource = Join-Path $PSScriptRoot "CodexAppServerProxy.cs"
  $proxyArgs = @(
    "/nologo",
    "/target:exe",
    "/optimize+",
    "/reference:System.dll",
    "/reference:System.Core.dll",
    "/out:$proxyExe",
    $proxySource
  )
  & $csc @proxyArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "CodexAppServerProxy.exe 当前可能被 Codex 占用，已跳过代理更新。退出码 $LASTEXITCODE"
  } else {
    Write-Host "Built: $proxyExe"
  }
}

Copy-Item -Force (Join-Path $root "README.md") $outDir

foreach ($obsolete in @("index.html", "app.js", "styles.css", "server.js", "start-local-helper.ps1")) {
  $old = Join-Path $outDir $obsolete
  if (Test-Path $old) {
    Remove-Item -LiteralPath $old -Force
  }
}

Write-Host "Built: $exe"
