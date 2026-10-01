import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
export const dataDir = process.env.WINPLAY_DATA || join(process.env.LOCALAPPDATA!, 'WinPlay')
export const app = { getPath: (_: string) => dataDir }
function protect(data: Buffer, decrypt = false): Buffer {
 const helper = process.env.WINPLAY_NATIVE!
 return execFileSync(helper, [decrypt ? 'unprotect' : 'protect'], {input:data, windowsHide:true, maxBuffer:16*1024*1024})
}
export function readProtected(file: string): Buffer { return protect(readFileSync(file),true) }
export function writeProtected(file: string, bytes: Buffer): void {
 mkdirSync(dirname(file),{recursive:true});writeFileSync(file+'.new',protect(bytes));renameSync(file+'.new',file)
}
export function writeFileAtomic(file: string, text: string, _mode=0o600): void {writeProtected(file,Buffer.from(text))}
