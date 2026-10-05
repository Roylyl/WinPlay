import dgram from 'node:dgram'

export class KeepAliveServer {
  private _sock: dgram.Socket | null = null
  private _lastActivityNs = 0n
  constructor(private readonly peerHost = '') {}
  get lastActivityNs(): bigint { return this._lastActivityNs }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp6', ipv6Only: false })
      sock.on('error', reject)
      sock.on('message', (_message, peer) => {
        const normal = (host: string) => host.split('%')[0].toLowerCase().replace(/^::ffff:/, '')
        if (this.peerHost && normal(peer.address) === normal(this.peerHost))
          this._lastActivityNs = process.hrtime.bigint()
      })
      sock.bind(0, '::', () => {
        this._sock = sock
        resolve(sock.address().port)
      })
    })
  }

  stop(): void {
    this._sock?.close()
    this._sock = null
  }
}
