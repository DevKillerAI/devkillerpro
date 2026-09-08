import type {MetadataRoute} from 'next';
import {siteOrigin} from '@/lib/site-metadata';
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:'/',disallow:['/api/','/admin','/projects','/create','/login','/invite','/sandbox','/review-candidate']},sitemap:siteOrigin+'/sitemap.xml'};}
