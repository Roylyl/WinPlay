// SPDX-License-Identifier: GPL-3.0-or-later
// Remove compiled modules whose sources were deleted, so releases cannot retain old adapters.
const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..'),output=path.join(root,'build','engine'),source=path.join(root,'src','engine');
function prune(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())prune(file);else if(entry.isFile()&&file.endsWith('.js')){const relative=path.relative(output,file),typescript=path.join(source,relative.replace(/\.js$/,'.ts'));if(!fs.existsSync(typescript)){fs.unlinkSync(file);console.log('Removed obsolete engine module: '+relative)}}}}
if(fs.existsSync(output))prune(output);
