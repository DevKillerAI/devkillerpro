import Link from 'next/link';
import type {Locale} from '@/lib/tools/registry';
export default function PlatformFooter({locale='en'}:{locale?:Locale}){
 const pt=locale==='pt';
 return <footer className="dk-platform-footer"><div><Link className="dk-footer-wordmark" href="/">D<span>K</span></Link><section><strong>{pt?'Apoie o ecossistema DK.':'Support the DK ecosystem.'}</strong><p>{pt?'Ferramentas gratuitas. IA e Create têm planos próprios.':'Free tools. AI and Create have their own plans.'}</p></section><Link className="dk-footer-support" href="/support">{pt?'Apoie o DK':'Support DK'} ♡</Link></div><nav aria-label={pt?'Links do rodapé':'Footer links'}><Link href="/tools">{pt?'Ferramentas':'Tools'}</Link><Link href="/plans">{pt?'Planos':'Plans'}</Link><Link href="/create">DK Create</Link></nav></footer>;
}
