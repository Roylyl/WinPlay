// SPDX-License-Identifier: GPL-3.0-or-later
// MacPlay bringup.rs uses the router BSSID when supplied, NIC MAC otherwise.
export function accessPointIdentifier(cfg:{wirelessMode?:string;accessPointMac?:string},nicMac:string){
 const value=cfg.wirelessMode==='lan'&&cfg.accessPointMac?.trim()?cfg.accessPointMac.trim():nicMac;
 if(!/^[\da-f]{2}(:[\da-f]{2}){5}$/i.test(value))throw new Error('接入点 BSSID 必须为六组十六进制地址');
 return value.toUpperCase();
}
