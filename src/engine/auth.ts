import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { p256 } from '@noble/curves/p256'
import { readProtected } from './storage'
import type { MfiSigner } from './protocol/mfiSigner'
export function validateAuthentication(keyDer: Buffer, certDer: Buffer): Buffer {
 const key = createPrivateKey({key:keyDer,format:'der',type:'pkcs8'})
 const jwk=key.export({format:'jwk'})
 if(jwk.crv!=='P-256'||!jwk.d)throw new Error('认证私钥必须是PKCS#8 DER格式的P-256密钥')
 const pub=createPublicKey(key).export({format:'der',type:'spki'})
 let found=false
 function visit(bytes: Buffer, depth=0) {
  if(depth>16)return
  for(let i=0;i+2<=bytes.length;){
   const tag=bytes[i], first=bytes[i+1];let n=first, h=2
   if(first&128){const k=first&127;if(k===0||k>4||i+2+k>bytes.length)return;n=0;for(let j=0;j<k;j++)n=n*256+bytes[i+2+j];h+=k}
   if(i+h+n>bytes.length)return
   const item=bytes.subarray(i,i+h+n)
   if(tag===48){try{const cert=new X509Certificate(item);if(cert.publicKey.export({format:'der',type:'spki'}).equals(pub))found=true}catch{visit(item.subarray(h),depth+1)}}
   else if(tag&32)visit(item.subarray(h),depth+1)
   i+=h+n
  }
 }
 visit(certDer)
 if(!found)throw new Error('P7B中没有找到与私钥匹配的X.509证书；不导入不匹配的材料')
 return Buffer.from(jwk.d,'base64url')
}
export class LocalSigner implements MfiSigner {
 private key:Buffer;private cert:Buffer
 constructor(dir:string){const keyFile=join(dir,'identity.pk8.dpapi'),certFile=join(dir,'certificate.p7b.dpapi');let key:Buffer;
  if(existsSync(keyFile)||existsSync(certFile)){if(!existsSync(keyFile)||!existsSync(certFile))throw new Error('本机认证文件不完整，请重新导入配套文件');key=readProtected(keyFile);this.cert=readProtected(certFile)}
  else{const bundled=join(process.env.WINPLAY_RESOURCES!,'authentication');key=readFileSync(join(bundled,'identity.pk8'));this.cert=readFileSync(join(bundled,'certificate.p7b'))}
  this.key=validateAuthentication(key,this.cert)}
 async certificate(){return this.cert}
 async protocolMajor(){return 3}
 async sign(digest:Buffer){if(digest.length!==32)throw new Error('MFi3签名摘要长度错误');return Buffer.from(p256.sign(digest,this.key,{prehash:false,lowS:false}).toCompactRawBytes())}
}
