import {textOutput,canvas2d,canvasBlob,type Output} from './core';
import type {Values} from './options';
export async function ocrEngine(file:File,v:Values,signal:AbortSignal,progress:(s:string)=>void):Promise<Output[]>{
 const ocrModule=await import('tesseract.js');const {createWorker}=ocrModule.default||ocrModule;
 const worker=await createWorker(v.language==='por'?'por':'eng',1,{workerPath:'/tools-assets/ocr/worker.min.js',corePath:'/tools-assets/ocr',langPath:'/tools-assets/ocr',gzip:false,logger:m=>{if(m.status)progress(m.status);}});
 const stop=()=>{void worker.terminate();};signal.addEventListener('abort',stop,{once:true});
 try{
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
    const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/tools-assets/pdf.worker.min.mjs';
    const task=pdfjs.getDocument({data:await file.arrayBuffer()});
    try{const pdf=await task.promise;if(pdf.numPages>20)throw Error('OCR limit: 20 pages. / Limite OCR: 20 páginas.');let text='';
      for(let n=1;n<=pdf.numPages;n++){if(signal.aborted)throw new DOMException('Cancelled','AbortError');const page=await pdf.getPage(n);const viewport=page.getViewport({scale:1.5});const {c,ctx}=canvas2d(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvas:c,canvasContext:ctx,viewport}).promise;const result=await worker.recognize(await canvasBlob(c));text+=result.data.text+'\n\n';page.cleanup();}return [textOutput(text,'extracted-text.txt')];
    }finally{await task.destroy();}
  }
  const result=await worker.recognize(file);return [textOutput(result.data.text,'extracted-text.txt')];
 }finally{signal.removeEventListener('abort',stop);await worker.terminate();}
}
