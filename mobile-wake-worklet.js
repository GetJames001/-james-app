'use strict';
// Only a short in-memory PCM chunk crosses to the local recognizer. Never record.
class JamesWakeCapture extends AudioWorkletProcessor{
 constructor(){super();this.buffer=new Float32Array(4096);this.used=0;}
 process(inputs,outputs){
  for(const channel of outputs[0]||[])channel.fill(0);
  const input=inputs[0]?.[0];if(!input)return true;
  for(const sample of input){this.buffer[this.used++]=sample;if(this.used===this.buffer.length){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(4096);this.used=0;}}
  return true;
 }
}
registerProcessor('james-local-wake',JamesWakeCapture);
