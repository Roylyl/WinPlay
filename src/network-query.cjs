// Independent, bounded Windows queries: a stuck hotspot provider must not erase
// adapter information or prevent an existing LAN connection from being used.
const {execFile}=require('node:child_process');
const prelude=String.raw`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
function Emit($value){[Console]::WriteLine(($value|ConvertTo-Json -Depth 5 -Compress));[Console]::Out.Flush()}
`;
const scripts={
 adapters:prelude+String.raw`
try{
 $basic=@([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object {
  $nic=$_;$gateway=$false
  try{$gateway=@($nic.GetIPProperties().GatewayAddresses | Where-Object {$_.Address.ToString() -ne '0.0.0.0' -and $_.Address.ToString() -ne '::'}).Count -gt 0}catch{}
  @{name=$nic.Name;description=$nic.Description;guid=$nic.Id;up=($nic.OperationalStatus -eq 'Up');wireless=($nic.NetworkInterfaceType -eq 'Wireless80211');lanCandidate=($nic.NetworkInterfaceType -eq 'Wireless80211' -or $nic.NetworkInterfaceType -eq 'Ethernet');defaultRoute=$gateway}
 })
 Emit @{adapters=$basic;adapterSource='dotnet';adapterPhase='netadapter'}
}catch{Emit @{adapterError='DOTNET/'+$_.Exception.HResult}}
try{
 $adapters=@(Get-NetAdapter -IncludeHidden -ErrorAction Stop | ForEach-Object {
  $adapter=$_;$basicItem=$basic | Where-Object {$_.guid.Trim('{}') -eq ([string]$adapter.InterfaceGuid).Trim('{}')} | Select-Object -First 1
  @{name=$adapter.Name;description=$adapter.InterfaceDescription;physical=[bool]$adapter.HardwareInterface;interfaceIndex=$adapter.InterfaceIndex;guid=[string]$adapter.InterfaceGuid;up=($adapter.InterfaceOperationalStatus -eq 1);wireless=($adapter.NdisPhysicalMedium -eq 9 -or $adapter.NdisPhysicalMedium -eq 1);defaultRoute=($basicItem.defaultRoute -eq $true)}
 })
 if($adapters.Count -gt 0){Emit @{adapters=$adapters;adapterSource='netadapter';adapterPhase='routes'}}
}catch{Emit @{adapterError='NETADAPTER/'+$_.Exception.HResult}}
if($adapters.Count -gt 0){
 try{
  $interfaces=@(Get-NetIPInterface -ErrorAction Stop);$defaults=@(Get-NetRoute -ErrorAction Stop | Where-Object {$_.DestinationPrefix -eq '0.0.0.0/0' -or $_.DestinationPrefix -eq '::/0'})
  foreach($adapter in $adapters){
   $index=$adapter.interfaceIndex;$best=$null
   foreach($route in $defaults){
    if($route.InterfaceIndex -ne $index){continue}
    $interface=$interfaces | Where-Object {$_.InterfaceIndex -eq $index -and $_.AddressFamily -eq $route.AddressFamily} | Select-Object -First 1
    $metric=[long]$route.RouteMetric+[long]$interface.InterfaceMetric
    if($null -eq $best -or $metric -lt $best){$best=$metric}
   }
   $adapter.defaultRoute=($null -ne $best);$adapter.routeMetric=$best
  }
  Emit @{adapters=$adapters;adapterSource='netadapter';adapterPhase='complete'}
 }catch{Emit @{adapterError='ROUTES/'+$_.Exception.HResult}}
}

`,
 tethering:prelude+String.raw`
$tetheringStates=@();$tetheringFailures=0;$tetheringError=''
try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 [void][Windows.Networking.Connectivity.NetworkInformation,Windows,ContentType=WindowsRuntime]
 [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows,ContentType=WindowsRuntime]
 $profiles=@([Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles())
 $preferred=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
 if($preferred){$profiles=@($preferred)+$profiles}
 foreach($profile in $profiles){
  try {
   if([string]$profile.GetNetworkConnectivityLevel() -eq 'None'){continue}
   $manager=[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
   $state=[string]$manager.TetheringOperationalState;$tetheringStates+=$state
   if($state -eq 'On'){break}
  }catch{$tetheringFailures++;if(-not $tetheringError){$tetheringError='TETHERING/'+$_.Exception.HResult}}
 }
}catch{$tetheringFailures++;$tetheringError='TETHERING/'+$_.Exception.HResult}

Emit @{tetheringStates=$tetheringStates;tetheringFailures=$tetheringFailures;tetheringError=$tetheringError}
`,
 sharing:prelude+String.raw`
$private=@();$public=@();$privateIds=@();$publicIds=@();$sharingAvailable=$false;$sharingError=''
try{
 $sharing=New-Object -ComObject HNetCfg.HNetShare
 foreach($connection in $sharing.EnumEveryConnection){
  $configuration=$sharing.INetSharingConfigurationForINetConnection($connection)
  if(-not $configuration.SharingEnabled){continue}
  $properties=$sharing.NetConnectionProps($connection)
  if($configuration.SharingConnectionType -eq 1){$private+=$properties.Name;$privateIds+=[string]$properties.Guid}else{$public+=$properties.Name;$publicIds+=[string]$properties.Guid}
 }
 $sharingAvailable=$true
}catch{$sharingError='ICS/'+$_.Exception.HResult}
Emit @{privateNames=$private;publicNames=$public;privateIds=$privateIds;publicIds=$publicIds;sharingAvailable=$sharingAvailable;sharingError=$sharingError}
`
};

function queryStage(stage,{timeoutMs,signal},execute=execFile,now=Date.now){
 return new Promise(resolve=>{
  const started=now();
  execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',scripts[stage]],{windowsHide:true,timeout:Math.max(1,timeoutMs),maxBuffer:1024*1024,signal},(error,out='')=>{
   const value={};let records=0;
   // execFile retains stdout even if the process is terminated at the deadline.
   // Read complete JSON records only; never log raw stdout/stderr or exception text.
   for(const line of String(out).replace(/^\uFEFF/,'').split(/\r?\n/)){
    try{const record=JSON.parse(line);if(record&&typeof record==='object'&&!Array.isArray(record)){Object.assign(value,record);records++}}catch{}
   }
   const code=signal?.aborted?'CANCELLED':error?.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'OUTPUT_LIMIT':error?.killed?(now()-started>=timeoutMs?'TIMEOUT':'TERMINATED'):error?typeof error.code==='number'?'EXIT_'+error.code:typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'PROCESS_FAILED':records?'OK':'INVALID_OUTPUT';
   const providerCode=value.adapterError||value.tetheringError||value.sharingError;
   resolve({value,diagnostic:{stage,code,elapsedMs:now()-started,records,...(providerCode&&/^[A-Z]+\/-?\d+$/.test(providerCode)?{providerCode}:{}),...(stage==='adapters'&&['dotnet','netadapter'].includes(value.adapterSource)?{source:value.adapterSource}:{}),...(stage==='adapters'&&['netadapter','routes','complete'].includes(value.adapterPhase)?{phase:value.adapterPhase}:{})}});
  });
 });
}
function createMetadataReader(execute=execFile,now=Date.now){
 return async function readNetworkMetadata({timeoutMs=8000,mode,signal}={}){
  const stages=mode==='lan'?['adapters']:['adapters','tethering','sharing'];
  const results=await Promise.all(stages.map(stage=>queryStage(stage,{timeoutMs:Math.min(4000,timeoutMs),signal},execute,now)));
  const metadata=Object.assign({},...results.map(result=>result.value));
  const normalize=id=>String(id).replace(/[{}]/g,'').toLowerCase();
  for(const role of ['private','public']){
   const ids=new Set((metadata[role+'Ids']||[]).map(normalize));
   metadata[role+'Names']=[...new Set([...(metadata[role+'Names']||[]),...(metadata.adapters||[]).filter(a=>ids.has(normalize(a.guid))).map(a=>a.name)])];
  }
  metadata.queryFailed=!Array.isArray(metadata.adapters);
  metadata.queries=results.map(result=>result.diagnostic);
  const byStage=Object.fromEntries(results.map(result=>[result.diagnostic.stage,result.diagnostic]));
  if(byStage.sharing?.code!=='OK'&&byStage.sharing)metadata.sharingError='SHARING_'+byStage.sharing.code;
  if(byStage.tethering?.code!=='OK'&&byStage.tethering)metadata.tetheringError='TETHERING_'+byStage.tethering.code;
  return metadata;
 };
}
module.exports={createMetadataReader,readNetworkMetadata:createMetadataReader()};
