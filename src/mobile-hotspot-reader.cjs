// SPDX-License-Identifier: GPL-3.0-or-later
const {execFile}=require('node:child_process');

// This reads Windows' own Mobile Hotspot configuration, including while Off.
// Configuration and credentials are captured in memory, never written to a log.
const configurationScript=String.raw`
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$failure='';$selected=$null;$activeSeen=$false
try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 [void][Windows.Networking.Connectivity.NetworkInformation,Windows,ContentType=WindowsRuntime]
 [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows,ContentType=WindowsRuntime]
 function Read-Configuration($manager,$state){
  $configuration=$manager.GetCurrentAccessPointConfiguration()
  if([string]::IsNullOrEmpty($configuration.Ssid)){return $null}
  $value=@{ok=$true;ssid=[string]$configuration.Ssid;state=$state}
  try{if(-not [string]::IsNullOrEmpty($configuration.Passphrase)){$value.password=[string]$configuration.Passphrase}}catch{}
  return $value
 }
 $profiles=@([Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles())
 $preferred=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
 if($preferred){$profiles=@($preferred)+$profiles}
 $fallback=@()
 foreach($profile in $profiles){
  try {
   $manager=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
   $state=[string]$manager.TetheringOperationalState
   if($state -eq 'On'){$activeSeen=$true;$selected=Read-Configuration $manager $state;if($selected){break}}
   else{$fallback+=@{manager=$manager;state=$state}}
  }catch{if(-not $failure){$failure='TETHERING/'+$_.Exception.HResult}}
 }
 if(-not $selected -and -not $activeSeen){
  foreach($candidate in $fallback){
   try{$selected=Read-Configuration $candidate.manager $candidate.state;if($selected){break}}catch{if(-not $failure){$failure='TETHERING/'+$_.Exception.HResult}}
  }
 }
}catch{$failure='TETHERING/'+$_.Exception.HResult}
if($selected){$selected.activeSeen=$activeSeen;$selected | ConvertTo-Json -Compress}else{@{ok=$false;code=if($failure){$failure}else{'HOTSPOT_CONFIGURATION_UNAVAILABLE'}} | ConvertTo-Json -Compress}
`;

function parseHotspotConfiguration(output,error){
 const failure={ok:false,error:'无法读取Windows移动热点配置，请在系统设置中核对热点名称和密码'};
 if(error)return {...failure,code:typeof error.code==='number'?error.code:'HOTSPOT_CONFIGURATION_UNAVAILABLE'};
 try{
  const value=JSON.parse(String(output)),ssid=value.ssid;
  if(value.ok!==true||typeof ssid!=='string'||!ssid||ssid.includes('\0')||Buffer.byteLength(ssid)>32||value.activeSeen===true&&value.state!=='On')return {...failure,code:/^(?:TETHERING\/-?\d+|HOTSPOT_CONFIGURATION_UNAVAILABLE)$/.test(value.code)?value.code:'HOTSPOT_CONFIGURATION_UNAVAILABLE'};
  const password=typeof value.password==='string'&&value.password&&!value.password.includes('\0')?value.password:undefined;
  return {ok:true,ssid,...(password!==undefined?{password}:{}),state:['On','Off','Unknown','InTransition'].includes(value.state)?value.state:'Unknown'};
 }catch{return {...failure,code:'HOTSPOT_CONFIGURATION_UNAVAILABLE'}}
}

function readHotspotConfiguration(){
 return new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',configurationScript],{windowsHide:true,timeout:10000,maxBuffer:1024*1024,encoding:'utf8'},(error,output)=>resolve(parseHotspotConfiguration(output,error))));
}
module.exports={readHotspotConfiguration,parseHotspotConfiguration};
