import Portal from '@/components/tools/Portal';
import {pageMetadata} from '@/lib/site-metadata';
export const metadata=pageMetadata('Support DevKiller','Support the DevKiller ecosystem with an optional contribution. Basic tools remain free; AI tools and DK Create have separate plans.','/support');
export default function Page(){return <Portal view="support"/>;}
