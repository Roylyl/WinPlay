// Display and requested-video sizes are physical pixels. Electron bounds are DIPs.
function physicalDisplay(display,convert,nativeMonitors=[]){
 const bounds=convert?convert(display.bounds):{x:Math.round(display.bounds.x*display.scaleFactor),y:Math.round(display.bounds.y*display.scaleFactor),width:Math.round(display.bounds.width*display.scaleFactor),height:Math.round(display.bounds.height*display.scaleFactor)};
 // DIP bounds have already been rounded by Chromium. Converting them back can
 // add physical pixels (e.g. 1068 DIP at 150% becomes 1602 instead of 1600).
 // The converted centre identifies the monitor; Win32 supplies its exact rect.
 const center={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
 const native=nativeMonitors.find(m=>Number.isInteger(m.width)&&m.width>0&&Number.isInteger(m.height)&&m.height>0&&center.x>=m.x&&center.x<m.x+m.width&&center.y>=m.y&&center.y<m.y+m.height);
 return {...(native||bounds),scaleFactor:display.scaleFactor};
}
function videoSize(settings,physical){const width=settings.fullScreen?physical.width:settings.width,height=settings.fullScreen?physical.height:settings.height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<320||height<200||width>physical.width||height>physical.height)throw new Error(`自定义像素不得超过所选屏幕的${physical.width}×${physical.height}`);if(width%2||height%2)throw new Error('请使用偶数像素尺寸');return {width,height,fullScreen:width===physical.width&&height===physical.height}}
function dipVideoBounds(display,size){const scale=display.scaleFactor;const width=Math.round(size.width/scale),height=Math.round(size.height/scale);return {x:display.bounds.x+Math.round((display.bounds.width-width)/2),y:display.bounds.y+Math.round((display.bounds.height-height)/2),width,height}}
module.exports={physicalDisplay,videoSize,dipVideoBounds};
