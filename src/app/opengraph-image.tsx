import {ImageResponse} from 'next/og';
export const alt='DevKiller — DK Tools and DK Create';
export const size={width:1200,height:630};
export const contentType='image/png';
export default function Image(){return new ImageResponse(<div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',padding:'64px',background:'linear-gradient(120deg,#fff5f1,#ffd7e1)',fontFamily:'sans-serif',color:'#111420'}}><div style={{display:'flex',fontSize:42,fontWeight:700}}>Dev<span style={{color:'#ff5977'}}>Killer</span></div><div style={{display:'flex',fontSize:72,fontWeight:700,marginTop:62}}>Solve it now.</div><div style={{display:'flex',fontSize:72,fontWeight:700,color:'#f3416d'}}>Build what’s next.</div><div style={{display:'flex',fontSize:27,marginTop:38}}>DK Tools · Free online tools</div><div style={{display:'flex',fontSize:27,marginTop:10}}>DK Create · Your next idea, turned into an app</div></div>,size);}
