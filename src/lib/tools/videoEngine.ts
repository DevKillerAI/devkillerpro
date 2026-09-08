import type {Output} from './core';
import {number} from './core';
import type {Values} from './options';
export function videoArgs(v:Values){
 const format=['mp4','webm','gif','mp3','wav'].includes(v.format)?v.format:'mp4';
 const args=['-i','input'];
 const start=number(v.start,0,0,600),duration=number(v.duration,60,1,600);
 args.push('-ss',String(start),'-t',String(duration));
 if(['mp3','wav'].includes(format))args.push('-vn','-c:a',format==='mp3'?'libmp3lame':'pcm_s16le');
 else {
   const size=v.size==='vertical'?'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2':v.size==='square'?'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2':'scale=trunc(iw/2)*2:trunc(ih/2)*2';
   args.push('-vf',format==='gif'?'fps=12,scale=480:-1':size);
   if(format==='mp4')args.push('-c:v','libx264','-preset','ultrafast','-crf','25','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart');
   if(format==='webm')args.push('-c:v','libvpx','-deadline','realtime','-cpu-used','5','-c:a','libvorbis');
   if(v.mute==='yes'||format==='gif')args.push('-an');
 }
 args.push('output.'+format);return {format,args};
}
export async function videoEngine(file:File,v:Values,signal:AbortSignal,progress:(s:string)=>void):Promise<Output[]>{
 const {FFmpeg}=await import('@ffmpeg/ffmpeg');const engine=new FFmpeg();let wasm='';let unsupportedAv1=false;engine.on('log',({message})=>{if(message.includes('AV1 decoding'))unsupportedAv1=true;});
 const stop=()=>engine.terminate();signal.addEventListener('abort',stop,{once:true});
 try{
  progress('Loading video engine… / Carregando motor de vídeo…');
  const parts=await Promise.all([0,1,2].map(async n=>{const r=await fetch('/tools-assets/ffmpeg/ffmpeg-core.wasm.'+n,{signal});if(!r.ok)throw Error('Video engine unavailable');return r.arrayBuffer();}));
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  wasm=URL.createObjectURL(new Blob(parts,{type:'application/wasm'}));
  await engine.load({classWorkerURL:'/tools-assets/ffmpeg/worker.js',coreURL:'/tools-assets/ffmpeg/ffmpeg-core.js',wasmURL:wasm});
  await engine.writeFile('input',new Uint8Array(await file.arrayBuffer()));
  progress('Converting on your device… / Convertendo no seu dispositivo…');
  const {format,args}=videoArgs(v);const code=await engine.exec(args,180000);
  if(code!==0)throw Error(unsupportedAv1?'AV1 input is not supported. Export your source as H.264 or VP8 first. / Exporte a origem como H.264 ou VP8.':'Conversion failed. Check the codec, audio track or try a shorter clip. / Confira o codec, a faixa de áudio ou tente um vídeo menor.');
  const result=await engine.readFile('output.'+format);if(typeof result==='string'||!result.length)throw Error('Empty video output');
  const type=({mp4:'video/mp4',webm:'video/webm',gif:'image/gif',mp3:'audio/mpeg',wav:'audio/wav'} as Record<string,string>)[format];
  return [{name:'video.'+format,blob:new Blob([new Uint8Array(result).buffer],{type}),preview:format==='gif'?'image':['mp3','wav'].includes(format)?'audio':'video'}];
 }finally{signal.removeEventListener('abort',stop);engine.terminate();if(wasm)URL.revokeObjectURL(wasm);}
}
