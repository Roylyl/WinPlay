class WinPlayCapture extends AudioWorkletProcessor {
 constructor(options){super();this.frames=options.processorOptions.frames;this.channels=options.processorOptions.channels;this.pending=[];this.count=0}
 process(inputs){const input=inputs[0];if(!input?.length)return true;const block=new Float32Array(input[0].length*this.channels);for(let f=0;f<input[0].length;f++)for(let c=0;c<this.channels;c++)block[f*this.channels+c]=input[c]?.[f]??input[0][f];this.pending.push(block);this.count+=input[0].length;
  while(this.count>=this.frames){const all=new Float32Array(this.count*this.channels);let offset=0;for(const b of this.pending){all.set(b,offset);offset+=b.length}const packet=all.slice(0,this.frames*this.channels),rest=all.slice(packet.length);this.pending=rest.length?[rest]:[];this.count=rest.length/this.channels;this.port.postMessage(packet,[packet.buffer])}return true;
 }
}registerProcessor('winplay-capture',WinPlayCapture);
