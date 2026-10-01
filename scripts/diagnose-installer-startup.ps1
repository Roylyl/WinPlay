# Read-only Windows Defender performance diagnosis for the desktop WinPlay installer.
# Run only after the user authorizes administrator profiling. Does not install WinPlay,
# change antivirus settings, add exclusions, or touch user configuration.
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator permission is required for Windows Defender performance recording.'}
$desktopPath=[Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$installerPath=Join-Path $desktopPath 'WinPlay-1.1.0-Setup-x64.exe'
if(!(Test-Path -LiteralPath $installerPath -PathType Leaf)){throw 'Desktop installer was not found.'}
$outputFolder=Join-Path $env:TEMP 'WinPlay-installer-diagnosis'
New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
trap { $_.Exception.Message | Set-Content -LiteralPath (Join-Path $env:TEMP 'WinPlay-installer-diagnosis/error.txt') -Encoding utf8; exit 1 }
$tracePath=Join-Path $outputFolder 'startup.etl'
$reportPath=Join-Path $outputFolder 'report.txt'
$launchJob=Start-Job -ArgumentList $installerPath,$outputFolder -ScriptBlock {
 param($installer,$outputFolder)
 Start-Sleep -Seconds 2
 $testInstaller=Join-Path $outputFolder ('WinPlay-test-'+[Guid]::NewGuid().ToString('N')+'.exe')
 $copyTimer=[Diagnostics.Stopwatch]::StartNew()
 Copy-Item -LiteralPath $installer -Destination $testInstaller
 $copyTimer.Stop()
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $process=Start-Process -FilePath $testInstaller -WindowStyle Hidden -PassThru
 try {$ready=$process.WaitForInputIdle(25000);$timer.Stop();[pscustomobject]@{InputIdle=$ready;ElapsedMilliseconds=$timer.ElapsedMilliseconds;CopyMilliseconds=$copyTimer.ElapsedMilliseconds;Scope='Temporary unmodified installer copy; no installation'}} finally {if(!$process.HasExited){Stop-Process -Id $process.Id}}
}
try {
 New-MpPerformanceRecording -RecordTo $tracePath -Seconds 30 -ErrorAction Stop
 Wait-Job -Job $launchJob -Timeout 35 | Out-Null
 Receive-Job -Job $launchJob | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputFolder 'startup.json') -Encoding utf8
 $report=Get-MpPerformanceReport -Path $tracePath -TopProcesses 10 -TopFiles 20 -TopScansPerFile 3
 $report | Out-String -Width 220 | Set-Content -LiteralPath $reportPath -Encoding utf8
 $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $outputFolder 'report.json') -Encoding utf8
 'Complete' | Set-Content -LiteralPath (Join-Path $outputFolder 'complete.txt') -Encoding utf8
 Write-Output ('Diagnosis saved to: '+$outputFolder)
} finally {Stop-Job -Job $launchJob -ErrorAction SilentlyContinue;Remove-Job -Job $launchJob -Force -ErrorAction SilentlyContinue}
