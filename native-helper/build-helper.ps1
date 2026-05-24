$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "dist\CodexDockHelper"
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
$args = @(
  "/nologo",
  "/target:winexe",
  "/optimize+",
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
