# SPDX-License-Identifier: GPL-3.0-or-later
$ErrorActionPreference='Stop'
$projectDir=Split-Path $PSScriptRoot -Parent
$refDir=Join-Path $projectDir 'tools/net48-reference/build/.NETFramework/v4.8'
if (!(Test-Path (Join-Path $refDir 'Facades/System.Runtime.dll'))) {
 $referenceZip=Join-Path ([IO.Path]::GetTempPath()) 'WinPlay-net48-reference.zip'
 Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/microsoft.netframework.referenceassemblies.net48/1.0.3/microsoft.netframework.referenceassemblies.net48.1.0.3.nupkg' -OutFile $referenceZip
 Expand-Archive -LiteralPath $referenceZip -DestinationPath (Join-Path $projectDir 'tools/net48-reference') -Force
}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$mediaSource=Join-Path $projectDir 'native/MediaBridge.cs'
$mediaOutput=Join-Path $projectDir 'build/native/WinPlay.Media.exe'
$metadata=Join-Path $env:WINDIR 'System32/WinMetadata'
& $compiler /nologo /nowarn:1701 /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll "/reference:$metadata/Windows.Media.winmd" "/reference:$metadata/Windows.Foundation.winmd" "/reference:$metadata/Windows.Storage.winmd" "/reference:$refDir/Facades/System.Runtime.dll" "/reference:$refDir/Facades/System.Collections.dll" "/reference:$refDir/Facades/System.Runtime.InteropServices.WindowsRuntime.dll" "/win32icon:$projectDir/resources/icons/winplay.ico" "/out:$mediaOutput" $mediaSource
if($LASTEXITCODE -ne 0){throw 'Windows系统媒体桥接编译失败'}
