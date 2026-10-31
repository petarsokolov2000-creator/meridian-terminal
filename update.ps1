# Installs or updates Meridian in one step, no ZIP handling: downloads the newest version
# from GitHub, unpacks it and runs its installer (keys, settings and cache are kept).
# Run it from the Windows Run box (Win+R) with:
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/petarsokolov2000-creator/meridian-terminal/main/update.ps1 | iex"

$ErrorActionPreference = 'Stop'
$repo = 'petarsokolov2000-creator/meridian-terminal'
$tmp = Join-Path $env:TEMP ('meridian-' + [guid]::NewGuid().ToString('N'))
try {
  Write-Host 'Meridian: getting the newest version...' -ForegroundColor Cyan

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Meridian needs Node.js. Install the LTS version from https://nodejs.org, then run this again.' -ForegroundColor Yellow
    Start-Process 'https://nodejs.org/'
    return
  }

  # Stop a Meridian server that is still running (it would block the update).
  try {
    Get-NetTCPConnection -LocalPort 8173 -State Listen -ErrorAction Stop | ForEach-Object {
      $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force; Write-Host 'Stopped the running Meridian.' }
    }
    Start-Sleep -Seconds 1
  } catch {
    # nothing listening: Meridian isn't running
  }

  # GitHub needs TLS 1.2, which older Windows PowerShell leaves off.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'meridian.zip'
  Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$repo/zip/refs/heads/main" -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $src = Get-ChildItem -Path $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'tools\install.mjs') } | Select-Object -First 1
  if (-not $src) { throw 'The download did not contain Meridian.' }

  Push-Location $src.FullName
  try {
    node tools\install.mjs
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0) { throw "The installer stopped (code $code). See the messages above." }
  Write-Host ''
  Write-Host 'Done. Open Meridian from its Desktop icon. Future updates happen by themselves.' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host "Meridian update failed: $_" -ForegroundColor Red
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Read-Host 'Press Enter to close this window'
}
