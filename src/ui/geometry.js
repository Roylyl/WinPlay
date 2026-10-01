(function(scope){
 function contentRect(width,height,videoWidth,videoHeight){const scale=Math.min(width/videoWidth,height/videoHeight);return {x:(width-videoWidth*scale)/2,y:(height-videoHeight*scale)/2,width:videoWidth*scale,height:videoHeight*scale}}
 function coordinates(clientX,clientY,box,videoWidth,videoHeight,clamp=false){const area=contentRect(box.width,box.height,videoWidth,videoHeight),x=(clientX-box.left-area.x)/area.width,y=(clientY-box.top-area.y)/area.height;if(!clamp&&(x<0||x>1||y<0||y>1))return null;return {x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))}}
 function wheelDelta(x,y,mode,width,height,dpi=1){const multiplier=mode===1?16:mode===2?height:1;const gain=.2;return {x:x*multiplier*gain/(width*dpi),y:y*multiplier*gain/(height*dpi)}}
 const exports={contentRect,coordinates,wheelDelta};if(typeof module!=='undefined')module.exports=exports;else scope.winplayGeometry=exports;
})(globalThis);
