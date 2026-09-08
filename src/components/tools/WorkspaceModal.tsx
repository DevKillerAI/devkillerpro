'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import './workspace.css';
export default function WorkspaceModal({title,onClose,children,closeLabel='Close'}:{title:string;onClose:()=>void;children:ReactNode;closeLabel?:string}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current,previous=document.activeElement as HTMLElement|null;dialog?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog?.close();document.body.style.overflow=overflow;previous?.focus();};},[]);
 return createPortal(<dialog ref={ref} className="dk-workspace-modal" aria-labelledby="dk-modal-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}><header><h2 id="dk-modal-title">{title}</h2><button autoFocus onClick={onClose} aria-label={closeLabel}><X size={20}/></button></header>{children}</dialog>,document.body);
}
