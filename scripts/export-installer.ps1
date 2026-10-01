# SPDX-License-Identifier: GPL-3.0-or-later
# npm's postdist hook runs only after a successful installer build.
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageInfo = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$artifactName = 'WinPlay-' + $packageInfo.version + '-Setup-x64.exe'
$artifactPath = Join-Path $projectRoot ('dist/' + $artifactName)
if (!(Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw 'Installer was not generated; desktop export aborted' }
$startupCheck = Join-Path $projectRoot 'scripts/check-installer-startup.cjs'
& (Join-Path $projectRoot 'resources/node/node.exe') $startupCheck $artifactPath
if ($LASTEXITCODE -ne 0) { throw 'Installer startup setting check failed; desktop export aborted' }
$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if (!$desktopPath -or !(Test-Path -LiteralPath $desktopPath -PathType Container)) { throw 'Windows desktop directory is unavailable' }
$destinationPath = Join-Path $desktopPath $artifactName
Copy-Item -LiteralPath $artifactPath -Destination $destinationPath -Force
Write-Output ('EXE installer exported to desktop: ' + $destinationPath)

& (Join-Path $PSScriptRoot 'uninstall-test-installation.ps1')
