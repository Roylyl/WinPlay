// SPDX-License-Identifier: GPL-3.0-or-later
// Keep the two wireless networks separate; resolve only at explicit start.
function resolveConnectionSettings(saved){
 if(!['hotspot','lan'].includes(saved.wirelessMode||'hotspot'))throw new Error('无线模式无效');
 if(saved.wirelessMode==='lan')return {...saved,ssid:saved.lanSsid,password:saved.lanPassword,channel:saved.lanChannel,networkInterface:saved.lanNetworkInterface,accessPointMac:saved.lanAccessPointMac};
 return {...saved,wirelessMode:saved.wirelessMode||'hotspot',accessPointMac:''};
}
module.exports={resolveConnectionSettings};
