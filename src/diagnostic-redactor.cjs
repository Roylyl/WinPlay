const {isIP}=require('node:net');
const hidden='[敏感内容已隐藏]';
const secretKey=/^(?:password|passphrase|passwd|pwd|ssid|(?:lan|hotspot)?password|(?:lan|hotspot)?ssid|private[-_\s]?key|secret|sharedsecret|token|authorization|certificate|cert|pair[-_\s]?record|payload|hex|identity|pk8|device[-_\s]?id|device[-_\s]?name|targetBluetooth|pairing[-_\s]?id|controller[-_\s]?id|serial|密码|口令|私钥|配对记录|认证材料)$/i;
const secretAssignment=/(?:\b(?:password|passphrase|passwd|pwd|ssid|(?:lan|hotspot)password|(?:lan|hotspot)ssid|private[-_\s]?key|shared[-_\s]?secret|secret|token|authorization|certificate|pair[-_\s]?record|payload|hex|identity\.pk8|certificate\.p7b)\b|密码|口令|私钥|配对记录|认证材料)["'\s]*[:=：]/i;

function hideAssignments(text){
 const lines=text.split(/\r?\n/),result=[];let depth=0,inString=false,escape=false;
 function countBrackets(part){for(const ch of part){if(escape){escape=false;continue}if(inString&&ch==='\\'){escape=true;continue}if(ch==='"'){inString=!inString;continue}if(!inString){if(ch==='{'||ch==='[')depth++;if(ch==='}'||ch===']')depth--}}}
 for(const line of lines){
  if(depth>0){countBrackets(line);continue}
  const match=secretAssignment.exec(line);
  if(!match){result.push(line);continue}
  result.push(line.slice(0,match.index)+hidden);
  const value=line.slice(match.index+match[0].length).trimStart();
  if(value.startsWith('{')||value.startsWith('[')){depth=0;inString=false;escape=false;countBrackets(value)}
 }
 return result.join('\n');
}

function redactText(value){
 let text=String(value??'');
 text=text.replace(/-----BEGIN[^\r\n-]*(?:PRIVATE KEY|CERTIFICATE)[^-]*-----[\s\S]*?(?:-----END[^\r\n-]*-----|$)/gi,hidden);
 // Hide raw assignment lines and their complete nested JSON payloads.
 text=hideAssignments(text);
 text=text.replace(/\b[A-Za-z]:[\\/]Users[\\/][^\r\n"'<>|)]+/gi,'[用户路径]');
 text=text.replace(/(?:\/Users\/|\/home\/)[^\r\n"'<>|)]+/g,'[用户路径]');
 text=text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'[设备标识]');
 text=text.replace(/\b[0-9a-f]{8}-[0-9a-f]{16}\b/gi,'[设备标识]');
 text=text.replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi,'[MAC]');
 text=text.replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,}[0-9a-f:.]{0,39}(?:%[\w.-]+)?/gi,address=>isIP(address.split('%')[0])===6?'[IP]':address);
 text=text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,address=>isIP(address)===4?'[IP]':address);
 text=text.replace(/\b[0-9a-f]{12}\b|\b[0-9a-f]{24,}\b/gi,'[设备标识]');
 text=text.replace(/\b[A-Za-z0-9+/]{80,}={0,2}/g,hidden);
 return text;
}

function redactValue(value,key='',seen=new WeakSet()){
 if(secretKey.test(key))return hidden;
 if(typeof value==='string')return redactText(value);
 if(value===null||typeof value!=='object')return value;
 if(Buffer.isBuffer(value)||ArrayBuffer.isView(value))return '[二进制数据已隐藏]';
 if(seen.has(value))return '[重复引用]';seen.add(value);
 const result=Array.isArray(value)?value.map(v=>redactValue(v,'',seen)):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactValue(v,k,seen)]));
 seen.delete(value);return result;
}
function redactDiagnostics(items){return redactValue(Array.isArray(items)?items:[])}
module.exports={redactText,redactDiagnostics};
