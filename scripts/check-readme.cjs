// SPDX-License-Identifier: GPL-3.0-or-later
// Render the README in Chromium without interacting with other applications.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
app.whenReady().then(async()=>{
 const {marked}=await import('marked');
 const html=marked.parse(fs.readFileSync(path.join(root,'README.md'),'utf8'),{gfm:true});
 const file=path.join(root,'README.preview.html');
 fs.writeFileSync(file,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WinPlay README</title><style>body{max-width:960px;margin:36px auto;padding:0 24px;font:16px/1.75 "Segoe UI",sans-serif;color:#252525}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #ddd;padding:8px;text-align:left}pre{background:#f4f4f4;padding:16px;overflow:auto}code{font-family:Consolas,monospace}a{color:#0969da}h1,h2,h3{line-height:1.4}h2{border-bottom:1px solid #ddd;padding-bottom:8px}</style>${html}`);
 const win=new BrowserWindow({width:1150,height:850,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await win.loadFile(file);
 win.showInactive();await new Promise(r=>setTimeout(r,250));
 const dom=await win.webContents.executeJavaScript(`({h1:document.querySelectorAll('h1').length,h2:document.querySelectorAll('h2').length,tables:document.querySelectorAll('table').length,strong:document.querySelectorAll('strong').length,lists:document.querySelectorAll('ol,ul').length,images:[...document.images].map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0})),horizontalOverflow:document.documentElement.scrollWidth>innerWidth})`);
 const dir=path.join(root,'docs/validation');
 fs.writeFileSync(path.join(dir,'readme-desktop.png'),(await win.webContents.capturePage()).toPNG());
 win.setSize(520,850);await new Promise(r=>setTimeout(r,200));
 const narrow=await win.webContents.executeJavaScript(`({horizontalOverflow:document.documentElement.scrollWidth>innerWidth,tableOverflow:[...document.querySelectorAll('table')].some(t=>t.getBoundingClientRect().right>innerWidth)})`);
 fs.writeFileSync(path.join(dir,'readme-narrow.png'),(await win.webContents.capturePage()).toPNG());
 const passed=dom.h1===1&&dom.h2>=5&&dom.tables>=1&&dom.lists>=1&&dom.images.every(i=>i.loaded)&&!dom.horizontalOverflow&&!narrow.horizontalOverflow;
 fs.writeFileSync(path.join(dir,'readme-checks.json'),JSON.stringify({renderer:'marked GFM + Electron Chromium',version:app.getVersion(),passed,desktop:dom,narrow},null,2));
 app.exit(passed?0:1);
}).catch(e=>{console.error(e);app.exit(1)});
