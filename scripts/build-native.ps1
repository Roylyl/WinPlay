$ErrorActionPreference='Stop'
$projectDir=Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force "$projectDir/build/native" | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$nativeSource=Join-Path $projectDir 'native\Platform.cs'
$nativeOutput=Join-Path $projectDir 'build\native\WinPlay.Platform.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Security.dll /reference:System.Web.Extensions.dll "/out:$nativeOutput" $nativeSource (Join-Path $projectDir 'native\Wlan.cs')
if($LASTEXITCODE -ne 0){throw 'Windows平台桥接编译失败'}

& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$projectDir\build\native\WinPlay.UsbMdns.exe" (Join-Path $projectDir 'native\usb\usb-mdns.cs')
if($LASTEXITCODE -ne 0){throw 'Windows USB组播桥接编译失败'}

if(!(Get-Command cl.exe -ErrorAction SilentlyContinue) -or $env:VSCMD_ARG_TGT_ARCH -ne 'x64'){
 $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
 if(!(Test-Path -LiteralPath $vswhere)){throw '请安装带有MSVC x64和Windows SDK的Visual Studio Build Tools'}
 $install=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
 if(!$install){throw '未找到包含MSVC x64的Visual Studio Build Tools'}
 $env:WINPLAY_VS_SETUP=Join-Path $install 'Common7\Tools\VsDevCmd.bat'
}
try{
 & (Join-Path $PSScriptRoot 'build-wired.cmd')
 if($LASTEXITCODE -ne 0){throw 'Windows有线CarPlay助手编译失败'}
}finally{
 Remove-Item Env:WINPLAY_VS_SETUP -ErrorAction SilentlyContinue
}

& (Join-Path $PSScriptRoot 'build-media.ps1')
