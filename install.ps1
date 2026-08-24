#requires -Version 5.1
<#
.SYNOPSIS
  Install the latest agenv release bundle and put `agenv` on the user PATH.
.EXAMPLE
  irm https://raw.githubusercontent.com/Utkarshchaudhary009/dotfiles/main/install.ps1 | iex
#>
[CmdletBinding()]
param(
  [string]$Repo = 'Utkarshchaudhary009/dotfiles',
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\agenv"
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js >= 18 is required but was not found on PATH.'
}

Write-Host "Fetching latest release of $Repo..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
  -Headers @{ 'User-Agent' = 'agenv-installer' }
$asset = $release.assets | Where-Object { $_.name -eq 'agenv.js' } | Select-Object -First 1
if (-not $asset) {
  throw "No agenv.js asset found in release $($release.tag_name)."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$bundlePath = Join-Path $InstallDir 'agenv.js'
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $bundlePath `
  -Headers @{ 'User-Agent' = 'agenv-installer' }

# .cmd shim so the bare directory on PATH works regardless of .js file association
$shimPath = Join-Path $InstallDir 'agenv.cmd'
Set-Content -Path $shimPath -Encoding Ascii -Value "@echo off`r`nnode `"%~dp0agenv.js`" %*"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $InstallDir) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
  Write-Host "Added $InstallDir to your user PATH."
}

Write-Host "Installed agenv $($release.tag_name) to $InstallDir."
Write-Host 'Open a NEW terminal, then run: agenv --version'
