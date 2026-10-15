<#
Install LibreOffice on a Windows server for AMS's PDF export (Download -> PDF, View print preview of Word
templates / samples), then check that the backend can really make a PDF. Part of server set-up:
docs/DEPLOYMENT.md, step 1. Safe to run again: an installed LibreOffice is left as it is.

    powershell -ExecutionPolicy Bypass -File tools\install-libreoffice.ps1          # install if missing + check
    powershell -ExecutionPolicy Bypass -File tools\install-libreoffice.ps1 -Check   # only report

Installs with winget (Windows 10 1809+ / Server 2022+; run as an administrator for a machine-wide
install). Without winget, download the installer from https://www.libreoffice.org/download and run it,
then run this script again with -Check. LibreOffice is free (MPL 2.0) and runs as a separate program;
AMS starts it per conversion (Advocate-app-BE-Django/drafting/export/pdf.py).

Fonts: Windows already has Times New Roman, Arial, Calibri and Nirmala UI (Indian scripts), the fonts
firm templates use. Install any other font a template uses on the server, or LibreOffice substitutes it.
#>
param([switch] $Check)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$be = Join-Path $repo 'Advocate-app-BE-Django'
$envFile = Join-Path $be '.env'
$python = Join-Path $be 'venv\Scripts\python.exe'

function Find-Soffice {
    $candidates = @(
        "$env:ProgramFiles\LibreOffice\program\soffice.exe",
        "${env:ProgramFiles(x86)}\LibreOffice\program\soffice.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    $onPath = Get-Command soffice.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

$soffice = Find-Soffice
if ($soffice) {
    Write-Host "LibreOffice found: $soffice"
} elseif ($Check) {
    Write-Host 'LibreOffice is NOT installed: Download -> PDF and the View print preview will not work.' -ForegroundColor Yellow
    Write-Host 'Run this script without -Check to install it.'
    exit 1
} else {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host 'winget is not available on this machine.' -ForegroundColor Yellow
        Write-Host 'Download LibreOffice from https://www.libreoffice.org/download, install it, then run:'
        Write-Host '    powershell -ExecutionPolicy Bypass -File tools\install-libreoffice.ps1 -Check'
        exit 1
    }
    Write-Host 'Installing LibreOffice (a few minutes)...'
    winget install --id TheDocumentFoundation.LibreOffice --exact --silent --accept-package-agreements --accept-source-agreements
    $soffice = Find-Soffice
    if (-not $soffice) {
        Write-Host 'LibreOffice did not install. See the winget output above.' -ForegroundColor Red
        exit 1
    }
    Write-Host "LibreOffice installed: $soffice"
}

# Not in the standard place: tell the backend where it is (LIBREOFFICE_PATH in .env).
$standard = @("$env:ProgramFiles\LibreOffice\program\soffice.exe", "${env:ProgramFiles(x86)}\LibreOffice\program\soffice.exe")
if ((Test-Path $envFile) -and ($standard -notcontains $soffice)) {
    $lines = Get-Content $envFile
    if ($lines -match '^\s*LIBREOFFICE_PATH\s*=') {
        $lines = $lines -replace '^\s*LIBREOFFICE_PATH\s*=.*$', "LIBREOFFICE_PATH=$soffice"
    } else {
        $lines += "LIBREOFFICE_PATH=$soffice"
    }
    Set-Content -Path $envFile -Value $lines -Encoding utf8
    Write-Host "Set LIBREOFFICE_PATH in $envFile"
}

# The real test: the backend makes a PDF with it.
if (Test-Path $python) {
    Push-Location $be
    try {
        & $python manage.py check_pdf_export
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally { Pop-Location }
} else {
    Write-Host "Backend venv not set up yet ($python). After step 5 of docs/DEPLOYMENT.md run:"
    Write-Host '    venv\Scripts\python.exe manage.py check_pdf_export'
}
