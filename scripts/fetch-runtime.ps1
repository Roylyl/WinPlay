$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$runtimeDir=Join-Path $projectRoot 'resources/node'
New-Item -ItemType Directory -Force $runtimeDir | Out-Null
$version='24.19.0'
Invoke-WebRequest "https://nodejs.org/dist/v$version/win-x64/node.exe" -OutFile (Join-Path $runtimeDir 'node.exe')
Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/v$version/LICENSE" -OutFile (Join-Path $projectRoot 'resources/node-LICENSE')
& (Join-Path $runtimeDir 'node.exe') --version
if($LASTEXITCODE -ne 0){throw 'Node.js运行时验证失败'}
