import { notFound } from 'next/navigation';
import { requireOwnerAdmin } from '@/lib/server/adminAccess';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
export const dynamic='force-dynamic';
export default async function AdminPage(){
  try{await requireOwnerAdmin();}catch{notFound();}
  return <AdminDashboard/>;
}
