# SPDX-License-Identifier: GPL-3.0-or-later
param([Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9+/=]+$')][string]$Request)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$script:stage='initialization'
function New-Value($Kind,$Data) {
    [pscustomobject]@{ Kind=$Kind; Data=$Data }
}
function Equal-Value($A,$B) {
    if ($A.Kind -cne $B.Kind) { return $false }
    if ($A.Kind -eq 'Absent') { return $true }
    $x=@($A.Data); $y=@($B.Data)
    if ($x.Count -ne $y.Count) { return $false }
    for ($i=0; $i -lt $x.Count; $i++) {
        if (-not [string]::Equals([string]$x[$i],[string]$y[$i],[StringComparison]::Ordinal)) { return $false }
    }
    return $true
}
function Read-Value([string]$Path,[string]$Name,[string]$Kind) {
    $script:stage="read-$Name"
    $key=$machine.OpenSubKey($Path)
    if (!$key) { throw "Required registry key for $Name is missing." }
    try {
        if ($key.GetValueNames() -notcontains $Name) { return New-Value 'Absent' $null }
        if ($key.GetValueKind($Name).ToString() -cne $Kind) { throw "Unexpected registry type for $Name." }
        return New-Value $Kind ($key.GetValue($Name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames))
    } finally { $key.Dispose() }
}
function Write-Value([string]$Path,[string]$Name,$Value) {
    $script:stage="write-$Name"
    $key=$machine.OpenSubKey($Path,$true)
    if (!$key) { throw "Required registry key for $Name cannot be opened for writing." }
    try {
        switch ($Value.Kind) {
            'Absent' { $key.DeleteValue($Name,$false) }
            'Binary' { $key.SetValue($Name,[byte[]]@($Value.Data),[Microsoft.Win32.RegistryValueKind]::Binary) }
            'MultiString' { $key.SetValue($Name,[string[]]@($Value.Data),[Microsoft.Win32.RegistryValueKind]::MultiString) }
            'DWord' { $key.SetValue($Name,[int]$Value.Data,[Microsoft.Win32.RegistryValueKind]::DWord) }
            default { throw 'Unexpected registry value type.' }
        }
        $key.Flush()
    } finally { $key.Dispose() }
}
function Driver-Of([string]$Instance) {
    $script:stage='parent-driver'
    $key=$machine.OpenSubKey(('SYSTEM\CurrentControlSet\Enum\'+$Instance))
    if (!$key) { throw 'The persistent phone instance registry key is unavailable.' }
    try {
        if ($key.GetValue('Service') -ine 'usbccgp') { throw 'The original composite parent driver is not bound.' }
        $driver=[string]$key.GetValue('Driver')
        if ($driver -notmatch '^\{[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\}\\\d{4}$') { throw 'Invalid parent software key.' }
        return $driver
    } finally { $key.Dispose() }
}
function Initialize-OwnerCheck {
    if ('PinnedUsb.DriverOwner' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace PinnedUsb {
 public static class DriverOwner {
    [StructLayout(LayoutKind.Sequential)] struct Dev {public int size; public Guid cls; public uint instance; public UIntPtr reserved;}
    [DllImport("setupapi.dll", ExactSpelling=true, SetLastError=true)]
    static extern IntPtr SetupDiGetClassDevsW(IntPtr cls, IntPtr enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll", ExactSpelling=true, SetLastError=true)]
    static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref Dev dev);
    [DllImport("setupapi.dll", ExactSpelling=true, SetLastError=true)]
    static extern bool SetupDiGetDeviceRegistryPropertyW(IntPtr set,ref Dev dev,uint property,out uint type,[Out] byte[] data,uint size,out uint required);
    [DllImport("setupapi.dll", ExactSpelling=true, CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set,ref Dev dev,StringBuilder id,uint capacity,out uint required);
    [DllImport("setupapi.dll", ExactSpelling=true)] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    // Enumerate installed device records, including disconnected instances; no device handles or USB requests.
    public static string Check(string driver,string expected) {
      IntPtr set=SetupDiGetClassDevsW(IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,4); // DIGCF_ALLCLASSES, no DIGCF_PRESENT
      if(set==new IntPtr(-1))return "enumeration-start-"+Marshal.GetLastWin32Error();
      try {
        bool found=false; byte[] data=new byte[2048];
        for(uint i=0;;i++) {
          Dev d=new Dev(); d.size=Marshal.SizeOf(typeof(Dev));
          if(!SetupDiEnumDeviceInfo(set,i,ref d)) {
            int err=Marshal.GetLastWin32Error();
            if(err!=259)return "enumeration-"+err;
            break;
          }
          uint regType,size;
          if(!SetupDiGetDeviceRegistryPropertyW(set,ref d,9,out regType,data,(uint)data.Length,out size)) {
            int err=Marshal.GetLastWin32Error();
            if(err==13)continue; // SPDRP_DRIVER absent on an unassigned device.
            return "driver-property-"+err;
          }
          if(regType!=1 || size>data.Length || size<2 || (size & 1)!=0)return "driver-property-format";
          string bound=Encoding.Unicode.GetString(data,0,(int)size).TrimEnd('\0');
          if(!String.Equals(bound,driver,StringComparison.OrdinalIgnoreCase))continue;
          StringBuilder id=new StringBuilder(512);
          if(!SetupDiGetDeviceInstanceIdW(set,ref d,id,(uint)id.Capacity,out size))return "instance-id-"+Marshal.GetLastWin32Error();
          if(!String.Equals(id.ToString(),expected,StringComparison.OrdinalIgnoreCase) || found)return "shared-software-key";
          found=true;
        }
        return found?"ok":"no-pinned-owner";
      } finally { SetupDiDestroyDeviceInfoList(set); }
    }
 }
}
'@
}
function Assert-SoleOwner([string]$Driver,[string]$Instance,[switch]$AllowUnowned) {
    $script:stage='software-key-ownership'
    Initialize-OwnerCheck
    $result=[PinnedUsb.DriverOwner]::Check($Driver,$Instance)
    if ($AllowUnowned -and $result -ceq 'no-pinned-owner') { return }
    if ($result -cne 'ok') { throw ('owner-check '+$result) }
}

function Slots([string]$Instance,[string]$Driver) {
    $parent='SYSTEM\CurrentControlSet\Enum\'+$Instance
    @(
        @{ Name='LowerFilters'; Kind='MultiString'; Path=$parent }
        @{ Name='EnumeratorClass'; Kind='Binary'; Path=('SYSTEM\CurrentControlSet\Control\Class\'+$Driver) }
        @{ Name='OriginalConfigurationValue'; Kind='DWord'; Path=($parent+'\Device Parameters') }
        @{ Name='AltConfigurationValue'; Kind='DWord'; Path=($parent+'\Device Parameters') }
    )
}
function Save-Record($Record,[bool]$Initial) {
    $script:stage='save-restore-record'
    $json=ConvertTo-Json -InputObject $Record -Depth 8 -Compress
    $bytes=[Text.Encoding]::UTF8.GetBytes($json)
    $blob=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $tmp=$StatePath+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    try {
        $out=[IO.File]::Open($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $out.Write($blob,0,$blob.Length); $out.Flush($true) } finally { $out.Dispose() }
        if ($Initial) { [IO.File]::Move($tmp,$StatePath) }
        else { [IO.File]::Replace($tmp,$StatePath,[System.Management.Automation.Language.NullString]::Value) }
    } finally {
        if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) }
        [Array]::Clear($bytes,0,$bytes.Length)
    }
}
function Read-Record {
    $script:stage='load-restore-record'
    $file=[IO.FileInfo]::new($StatePath)
    if (!$file.Exists -or $file.Length -gt 131072) { throw 'Valid original restore record required.' }
    $bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($StatePath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json) } finally { [Array]::Clear($bytes,0,$bytes.Length) }
}

function SnapshotUsb {
    $json=& $reader --parent-instance $id 2>$null
    if($LASTEXITCODE -ne 0){throw 'usb-snapshot'}
    return ($json | ConvertFrom-Json)
}
function ConfigValue($snapshot,[int]$index) {
    if($index -ge $snapshot.configurations.Count){return 0}
    return [Convert]::ToInt32($snapshot.configurations[$index].Substring(10,2),16)
}
function Wait-ForConfiguration([int]$Value) {
    $limit=[DateTime]::UtcNow.AddSeconds(12)
    do {
        try {
            $snapshot=SnapshotUsb
            if($snapshot.activeValue -eq $Value){return $snapshot}
        } catch{}
        Start-Sleep -Milliseconds 400
    }while([DateTime]::UtcNow -lt $limit)
    throw 'usb-enumeration-timeout'
}
function Set-OwnedValue([int]$index,$wanted) {
    $entry=$record.Entries[$index];$slot=$settings[$index]
    if((Driver-Of $id) -ine $record.Driver){throw 'parent-driver-changed'}
    if($index -eq 1){Assert-SoleOwner $record.Driver $id}
    $current=Read-Value $slot.Path $slot.Name $slot.Kind
    if(Equal-Value $current $wanted){return}
    if(@($entry.Writes|Where-Object {Equal-Value $_ $current}).Count -eq 0 -and !(Equal-Value $current $entry.Original)){throw ('external-change-'+$slot.Name)}
    $entry.Writes=@($entry.Writes)+@($wanted)
    Save-Record $record $false
    Write-Value $slot.Path $slot.Name $wanted
    if(!(Equal-Value (Read-Value $slot.Path $slot.Name $slot.Kind) $wanted)){throw ('write-readback-'+$slot.Name)}
}
function Restore-OwnedValues {
    if((Driver-Of $id) -ine $record.Driver){throw 'parent-driver-changed-before-restore'}
    $conflicts=@()
    foreach($i in 3,2,1,0){
        $entry=$record.Entries[$i];$slot=$settings[$i]
        if(!@($entry.Writes).Count){continue}
        try {
            if($i -eq 1){Assert-SoleOwner $record.Driver $id}
            $current=Read-Value $slot.Path $slot.Name $slot.Kind
            if(Equal-Value $current $entry.Original){continue}
            if(@($entry.Writes|Where-Object {Equal-Value $_ $current}).Count -eq 0){throw 'external-change'}
            Write-Value $slot.Path $slot.Name $entry.Original
            if(!(Equal-Value (Read-Value $slot.Path $slot.Name $slot.Kind) $entry.Original)){throw 'restore-readback'}
        }catch{$conflicts+=$slot.Name}
    }
    if($conflicts.Count){throw ('restore-'+($conflicts -join '-'))}
    [IO.File]::Delete($StatePath)
}

$mutex=$null
$locked=$false
$machine=$null
try {
    Add-Type -AssemblyName System.Security
    if($Request.Length -gt 4096){throw 'invalid-request'}
    $parameters=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Request)) | ConvertFrom-Json
    $id=[string]$parameters.parent
    if($id -notmatch '^USB\\VID_05AC&PID_[0-9a-f]{4}\\[0-9a-f-]{10,64}$'){throw 'invalid-apple-instance'}
    $present=Get-PnpDevice -PresentOnly -InstanceId $id
    $properties=Get-PnpDeviceProperty -InstanceId $present.InstanceId -KeyName DEVPKEY_Device_DriverProvider,DEVPKEY_Device_Service
    if(($properties|Where-Object KeyName -eq DEVPKEY_Device_DriverProvider).Data -notmatch '^Apple,? Inc\.?$' -or
        ($properties|Where-Object KeyName -eq DEVPKEY_Device_Service).Data -ne 'usbccgp'){throw 'official-apple-driver-required'}
    $preferredIndex=[int]$parameters.preferredIndex
    $preferredValue=[int]$parameters.preferredValue
    $ordinaryIndex=[int]$parameters.ordinaryIndex
    $ordinaryValue=[int]$parameters.ordinaryValue
    $ordinaryMux=[int]$parameters.ordinaryMux
    if($preferredIndex -notin (0..254) -or $ordinaryIndex -notin (0..254) -or $preferredIndex -eq $ordinaryIndex -or
       $preferredValue -notin (1..255) -or $ordinaryValue -notin (1..255) -or $preferredValue -eq $ordinaryValue -or $ordinaryMux -notin (0..255)){throw 'invalid-configuration'}
    $project=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $native=if((Split-Path $project -Leaf) -eq 'app.asar.unpacked'){Join-Path (Split-Path $project -Parent) 'native'}else{Join-Path $project 'build\native'}
    $reader=Join-Path $native 'UsbReadConfigurations.exe'
    $modeHelper=Join-Path $native 'AppleUsbMode.exe'
    $mutex=[Threading.Mutex]::new($false,'Global\WinPlayNativeNcmPreparation')
    try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
    if(!$locked){throw 'usb-preparation-already-running'}
    $machine=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
    $driver=Driver-Of $id
    Assert-SoleOwner $driver $id
    $settings=@(Slots $id $driver)
    $folder=Join-Path $env:LOCALAPPDATA 'WinPlay\WiredUsb'
    [IO.Directory]::CreateDirectory($folder)|Out-Null
    $StatePath=Join-Path $folder 'prepare-journal.dpapi'
    if(Test-Path -LiteralPath $StatePath){
        $record=Read-Record
        if($record.Instance -ine $id -or $record.Driver -ine $driver -or $record.Format -ne 2){throw 'different-usb-recovery-pending'}
        Restore-OwnedValues
    }
    $snapshot=SnapshotUsb
    if((ConfigValue $snapshot $ordinaryIndex) -ne $ordinaryValue -or (ConfigValue $snapshot $preferredIndex) -ne $preferredValue){throw 'configuration-descriptors-changed'}
    $entries=@(foreach($slot in $settings){
        [pscustomobject]@{Original=(Read-Value $slot.Path $slot.Name $slot.Kind);Writes=@()}
    })
    $record=[pscustomobject]@{Format=2;Instance=$id;Driver=$driver;Entries=$entries}
    Save-Record $record $true
    try {
        # Return to the proven ordinary USB configuration before the phone's
        # own mode transition. Cycling with the CarPlay index armed may request
        # a descriptor that the phone has not yet exposed.
        Set-OwnedValue 2 (New-Value 'DWord' $ordinaryIndex)
        Set-OwnedValue 3 (New-Value 'DWord' $ordinaryIndex)
        $script:stage='refresh-usb-port'
        & $reader --cycle-port $id
        if($LASTEXITCODE -ne 0){throw 'usb-port-refresh-failed'}
        $ordinary=Wait-ForConfiguration $ordinaryValue
        if((ConfigValue $ordinary $ordinaryIndex) -ne $ordinaryValue -or (ConfigValue $ordinary $preferredIndex)){throw 'usb-did-not-return-to-ordinary'}
        $filters=@($entries[0].Original.Data|Where-Object {$_ -and $_ -ine 'AppleLowerFilter'})
        if($entries[0].Original.Kind -ne 'Absent'){
            if($filters.Count){Set-OwnedValue 0 (New-Value 'MultiString' $filters)}
            else{Set-OwnedValue 0 (New-Value 'Absent' $null)}
        }
        Set-OwnedValue 1 (New-Value 'Binary' ([byte[]]@(2,0,0)))
        Set-OwnedValue 2 (New-Value 'DWord' $preferredIndex)
        Set-OwnedValue 3 (New-Value 'DWord' $ordinaryIndex)
        $script:stage='request-carplay-mode'
        $response=& $modeHelper --parent-instance $id $ordinaryMux $ordinary.configurations.Count --request-mode4 2>$null
        $result=Wait-ForConfiguration $preferredValue
        if((ConfigValue $result $preferredIndex) -ne $preferredValue){throw 'unexpected-media-configuration'}
    } finally {
        Restore-OwnedValues
    }
    exit 0
}catch{
    $message=$_.Exception.Message
    if($message -notmatch '^[A-Za-z0-9 ,-]{1,120}$'){$message=$script:stage}
    [Console]::Error.WriteLine('ncm-preparation: '+$message)
    exit 1
}finally{
    if($machine){$machine.Dispose()}
    if($locked){$mutex.ReleaseMutex()}
    if($mutex){$mutex.Dispose()}
}
