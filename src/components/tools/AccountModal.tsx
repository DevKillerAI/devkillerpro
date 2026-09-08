'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {UserRound,ArrowUpRight,ShieldCheck} from 'lucide-react';
import WorkspaceModal from './WorkspaceModal';
import type {Locale} from '@/lib/tools/registry';
type Account={name:string;email:string;generatorEnabled:boolean};
export default function AccountModal({locale,onClose}:{locale:Locale;onClose:()=>void}){
 const [data,setData]=useState<Account|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 const t=(en:string,pt:string)=>locale==='pt'?pt:en;
 useEffect(()=>{const controller=new AbortController();setError(false);fetch('/api/account',{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const value=await r.json();if(!value.account)throw Error();setData(value.account);}).catch(e=>{if(e.name!=='AbortError')setError(true);});return()=>controller.abort();},[retry]);
 return <WorkspaceModal title={t('My account','Minha conta')} closeLabel={t('Close','Fechar')} onClose={onClose}><div className="dk-account-intro"><div className="dk-account-avatar"><UserRound size={28}/></div><div><strong>{data?.name||'DevKiller'}</strong><p>{t('One account for everything you create.','Uma conta para tudo o que você cria.')}</p></div></div>{error?<div role="alert" className="dk-workspace-notice">{t('Unable to load your account.','Não foi possível carregar sua conta.')} <button onClick={()=>setRetry(x=>x+1)}>{t('Try again','Tentar novamente')}</button></div>:!data?<p role="status">{t('Loading your account…','Carregando sua conta…')}</p>:<dl className="dk-account-details"><div><dt>{t('Name','Nome')}</dt><dd>{data.name}</dd></div><div><dt>Email</dt><dd>{data.email}</dd></div><div><dt>DK Tools</dt><dd>{t('Basic tools available','Ferramentas básicas disponíveis')}</dd></div><div><dt>DK Create</dt><dd>{data.generatorEnabled?t('Access enabled','Acesso habilitado'):t('Access not enabled yet','Acesso ainda não habilitado')}</dd></div></dl>}<div className="dk-account-links"><Link href="/projects" onClick={onClose}>{t('My projects','Meus projetos')}<ArrowUpRight size={17}/></Link><Link href="/plans" onClick={onClose}>{t('Explore plans','Conhecer planos')}<ArrowUpRight size={17}/></Link></div><p className="dk-account-note"><ShieldCheck size={16}/>{t('Your Tools and Create share this sign-in.','Seu Tools e seu Create compartilham este login.')}</p></WorkspaceModal>;
}
