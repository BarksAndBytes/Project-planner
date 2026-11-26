<#
.SYNOPSIS
  Signs an unsigned Work Dashboard release APK with your offline key.
.EXAMPLE
  .\scripts\sign-android.ps1 -Apk .\app-universal-release-unsigned.apk
.NOTES
  Needs Android SDK build-tools (zipalign, apksigner) and ANDROID_HOME set.
  The keystore stays on your computer; see docs/SIGNING.md.
#>
param(
  [Parameter(Mandatory = $true)][string]$Apk,
  [string]$Keystore = "$HOME\work-dashboard-keys\work-dashboard-release.jks",
  [string]$Alias = "work-dashboard"
)
$ErrorActionPreference = "Stop"

if (-not $env:ANDROID_HOME) { throw "Set ANDROID_HOME to your Android SDK folder." }
if (-not (Test-Path $Keystore)) { throw "Keystore not found: $Keystore" }

$bt = Get-ChildItem (Join-Path $env:ANDROID_HOME "build-tools") -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $bt) { throw "No Android build-tools found under $env:ANDROID_HOME\build-tools." }

$zipalign  = Join-Path $bt.FullName "zipalign.exe"
$apksigner = Join-Path $bt.FullName "apksigner.bat"
$Apk       = (Resolve-Path $Apk).Path
$aligned   = $Apk -replace '\.apk$', '-aligned.apk'
$signed    = ($Apk -replace '-unsigned', '') -replace '\.apk$', '-signed.apk'

& $zipalign -f -p 4 $Apk $aligned
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }
& $apksigner sign --ks $Keystore --ks-key-alias $Alias --out $signed $aligned
if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed" }
& $apksigner verify --verbose --print-certs $signed
if ($LASTEXITCODE -ne 0) { throw "signature verification failed" }
Remove-Item $aligned

$hash = (Get-FileHash $signed -Algorithm SHA256).Hash.ToLower()
Write-Host ""
Write-Host "Signed: $signed"
Write-Host "SHA-256: $hash"
