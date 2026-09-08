import { notFound } from 'next/navigation';
import { requireOwnerAdmin } from '@/lib/server/adminAccess';
import { PILOT_BRIEF } from '@/lib/server/generator/pilotContract';
import { GeneratorPilotStudio } from '@/components/admin/GeneratorPilotStudio';
export const dynamic = 'force-dynamic';
export default async function GeneratorPilotPage() {
  try { await requireOwnerAdmin(); } catch { notFound(); }
  return <GeneratorPilotStudio brief={PILOT_BRIEF} />;
}
