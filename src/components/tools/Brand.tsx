'use client';
import {useEffect,useState,type CSSProperties} from 'react';
import Link from 'next/link';
import BrandScript from './BrandScript';
export default function Brand({create=false}:{create?:boolean}){
 const [animate,setAnimate]=useState(false);
 useEffect(()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;try{if(sessionStorage.getItem(create?'dk-create-intro-v1':'dk-brand-intro-v1'))return;sessionStorage.setItem(create?'dk-create-intro-v1':'dk-brand-intro-v1','1');}catch{}setAnimate(true);const timer=setTimeout(()=>setAnimate(false),3400);return()=>clearTimeout(timer);},[create]);
 const letters=(word:string,offset:number)=>Array.from(word).map((char,i)=><span key={i} className="dk-brand-letter" style={{'--letter-delay':`${(offset+i)*.075}s`} as CSSProperties}>{char}</span>);
 return <Link href={create?'/create':'/'} className={`dk-brand dk-animated-brand${animate?' dk-brand-running':''}`} aria-label={create?'DK Create — DevKiller':'DK Tools — DevKiller'}><span className="dk-brand-word" aria-hidden="true"><span>{letters('D',0)}</span><span className="dk-brand-fold dk-brand-ev">{letters('ev',1)}</span><span className="dk-brand-coral">{letters('K',3)}</span><span className="dk-brand-fold dk-brand-iller dk-brand-coral">{letters('iller',4)}</span></span><BrandScript word={create?'Create':'Tools'} className={create?'dk-brand-create':''}/></Link>;
}
