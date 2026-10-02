// Interface-bound Bonjour publication and iPhone control probing, adapted from
// AndroidPlay CarPlayBonjour.kt and MacPlay livi-runtime/src/bonjour.rs.
import net from 'node:net'
import os from 'node:os'
const mdns:any = require('multicast-dns')
const CONTROL_SERVICE = '_carplay-ctrl._tcp.local'
const QUERY_INTERVAL = 1500
const normalName = (name:string) => name.replace(/\.$/, '').toLowerCase()
const linkLocal = (address:string) => /^fe[89ab][0-9a-f]:/i.test(address.split('%')[0])

export function interfaceScope(address:string, scopeid?:number):number|undefined {
 const valid = (value:number) => Number.isInteger(value) && value > 0 && value <= 0xffffffff
 if (typeof scopeid === 'number' && valid(scopeid)) return scopeid
 const suffix = /%(\d+)$/.exec(address)?.[1]
 if (suffix && valid(Number(suffix))) return Number(suffix)
 return undefined
}

export function connectProbeRequest(host:string, port:number, deviceId:string) {
 const unscoped = host.split('%')[0]
 if (!net.isIP(unscoped) || port < 1 || port > 65535 || !Number.isInteger(port) || !/^[0-9a-f:]+$/i.test(deviceId)) throw new Error('CarPlay控制探测参数无效')
 return 'GET /ctrl-int/1/connect HTTP/1.1\r\nHost: ' + (unscoped.includes(':') ? '[' + unscoped + ']' : unscoped) + ':' + port + '\r\nUser-Agent: AirPlay/950.7.1\r\nAirPlay-Receiver-Device-ID: ' + deviceId.replaceAll(':', '') + '\r\nConnection: close\r\n\r\n'
}

type Record = {name:string; type:string; data:any; ttl:number}
type Dependencies = {
 interfaces?: typeof os.networkInterfaces
 mdns?: (options:any) => any
 connect?: typeof net.createConnection
 now?: () => number
 setTimeout?: typeof setTimeout
 clearTimeout?: typeof clearTimeout
}
type Attempt = {state:'pending'|'responded'|'failed'; retryAt:number; attempt:number}

export class Discovery {
 private sockets:any[] = []
 private connections = new Set<net.Socket>()
 private records:Record[] = []
 private cache = new Map<string, {record:Record; expires:number}>()
 private attempted = new Map<string, Attempt>()
 private queries = new Map<string, number>()
 private reported = new Set<string>()
 private timers = new Set<NodeJS.Timeout>()
 private interval:NodeJS.Timeout
 private closed = false
 private interfaces:typeof os.networkInterfaces
 private now:() => number

 constructor(private iface:string, private identity:{deviceId:string; pk:string; pi:string; btMac:string},
  private targetBt:string, private allowed:() => boolean, private status:(s:string) => void, private deps:Dependencies = {}) {
  this.interfaces = deps.interfaces || os.networkInterfaces
  this.now = deps.now || Date.now
  const addresses = (this.interfaces()[iface] || []).filter(a => !a.internal)
  const host = 'winplay-' + identity.pi.toLowerCase() + '.local', fqdn = 'WinPlay._airplay._tcp.local'
  const txt = {deviceid:identity.deviceId, features:'0x44540380,0x61', flags:'0x4', model:'WinPlay', srcvers:'950.7.1', protovers:'1.1', pi:identity.pi, pk:identity.pk}
  this.records = [
   {name:'_airplay._tcp.local', type:'PTR', ttl:120, data:fqdn},
   {name:fqdn, type:'SRV', ttl:120, data:{port:17000, target:host}},
   {name:fqdn, type:'TXT', ttl:120, data:Object.entries(txt).map(([k,v]) => Buffer.from(k + '=' + v))},
   ...addresses.filter(a => a.family === 'IPv4' || a.family === 'IPv6' && linkLocal(a.address) && interfaceScope(a.address, a.scopeid))
    .map(a => ({name:host, type:a.family === 'IPv4' ? 'A' : 'AAAA', ttl:120, data:a.address.split('%')[0]}))
  ]
  for (const family of ['IPv4', 'IPv6']) {
   const address = addresses.find(a => a.family === family && (family !== 'IPv6' || linkLocal(a.address) && interfaceScope(a.address, a.scopeid)))
   if (!address) {
    if (family === 'IPv6' && addresses.some(a => a.family === 'IPv6' && linkLocal(a.address))) this.diagnostic('invalid-scope', 'IPv6作用域无效')
    continue
   }
   const source = family === 'IPv6' ? address.address.split('%')[0] + '%' + interfaceScope(address.address, address.scopeid) : address.address
   try {
    // Wildcard reception permits multicast packets; membership and outbound
    // multicast remain explicitly limited to the selected interface.
    const socket = (deps.mdns || mdns)({type:family === 'IPv6' ? 'udp6' : 'udp4', ip:family === 'IPv6' ? 'ff02::fb' : '224.0.0.251', interface:source, bind:family === 'IPv6' ? '::' : '0.0.0.0', reuseAddr:true})
    this.sockets.push(socket)
    socket.on('error', (error:any) => this.diagnostic('socket-' + family + '-' + this.errorCode(error), family + '套接字错误/' + this.errorCode(error)))
    socket.on('warning', (error:any) => this.diagnostic('warning-' + family + '-' + this.errorCode(error), family + '多播警告/' + this.errorCode(error)))
    socket.on('ready', () => {
     if (this.closed) return
     this.diagnostic('ready-' + family, family + '发现接口已就绪')
     this.respond(socket, this.records)
     this.query(CONTROL_SERVICE, 'PTR')
    })
    socket.on('query', (packet:any) => {
     if (Array.isArray(packet.questions) && packet.questions.some((question:any) => typeof question.name === 'string' && this.records.some(record => normalName(record.name) === normalName(question.name)))) this.respond(socket, this.records)
    })
    socket.on('response', (packet:any) => this.receive(packet))
   } catch (error) {
    this.diagnostic('create-' + family, family + '发现接口启动失败/' + this.errorCode(error))
   }
  }
  if (!this.sockets.length) status('所选接口的Bonjour广播无法启动')
  this.interval = setInterval(() => { this.query(CONTROL_SERVICE, 'PTR'); this.resolve() }, QUERY_INTERVAL)
  this.interval.unref()
 }

 private errorCode(error:any) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(error.code) ? error.code : 'UNKNOWN'
 }
 private diagnostic(key:string, message:string) {
  if (this.closed || this.reported.has(key) || this.reported.size >= 128) return
  // Fixed stage/error labels contain no phone IDs, hostnames or IP addresses.
  this.reported.add(key)
  this.status('网络发现：' + message)
 }
 private respond(socket:any, records:Record[]) {
  if (this.closed) return
  socket.respond({answers:records}, (error:any) => {
   if (error) this.diagnostic('publish-' + this.errorCode(error), '广播发送失败/' + this.errorCode(error))
   else this.diagnostic('published', '接收服务广播已发送')
  })
 }
 private query(name:string, type:string) {
  if (this.closed || !this.sockets.length) return
  const key = normalName(name) + '|' + type, now = this.now()
  if (this.queries.has(key) && now - this.queries.get(key)! < QUERY_INTERVAL) return
  if (this.queries.size >= 256) this.queries.delete(this.queries.keys().next().value!)
  this.queries.set(key, now)
  for (const socket of this.sockets) socket.query({questions:[{name, type}]}, (error:any) => {
   if (error) this.diagnostic('query-' + this.errorCode(error), '查询发送失败/' + this.errorCode(error))
   else this.diagnostic('query-' + type, type + '查询已发送')
  })
 }
 private recordKey(record:Record) {
  const base = normalName(record.name) + '|' + record.type
  // PTR and address records are RRsets. A global AAAA must never overwrite
  // the same host's link-local AAAA.
  return ['PTR', 'A', 'AAAA'].includes(record.type) ? base + '|' + normalName(String(record.data)) : base
 }
 private receive(packet:any) {
  if (this.closed) return
  const records = [...(Array.isArray(packet.answers) ? packet.answers : []), ...(Array.isArray(packet.additionals) ? packet.additionals : [])]
  for (const raw of records) {
   if (!raw || typeof raw.name !== 'string' || raw.name.length > 255 || !raw.name || !['PTR', 'SRV', 'TXT', 'A', 'AAAA'].includes(raw.type) || !Number.isFinite(raw.ttl) || raw.ttl < 0) continue
   const record:Record = {name:normalName(raw.name), type:raw.type, ttl:raw.ttl, data:raw.data}
   if (record.type === 'PTR' && (typeof record.data !== 'string' || !record.data || record.data.length > 255)) continue
   if (record.type === 'SRV' && (typeof record.data?.target !== 'string' || !record.data.target || record.data.target.length > 255 || !Number.isInteger(record.data.port) || record.data.port < 1 || record.data.port > 65535)) continue
   if (record.type === 'TXT' && (!Array.isArray(record.data) || !record.data.every((value:any) => Buffer.isBuffer(value)))) continue
   if (record.type === 'A' && (typeof record.data !== 'string' || net.isIP(record.data) !== 4)) continue
   if (record.type === 'AAAA' && (typeof record.data !== 'string' || record.data.includes('%') || net.isIP(record.data) !== 6)) continue
   const key = this.recordKey(record)
   if (record.ttl === 0) this.cache.delete(key)
   else {
    if (!this.cache.has(key) && this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, {record, expires:this.now() + Math.min(600, record.ttl) * 1000})
   }
  }
  this.resolve()
 }
 private matching(name:string, type:string) {
  const normalized = normalName(name)
  return [...this.cache.values()].filter(item => item.record.type === type && normalName(item.record.name) === normalized).map(item => item.record)
 }
 private resolve() {
  if (this.closed) return
  for (const [key, value] of this.cache) if (value.expires <= this.now()) this.cache.delete(key)
  const instances = new Set<string>()
  for (const {record} of this.cache.values()) {
   if (record.type === 'PTR' && record.name === CONTROL_SERVICE && normalName(record.data).endsWith('.' + CONTROL_SERVICE)) instances.add(normalName(record.data))
   if (record.type === 'SRV' && record.name.endsWith('.' + CONTROL_SERVICE)) instances.add(record.name)
  }
  if (instances.size) this.diagnostic('service', '控制服务已发现')
  for (const instance of instances) {
   const srv = this.matching(instance, 'SRV')[0], txt = this.matching(instance, 'TXT')[0]
   if (!srv) { this.query(instance, 'SRV'); this.diagnostic('missing-srv', '正在补查控制服务位置') }
   if (!txt) { this.query(instance, 'TXT'); this.diagnostic('missing-txt', '正在补查控制服务标识') }
   if (!srv) continue
   const host = normalName(srv.data.target), addresses = [...this.matching(host, 'AAAA'), ...this.matching(host, 'A')]
   if (!addresses.some(record => record.type === 'A')) this.query(host, 'A')
   if (!addresses.some(record => record.type === 'AAAA' && linkLocal(record.data))) this.query(host, 'AAAA')
   if (!addresses.length) this.diagnostic('missing-address', '正在补查控制服务地址')
   // Missing TXT does not prevent address resolution or alter the old matching
   // policy: reject only an explicitly advertised ID that differs from the target.
   const id = txt?.data.map((value:Buffer) => value.toString()).find((value:string) => value.startsWith('id='))?.slice(3)
   const normalizeId = (value:string) => value.replace(/[^0-9a-f]/gi, '').toLowerCase()
   if (this.targetBt && id && normalizeId(id) !== normalizeId(this.targetBt)) { this.diagnostic('other-target', '忽略非所选设备的控制服务'); continue }
   if (!this.allowed()) continue
   const localAddresses = (this.interfaces()[this.iface] || []).filter(address => !address.internal)
   const endpoints:{remote:string; source:string; ipv6:boolean; key:string; type:string}[] = []
   for (const record of addresses.slice(0, 16)) {
    const ipv6 = record.type === 'AAAA'
    if (ipv6 && !linkLocal(record.data)) { this.diagnostic('nonlocal-v6', '忽略非链路本地IPv6控制地址'); continue }
    const local = localAddresses.find(address => address.family === (ipv6 ? 'IPv6' : 'IPv4') && (!ipv6 || linkLocal(address.address) && interfaceScope(address.address, address.scopeid)))
    if (!local) { this.diagnostic('no-source-' + record.type, ipv6 ? 'IPv6源接口或作用域不可用' : 'IPv4源接口不可用'); continue }
    const scope = ipv6 ? interfaceScope(local.address, local.scopeid) : undefined
    const remote = ipv6 ? record.data + '%' + scope : record.data
    const source = ipv6 ? local.address.split('%')[0] + '%' + scope : local.address
    endpoints.push({remote, source, ipv6, type:record.type, key:remote + ':' + srv.data.port + '|' + source})
   }
   // Probe one endpoint per service at a time, preferring Mac's link-local IPv6
   // route. Parallel connect requests can create competing CarPlay sessions.
   if (endpoints.some(endpoint => ['pending', 'responded'].includes(this.attempted.get(endpoint.key)?.state || ''))) continue
   for (const {remote, source, ipv6, key, type} of endpoints) {
    const attempted = this.attempted.get(key)
    if (attempted && attempted.retryAt > this.now()) continue
    if (this.attempted.size >= 64 && !this.attempted.has(key)) continue
    const nextAttempt = !attempted || attempted.attempt >= 7 ? 1 : attempted.attempt + 1
    this.attempted.set(key, {state:'pending', retryAt:0, attempt:nextAttempt})
    this.diagnostic('address-' + type, (ipv6 ? 'IPv6' : 'IPv4') + '控制地址已就绪')
    this.probe(remote, source, srv.data.port, nextAttempt, key)
    break
   }
  }
 }
 private probe(host:string, localAddress:string, port:number, attempt:number, key:string) {
  if (this.closed) return
  let request:string
  try { request = connectProbeRequest(host, port, this.identity.deviceId) }
  catch { this.attempted.set(key, {state:'failed', retryAt:this.now() + 30000, attempt:7}); this.diagnostic('invalid-probe', '控制探测参数无效'); return }
  const family = host.includes(':') ? 'IPv6' : 'IPv4'
  this.diagnostic('probe-' + family, '正在探测控制服务/' + family)
  let first = '', accepted = false, errorCode = 'NO_RESPONSE'
  const finish = () => {
   if (this.closed) return
   if (accepted) { this.attempted.set(key, {state:'responded', retryAt:0, attempt}); return }
   this.diagnostic('probe-error-' + family + '-' + errorCode, family + '控制探测失败/' + errorCode)
   this.attempted.set(key, {state:'failed', retryAt:this.now() + (attempt < 7 ? QUERY_INTERVAL : 30000), attempt})
   if (attempt < 7) {
    const timer = (this.deps.setTimeout || setTimeout)(() => {
     this.timers.delete(timer)
     this.resolve()
    }, QUERY_INTERVAL)
    this.timers.add(timer)
   } else {
    this.diagnostic('exhausted-' + family, family + '控制探测已达到本轮重试上限')
   }
   // Prefer an untried alternate route immediately, rather than spending all
   // seven retries on a failed IPv6 address before attempting a working IPv4.
   this.resolve()
   if (attempt >= 7 && [...this.attempted.values()].every(value => value.state === 'failed' && value.attempt >= 7)) this.status('iPhone控制服务探测失败，请检查无线网络与防火墙')
  }
  let socket:net.Socket
  try { socket = (this.deps.connect || net.createConnection)({host, port, localAddress}) }
  catch (error) { errorCode = this.errorCode(error); finish(); return }
  this.connections.add(socket)
  socket.setTimeout(3000, () => { errorCode = 'ETIMEDOUT'; socket.destroy() })
  socket.on('connect', () => socket.write(request))
  socket.on('error', error => { errorCode = this.errorCode(error) })
  socket.on('data', buffer => {
   first = (first + buffer.toString('ascii')).slice(0, 256)
   if (!first.includes('\r\n')) return
   const code = /^HTTP\/\d\.\d (\d{3})/.exec(first)?.[1]
   if (code) {
    accepted = Number(code) >= 200 && Number(code) < 300
    errorCode = 'HTTP' + code
    this.diagnostic('http-' + family + '-' + code, family + '控制服务回应/HTTP' + code)
   }
   socket.destroy()
  })
  socket.once('close', () => { this.connections.delete(socket); finish() })
 }
 destroy() {
  if (this.closed) return
  this.closed = true
  clearInterval(this.interval)
  for (const timer of this.timers) (this.deps.clearTimeout || clearTimeout)(timer)
  this.timers.clear()
  for (const connection of this.connections) connection.destroy()
  this.connections.clear()
  for (const socket of this.sockets) { try { socket.respond({answers:this.records.map(record => ({...record, ttl:0}))}); socket.destroy() } catch {} }
  this.sockets = []
 }
}
