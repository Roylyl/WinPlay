const test=require('node:test'),assert=require('node:assert/strict');
const {redactText,redactDiagnostics}=require('../src/diagnostic-redactor.cjs');

test('diagnostics retain error codes and audio metrics while removing addresses and identifiers',()=>{
 const text=redactText('Windows error=50 AAC 48000Hz late=2 missing=7 version=1.1.0\npeer 192.168.137.2 [fe80::12ab%17]:17000 BT=AA:BB:CC:DD:EE:FF UUID=12345678-1234-1234-1234-123456789abc\npeer ::ffff:192.168.1.2 at 12:34:56.789');
 assert.match(text,/error=50 AAC 48000Hz late=2 missing=7 version=1\.1\.0/);
 assert.ok(!text.includes('192.168'));assert.ok(!text.includes('fe80::'));assert.ok(!text.includes('AA:BB'));assert.ok(!text.includes('12345678-1234'));
 assert.match(text,/12:34:56\.789/);
});
test('secrets, raw payloads, private keys and personal paths are removed',()=>{
 const text=redactText('error=5 password="private pass word"\npayload={"foo":"secret body"}\nSSID: My Home Network\n-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----\nCannot open C:\\Users\\Alice\\Documents\\secret-folder\\identity.pk8\nCannot open /Users/alice/private/file.log');
 for(const secret of ['private pass','secret body','My Home','private-key-body','Alice','secret-folder','alice/private'])assert.ok(!text.includes(secret),secret);
 assert.match(text,/error=5/);assert.match(text,/Cannot open \[用户路径\]/);
});
test('nested exported diagnostics are redacted without mutating local records',()=>{
 const records=[{time:'2026-10-02T12:34:56.789Z',status:'音频运行统计',detail:'late=4 recovery=1',code:50,extra:{password:'secret',privateKey:'key',payload:Buffer.from('wire'),peer:'192.168.1.2'}}];
 const exported=redactDiagnostics(records);assert.equal(exported[0].code,50);assert.equal(exported[0].detail,'late=4 recovery=1');assert.equal(exported[0].time,records[0].time);
 assert.equal(exported[0].extra.peer,'[IP]');assert.notEqual(exported[0].extra.password,'secret');assert.notEqual(exported[0].extra.privateKey,'key');assert.equal(records[0].extra.password,'secret');
});
test('a formatted multiline payload is completely removed while following metrics remain',()=>{
 const text=redactText('error=50 payload={\n  "data": [{"content": "private payload"}],\n  "ssid": "Private Home"\n}\nAAC late=2 recovery=1');
 assert.ok(!text.includes('private payload'));assert.ok(!text.includes('Private Home'));assert.match(text,/error=50/);assert.match(text,/AAC late=2 recovery=1/);
});
