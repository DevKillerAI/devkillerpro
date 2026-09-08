'use client';
import {useState} from 'react';
import Link from 'next/link';
import {ImageDown,Images,Scaling,Eraser,Files,FileDown,FileOutput,FileAudio,Video,Download,ScanText,QrCode,ArrowUpRight,Star} from 'lucide-react';
import type {Locale} from '@/lib/tools/registry';

const collection = [
  {name:['Compress Image','Comprimir imagem'],description:['Smaller files. Beautiful images.','Imagens leves, com qualidade.'],icon:ImageDown,path:'image/compress',tone:'pink'},
  {name:['Convert Image','Converter imagem'],description:['Switch between JPG, PNG and WebP.','Converta entre JPG, PNG e WebP.'],icon:Images,path:'image/convert',tone:'pink'},
  {name:['Remove Background','Remover fundo'],description:['Separate the subject automatically.','Separe o objeto do fundo automaticamente.'],icon:Eraser,path:'image/background',tone:'pink'},
  {name:['Merge PDF','Juntar PDFs'],description:['Bring your documents together.','Reúna seus documentos em um PDF.'],icon:Files,path:'pdf/merge',tone:'pink'},
  {name:['Convert PDF','Converter PDF'],description:['Turn images into PDFs. Export PDF pages.','Crie PDFs com imagens. Exporte páginas.'],icon:FileOutput,path:'pdf-convert',tone:'pink'},
  {name:['Convert Audio','Converter áudio'],description:['Your sound in MP3, WAV or OGG.','Seu áudio em MP3, WAV ou OGG.'],icon:FileAudio,path:'audio/convert',tone:'purple'},
  {name:['Convert Video','Converter vídeo'],description:['Prepare your video for its next destination.','Prepare seu vídeo para o próximo destino.'],icon:Video,path:'audio/video',tone:'blue'},
  {name:['Social Video Importer','Importar vídeo social'],description:['Bring videos you own or have permission to use.','Importe vídeos seus ou com autorização.'],icon:Download,path:'audio/social',tone:'blue'},
  {name:['OCR / Extract Text','OCR / Extrair texto'],description:['Turn scanned pages into editable text.','Transforme páginas em texto editável.'],icon:ScanText,path:'image/ocr',tone:'blue'},
  {name:['Resize Image','Redimensionar imagem'],description:['The right dimensions for your next idea.','As medidas certas para sua próxima ideia.'],icon:Scaling,path:'image/resize',tone:'pink'},
  {name:['Compress PDF','Comprimir PDF'],description:['Optimize documents for easier sharing.','Otimize documentos para compartilhar.'],icon:FileDown,path:'pdf/compress',tone:'pink'},
  {name:['QR Code Generator','Gerador de QR Code'],description:['Make your link one scan away.','Seu link a uma leitura de distância.'],icon:QrCode,path:'design/qr',tone:'green'},
];

export default function HomeTools({locale,query}:{locale:Locale;query:string}) {
  const [pdfOpen,setPdfOpen]=useState(false);
  const pt=locale==='pt', pick=(text:string[])=>text[pt?1:0];
  const items=collection.filter(item=>[...item.name,...item.description].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="dk-home-tools" aria-labelledby="dk-home-tools-title">
    <div className="dk-home-tools-heading"><Star size={24}/><div><h2 id="dk-home-tools-title">{pt?'Pequenas tarefas. Grandes possibilidades.':'Everyday tools. Bigger possibilities.'}</h2><p>{pt?'Escolha o que precisa. Resolva em poucos passos.':'Pick your task. Get it done in a few steps.'}</p></div></div>
    <div className="dk-home-tools-grid">{items.map(item=>{
      const Icon=item.icon;
      const content=<><span className={`dk-home-icon dk-home-icon-${item.tone}`}><Icon size={25} strokeWidth={1.8}/></span><span className="dk-home-copy"><strong>{pick(item.name)}</strong><span>{pick(item.description)}</span></span>{item.path?<ArrowUpRight className="dk-home-arrow" size={17}/>:<span className="dk-home-soon">{pt?'Em breve':'Coming soon'}</span>}</>;
      return item.path==='pdf-convert'?<button type="button" key={item.name[0]} className="dk-home-tool" aria-expanded={pdfOpen} aria-controls="dk-pdf-conversions" onClick={()=>setPdfOpen(!pdfOpen)}>{content}</button>:item.path?<Link key={item.name[0]} className="dk-home-tool" href={'/tools/'+item.path}>{content}</Link>:<article key={item.name[0]} className="dk-home-tool dk-home-tool-planned">{content}</article>;
    })}</div>
    {!items.length&&<p role="status">{pt?'Nenhuma ferramenta encontrada.':'No matching tools.'}</p>}
    {pdfOpen&&<div id="dk-pdf-conversions" className="dk-home-pdf"><strong>{pt?'Como você quer converter?':'What would you like to convert?'}</strong><div><Link href="/tools/pdf/images-to-pdf">{pt?'Imagens → PDF':'Images → PDF'}</Link><Link href="/tools/pdf/to-images">{pt?'PDF → Imagens':'PDF → Images'}</Link></div><p>{pt?'Conversões de Word, Excel e PowerPoint ainda não estão disponíveis.':'Word, Excel and PowerPoint conversion is not available yet.'}</p></div>}
  </section>;
}
