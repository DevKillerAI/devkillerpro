import {redirect} from 'next/navigation';
import Link from 'next/link';
import PlatformHeader from '@/components/tools/PlatformHeader';
import '@/components/generator/workspace-theme.css';
import {requireGeneratorAccess} from '@/lib/server/access';
import {GeneratorWorkbench} from '@/components/generator/GeneratorWorkbench';
export const dynamic='force-dynamic';
export default async function CreatePage({searchParams}:{searchParams:Promise<{run?:string}>}) {
  let access;try{access=await requireGeneratorAccess();}catch(error){
    const reason=error instanceof Error?error.message:'';
    if(reason==='UNAUTHENTICATED')redirect('/login?next=/create');
    const known=['FORBIDDEN','CREDIT_LIMIT','ACCESS_DISABLED'].includes(reason);
    if(!known)throw error;
    return <><PlatformHeader create/><main className="dk-create-surface text-[#111420]"><section className="mx-auto max-w-2xl rounded-2xl border border-rose-100 bg-white p-8"><p className="text-sm text-rose-600">DK Create</p><h1 className="my-4 text-3xl font-bold">{reason==='CREDIT_LIMIT'?'Your generation balance needs attention.':'Your account is connected.'}</h1><p className="text-slate-600">{reason==='ACCESS_DISABLED'?'Access to this account is paused.':reason==='CREDIT_LIMIT'?'Your current generation allowance is exhausted. Contact the workspace owner to review your allowance.':'App generation requires separate access. Contact the workspace owner to enable DK Create for this same account.'}</p><Link className="mt-6 inline-block rounded-xl bg-rose-500 px-5 py-3 text-white" href="/tools">Explore free tools</Link></section></main></>;
  }
  const {run}=await searchParams;return <GeneratorWorkbench ownerId={access.userId} initialRun={run||''} administration={access.role==='admin'}/>;
}
