import {notFound,redirect} from 'next/navigation';
import Portal from '@/components/tools/Portal';
import {categories,findTool,retiredTools,type Category} from '@/lib/tools/registry';
export async function generateMetadata({params}:{params:Promise<{slug?:string[]}>}){const {slug=[]}=await params;const tool=findTool(slug.join('/'));return {title:tool?.name[0]||'Free online tools',description:tool?.description[0]||'Free tools for images, PDF, audio, text, design and SVG. Process files on your device.'};}
export default async function ToolsPage({params}:{params:Promise<{slug?:string[]}>}){const {slug=[]}=await params;if(!slug.length)return <Portal/>;if(slug.length===1&&slug[0] in categories)return <Portal category={slug[0] as Category}/>;const retired=retiredTools.find(t=>t.id===slug.join('/'));if(retired)redirect('/tools/'+retired.category);const tool=findTool(slug.join('/'));if(!tool)notFound();return <Portal tool={tool}/>;}
