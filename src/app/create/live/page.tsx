import {notFound} from 'next/navigation';
import {requireGeneratorAccess} from '@/lib/server/access';
import {GeneratorWorkbench} from '@/components/generator/GeneratorWorkbench';
export const dynamic='force-dynamic';
export default async function LivePage({searchParams}:{searchParams:Promise<{run?:string}>}) {
  let access;try{access=await requireGeneratorAccess();}catch{notFound();}
  const {run}=await searchParams;if(!run)notFound();return <GeneratorWorkbench ownerId={access.userId} initialRun={run} standalone administration={access.role==='admin'}/>;
}
