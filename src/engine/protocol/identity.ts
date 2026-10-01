/**
 * identity — the accessory's persistent CarPlay/AirPlay-2 identity.
 *
 * A long-term Ed25519 key pair plus a stable pairing identifier. The public key
 * (hex) is advertised as the `pk` TXT record and the pairing id as `pi`; the
 * private key signs the pair-verify proof. Persisted in userData so the phone
 * stays paired across restarts.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic, readProtected } from '../storage'
import { app } from '../storage'
import { ed25519Generate } from './crypto'

export interface CpIdentity {
  privRaw: Buffer
  pubRaw: Buffer
  /** `pi` TXT value. */
  pairingId: string
  /** `pk` TXT value = lowercase hex of the Ed25519 public key. */
  pkHex: string
}

let cached: CpIdentity | null = null

function identityFile(): string {
  return join(app.getPath('userData'), 'cp', 'winplay-v1', 'identity.json')
}

export function loadOrCreateIdentity(): CpIdentity {
  if (cached) return cached

  const file = identityFile()
  try {
    if (existsSync(file)) {
      const j = JSON.parse(readProtected(file).toString('utf8')) as { priv: string; pub: string; pi: string }
      const privRaw = Buffer.from(j.priv, 'hex')
      const pubRaw = Buffer.from(j.pub, 'hex')
      cached = { privRaw, pubRaw, pairingId: j.pi, pkHex: pubRaw.toString('hex') }
      return cached
    }
  } catch {
    /* fall through and regenerate */
  }

  const kp = ed25519Generate()
  const pairingId = randomUUID()
  try {
    mkdirSync(join(app.getPath('userData'), 'cp', 'winplay-v1'), { recursive: true })
    writeFileAtomic(
      file,
      JSON.stringify({
        priv: kp.privRaw.toString('hex'),
        pub: kp.pubRaw.toString('hex'),
        pi: pairingId
      }),
      0o600
    )
  } catch (e) {
    console.warn('[cpIdentity] could not persist identity:', (e as Error).message)
  }

  cached = {
    privRaw: kp.privRaw,
    pubRaw: kp.pubRaw,
    pairingId,
    pkHex: kp.pubRaw.toString('hex')
  }
  return cached
}

/** Stable, locally administered accessory address, independent of network interfaces. */
export function accessoryDeviceId(publicKey: Buffer): string {
  if (publicKey.length !== 32) throw new Error('Invalid accessory public key')
  return [2,...publicKey.subarray(0,5)].map(v=>v.toString(16).padStart(2,'0')).join(':').toUpperCase()
}

