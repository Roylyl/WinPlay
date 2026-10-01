/** Accessory authentication interface, implemented by WinPlay LocalSigner. */

export interface MfiSigner {
  /** The accessory MFi certificate, loaded from the configured authentication material. */
  certificate(): Promise<Buffer>
  /** Sign a digest with the configured private key. */
  sign(digest: Buffer): Promise<Buffer>
  /** Auth protocol major version selected by the authentication provider: 2 (2.0C, SHA-1) or 3 (3.0, SHA-256). */
  protocolMajor(): Promise<number>
}
