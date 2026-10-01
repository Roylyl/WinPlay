$ErrorActionPreference='Stop'
$projectDir=Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force "$projectDir/build/native" | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$nativeSource=Join-Path $projectDir 'native\Platform.cs'
$nativeOutput=Join-Path $projectDir 'build\native\WinPlay.Platform.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Security.dll /reference:System.Web.Extensions.dll "/out:$nativeOutput" $nativeSource
if($LASTEXITCODE -ne 0){throw 'Windows平台桥接编译失败'}

& (Join-Path $PSScriptRoot 'build-media.ps1')
