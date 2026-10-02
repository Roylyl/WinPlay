// SPDX-License-Identifier: GPL-3.0-or-later
// Keep the two wireless networks separate; resolve only at explicit start.
function resolveConnectionSettings(saved){
 if(!['hotspot','lan'].includes(saved.wirelessMode||'hotspot'))throw new Error('无线模式无效');
 if(saved.wirelessMode==='lan')return {...saved,ssid:saved.lanSsid,password:saved.lanPassword,channel:saved.lanChannel,networkInterface:saved.lanNetworkInterface,accessPointMac:saved.lanAccessPointMac};
 return {...saved,wirelessMode:saved.wirelessMode||'hotspot',accessPointMac:''};
}
function refreshLanParameters(cfg,current){
 const refreshed={...cfg};
 // Refresh only live radio parameters for this exact connection. Reading a
 // different Wi-Fi adapter must never change manually selected Ethernet/LAN.
 if(cfg.wirelessMode!=='lan'||!current?.ok||current.ssid!==cfg.ssid||!current.interfaceName||!cfg.networkInterface||String(current.interfaceName).toLowerCase()!==String(cfg.networkInterface).toLowerCase())return refreshed;
 if(Number.isInteger(current.channel)&&current.channel>=1&&current.channel<=196)refreshed.channel=current.channel;
 if(typeof current.bssid==='string'&&/^[\da-f]{2}(:[\da-f]{2}){5}$/i.test(current.bssid)&&current.bssid!=='00:00:00:00:00:00')refreshed.accessPointMac=current.bssid.toUpperCase();
 return refreshed;
}
module.exports={resolveConnectionSettings,refreshLanParameters};
