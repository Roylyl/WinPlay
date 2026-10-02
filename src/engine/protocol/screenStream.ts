/**
 * screenStream — receives the CarPlay main-screen video on its data port.
 *
 * After SETUP the phone opens a TCP connection to the port we advertised. Each
 * message is a 128-byte AirPlayScreenHeader followed by a body: VideoConfig
 * (avcC/hvcC) or VideoFrame (length-prefixed NALUs), ChaCha20-Poly1305 encrypted
 * with the header as AAD. The config is emitted as codec_data and each frame is
 * decrypted and emitted verbatim (length-prefixed); the pipeline parser handles the
 * framing, so no frame data is decoded or rewritten here.
 */

import { EventEmitter } from 'node:events'
import net from 'node:net'
import { chachaOpen, nonce64 } from './crypto'
import { configToCodecData } from './nalu'

const HEADER_LEN = 128
const OP_VIDEO_FRAME = 0
const OP_VIDEO_CONFIG = 1
const MAX_BODY = 8 * 1024 * 1024
const MAX_ACC = 16 * 1024 * 1024

export class ScreenStream extends EventEmitter {
  private _server: net.Server | null = null
  private _counter = 0n
  private lastConfig: Buffer | undefined
  private sockets = new Set<net.Socket>()
  private paused = false
  private drainers = new Map<net.Socket, () => void>()

  constructor(private readonly key: Buffer) {
    super()
  }

  /** Listen on an ephemeral port and return it once bound. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((sock) => this._onConnection(sock))
      server.on('error', reject)
      server.listen({ port: 0, host: '::', ipv6Only: false }, () => {
        const addr = server.address()
        this._server = server
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })
  }

  stop(): void {
    for(const s of this.sockets)s.destroy()
    this.sockets.clear()
    this.drainers.clear()
    this._server?.close()
    this._server = null
  }

  setPaused(paused:boolean):void {
    this.paused=paused
    for(const socket of this.sockets){
      if(paused)socket.pause()
      else{this.drainers.get(socket)?.();if(!this.paused&&!socket.destroyed)socket.resume()}
    }
  }

  private _onConnection(sock: net.Socket): void {
    console.log(`[cpScreen] video data connection from ${sock.remoteAddress}:${sock.remotePort}`)
    if(this.sockets.size){sock.destroy();return}
    this.sockets.add(sock)
    if(this.paused)sock.pause()
    this._counter = 0n
    this.emit('connected')
    let acc = Buffer.alloc(0)
    let draining=false
    const drain=()=>{
      if(draining)return
      draining=true
      try{while(!this.paused&&!sock.destroyed){
        if (acc.length < HEADER_LEN) break
        const bodySize = acc.readUInt32LE(0)
        if (bodySize > MAX_BODY) {
          console.warn(`[cpScreen] implausible bodySize ${bodySize}, dropping connection`)
          sock.destroy()
          return
        }
        if (acc.length < HEADER_LEN + bodySize) break
        const header = acc.subarray(0, HEADER_LEN)
        const body = acc.subarray(HEADER_LEN, HEADER_LEN + bodySize)
        acc = acc.subarray(HEADER_LEN + bodySize)
        try {
          this._onMessage(header, body)
        } catch (e) {
          console.warn('[cpScreen] frame error:', (e as Error).message)
          this.emit('receive-error', opcodeStage(header[4]))
          sock.destroy()
          return
        }
      }}finally{draining=false}
    }
    this.drainers.set(sock,drain)
    sock.on('data', (chunk: Buffer) => {
      if(acc.length+chunk.length>MAX_ACC){this.emit('receive-error','视频接收缓冲超限');sock.destroy();return}
      acc = Buffer.concat([acc, chunk])
      drain()
    })
    sock.on('error', (err) => console.warn(`[cpScreen] socket error: ${err.message}`))
    sock.on('close', () => {this.sockets.delete(sock);this.drainers.delete(sock);this.emit('ended')})
  }

  private _onMessage(header: Buffer, body: Buffer): void {
    const opcode = header[4]

    if (opcode === OP_VIDEO_CONFIG) {
      // VideoConfig is sent in the clear (the avcC/hvcC atom); detect the real codec from
      // it (the phone may pick H.264 even when H.265 is offered) and hand the record on as
      // codec_data for the pipeline parser.
      if (!body.length) return
      const { codec, codecData } = configToCodecData(body)
      if (!codecData.length || this.lastConfig?.equals(codecData)) return
      this.lastConfig = Buffer.from(codecData)
      this.emit('codec', codec)
      console.log(`[cpScreen] video config (${codec}, ${codecData.length}B codec_data)`)
      this.emit('config', codecData)
    } else if (opcode === OP_VIDEO_FRAME) {
      // VideoFrame is ChaCha20-Poly1305 sealed with the 128-byte header as AAD; the nonce
      // is an 8-byte LE counter that advances only on decoded frames. Emit the decrypted
      // length-prefixed NALs verbatim; the parser reframes them.
      if (body.length >= 16) {
        const payload = chachaOpen(this.key, nonce64(this._counter), body, header)
        this._counter++
        this.emit('frame', payload)
      } else {
        throw new Error('Unauthenticated video frame')
      }
    }
    // KeepAlive / ForceKeyFrame / Ignore carry no displayable payload.
  }
}

function opcodeStage(opcode:number){return opcode===OP_VIDEO_FRAME?'视频帧认证失败':opcode===OP_VIDEO_CONFIG?'视频配置解析失败':'视频报文解析失败'}

