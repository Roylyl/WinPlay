const test=require('node:test'),assert=require('node:assert/strict');const {physicalDisplay,videoSize,dipVideoBounds}=require('../src/display-settings.cjs');
test('custom video pixel size stays fixed at Windows DPI factors',()=>{for(const scaleFactor of [1,1.25,1.5,1.75,2]){const d={bounds:{x:0,y:0,width:1920/scaleFactor,height:1080/scaleFactor},scaleFactor};const physical=physicalDisplay(d);assert.equal(physical.width,1920);assert.equal(physical.height,1080);const size=videoSize({width:1280,height:720},physical);assert.deepEqual(size,{width:1280,height:720,fullScreen:false});assert.equal(dipVideoBounds(d,size).width,Math.round(1280/scaleFactor))}});
test('maximum custom size and fullscreen select full monitor pixels',()=>{const p={width:2560,height:1440};assert.deepEqual(videoSize({fullScreen:true,width:1280,height:720},p),{width:2560,height:1440,fullScreen:true});assert.equal(videoSize({width:2560,height:1440},p).fullScreen,true);assert.throws(()=>videoSize({width:2562,height:720},p),/2560×1440/);assert.throws(()=>videoSize({width:1280,height:1442},p),/2560×1440/)});
test('native monitor rect corrects rounded Electron DIP dimensions before fullscreen negotiation',()=>{
 const display={bounds:{x:0,y:0,width:1707,height:1068},scaleFactor:1.5};
 const monitors=[{x:0,y:0,width:2560,height:1600,workArea:{x:0,y:0,width:2560,height:1528},primary:true}];
 const physical=physicalDisplay(display,bounds=>({x:0,y:0,width:Math.round(bounds.width*1.5),height:Math.round(bounds.height*1.5)}),monitors);
 assert.equal(physical.width,2560);assert.equal(physical.height,1600);assert.equal(physical.workArea.height,1528);
 assert.deepEqual(videoSize({fullScreen:true},physical),{width:2560,height:1600,fullScreen:true});
 assert.throws(()=>videoSize({width:2560,height:1602},physical),/2560×1600/);
});
test('native monitor matching uses the converted centre across mixed DPI and negative desktop positions',()=>{
 const monitors=[{x:-2560,y:0,width:2560,height:1440},{x:0,y:0,width:2560,height:1600},{x:2560,y:0,width:1920,height:1080}];
 const display={bounds:{x:-1707,y:0,width:1707,height:960},scaleFactor:1.5};
 const physical=physicalDisplay(display,()=>({x:-2560,y:0,width:2561,height:1440}),monitors);
 assert.equal(physical.x,-2560);assert.equal(physical.width,2560);assert.equal(physical.height,1440);
 const unmatched=physicalDisplay(display,()=>({x:10000,y:0,width:1920,height:1080}),monitors);
 assert.equal(unmatched.x,10000);assert.equal(unmatched.width,1920);
});
