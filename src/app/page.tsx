import Portal from '@/components/tools/Portal';
import {pageMetadata,siteDescription} from '@/lib/site-metadata';
export const metadata=pageMetadata('DevKiller — Tools for today. Apps for tomorrow.',siteDescription,'/');
export default function HomePage(){return <Portal/>;}
