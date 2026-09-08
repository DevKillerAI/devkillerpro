import type { AccessContext } from '../access';
export function knowledgeTenant(access:AccessContext,scope:'personal'|'platform',ownerAdminVerified=false) {
  if(access.internal||!access.userId)throw new Error('FORBIDDEN');
  if(scope==='platform'){
    if(access.role!=='admin'||!ownerAdminVerified)throw new Error('FORBIDDEN');
    return 'devkiller';
  }
  return access.userId;
}
