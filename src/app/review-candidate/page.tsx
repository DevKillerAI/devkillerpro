"use client";
import { useEffect,useState } from 'react';
import { DynamicMultiLayerSandbox } from '@/components/sandbox/DynamicMultiLayerSandbox';
import { createEmptyWorkspace, workspaceToAppPackage } from '@/lib/workspace/projectWorkspace';
import type { GeneratedAppPackage } from '@/lib/orchestrator/appGenerator';
export default function CandidateReview() {
  const [app,setApp]=useState<GeneratedAppPackage|null>(null),[error,setError]=useState(''),[mission,setMission]=useState('');
  useEffect(()=>{const params=new URLSearchParams(location.search);setMission(params.get('mission')||'');
    fetch(`/api/missions/candidate?${params}`).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setApp(workspaceToAppPackage({...createEmptyWorkspace(),appTitle:'Candidate review',sourceFiles:data.sourceFiles}));}).catch(error=>setError(error.message));
  },[]);
  return <main><header className="border-b border-rose-200 bg-rose-50 p-3 text-xs">Internal candidate review · Not an approved delivery</header>{error?<p>{error}</p>:app?<DynamicMultiLayerSandbox appPackage={app} missionId={mission} standalone/>:<p>Loading candidate…</p>}</main>;
}
