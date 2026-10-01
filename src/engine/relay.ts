import { Duplex } from 'node:stream'
let factory: (()=>Duplex)|undefined
export function setIapRelayFactory(value: typeof factory){factory=value}
export function openIapRelay(): any {
 if(!factory)throw new Error('iAP2链路尚未建立')
 return factory()
}
