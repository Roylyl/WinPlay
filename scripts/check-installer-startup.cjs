// Check the NSIS startup setting, reading only the executable's small header.
// No file hash, archive scan, or antivirus setting is involved.
const fs=require('node:fs');
const installer=process.argv[2];
if(!installer)throw Error('Installer path is required');
const fd=fs.openSync(installer,'r');
const head=Buffer.alloc(256*1024);
let size;
try{size=fs.readSync(fd,head,0,head.length,0)}finally{fs.closeSync(fd)}
const marker=Buffer.from('NullsoftInst');
let offset=head.subarray(0,size).indexOf(marker);
while(offset>=0){
 if(offset>=8&&head.readUInt32LE(offset-4)===0xdeadbeef)break;
 offset=head.subarray(0,size).indexOf(marker,offset+1);
}
if(offset<8)throw Error('NSIS startup header was not found');
const flags=head.readUInt32LE(offset-8);
if(!(flags&4)||(flags&8))throw Error('Installer startup would reread the entire payload; check scripts/installer.nsh');
console.log('NSIS startup: whole-payload CRC preread is disabled.');
