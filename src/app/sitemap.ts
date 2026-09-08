import type {MetadataRoute} from 'next';
import {siteOrigin} from '@/lib/site-metadata';
import {tools} from '@/lib/tools/registry';
export default function sitemap():MetadataRoute.Sitemap{return ['','/tools','/plans','/support',...tools.map(t=>'/tools/'+t.id)].map(path=>({url:siteOrigin+path}));}
