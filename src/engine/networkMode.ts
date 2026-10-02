// SPDX-License-Identifier: GPL-3.0-or-later
import { isIP } from 'node:net';
import { interfaceScope } from './discovery';

type ReceiverAddress = {
 address:string; family:string|number; internal?:boolean; mac:string;
 scopeid?:number; netmask?:string;
};
type ReceiverFamily = 'IPv4'|'IPv6';
export type ReceiverNetwork = {
 host:string; family:ReceiverFamily; mac:string; scope:number|undefined;
 alternateHost?:string; alternateFamily?:ReceiverFamily;
};

function usableIPv4(address:ReceiverAddress){
 if(address.internal || (address.family!=='IPv4' && address.family!==4) || isIP(address.address)!==4)return false;
 const octets=address.address.split('.').map(Number);
 if(octets[0]===0 || octets[0]===127 || octets[0]>=224 || (octets[0]===169 && octets[1]===254))return false;
 if(address.netmask && isIP(address.netmask)===4){
  const bits=(value:string)=>value.split('.').reduce((result,part)=>(result*256+Number(part))>>>0,0);
  const mask=bits(address.netmask),hostMask=(~mask)>>>0;
  // /31 and /32 have no broadcast host; other subnets reserve all host bits set.
  if(hostMask>1 && ((hostMask+1)&hostMask)===0 && ((bits(address.address)&hostMask)>>>0)===hostMask)return false;
 }
 return true;
}

function usableIPv6(address:ReceiverAddress){
 const host=address.address.split('%')[0];
 return !address.internal && (address.family==='IPv6' || address.family===6) &&
  isIP(host)===6 && /^fe[89ab][0-9a-f]:/i.test(host) && interfaceScope(address.address,address.scopeid)!==undefined;
}

// Accept addresses from one interface, never OS-wide candidates. Scope IDs belong
// to this Windows host; only the plain IP address is advertised to the iPhone.
export function receiverNetwork(addresses:readonly ReceiverAddress[]):ReceiverNetwork{
 const ipv4=addresses.find(usableIPv4);
 const selected=ipv4 || addresses.find(usableIPv6);
 if(!selected)throw new Error('所选接口没有可用地址，请检查移动热点或局域网连接');
 const mac=selected.mac.toUpperCase();
 // Reject a foreign NIC's candidate even if a caller accidentally flattens arrays.
 const ipv6=addresses.find(address=>address.mac.toUpperCase()===mac && usableIPv6(address));
 const family:ReceiverFamily=ipv4?'IPv4':'IPv6';
 const alternate=family==='IPv4'?ipv6:undefined;
 return {
  host:selected.address.split('%')[0], family, mac,
  scope:ipv6?interfaceScope(ipv6.address,ipv6.scopeid):undefined,
  ...(alternate?{alternateHost:alternate.address.split('%')[0],alternateFamily:'IPv6' as const}:{})
 };
}

// MacPlay bringup.rs uses the router BSSID when supplied, NIC MAC otherwise.
export function accessPointIdentifier(cfg:{wirelessMode?:string;accessPointMac?:string},nicMac:string){
 const value=cfg.wirelessMode==='lan'&&cfg.accessPointMac?.trim()?cfg.accessPointMac.trim():nicMac;
 if(!/^[\da-f]{2}(:[\da-f]{2}){5}$/i.test(value))throw new Error('接入点 BSSID 必须为六组十六进制地址');
 return value.toUpperCase();
}
