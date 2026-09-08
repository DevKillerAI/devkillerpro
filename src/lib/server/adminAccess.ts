import { accessContext } from './access';
import { database } from './database';
import { ownerAdminAllowed } from '../admin/metrics';
export async function requireOwnerAdmin(req?:Request) {
  const access=await accessContext(req);
  if(access.internal) throw new Error('FORBIDDEN');
  const [user]=await database()`select email from auth.users where id=${access.userId}`;
  if(!ownerAdminAllowed(access.role,user?.email,process.env.DEVKILLER_PILOT_EMAIL,access.internal)) throw new Error('FORBIDDEN');
  return access;
}
