/** Bind-mounted artifacts retain the non-root Linux service identity, including 0600 configs. */
export function containerIdentityArgs(platform: string = process.platform, uid = process.getuid?.(), gid = process.getgid?.()): string[] {
  if(platform !== 'linux')return ['--user=1000:1000'];
  if(!Number.isSafeInteger(uid)||!Number.isSafeInteger(gid)||(uid??0)<=0||(gid??0)<=0) {
    throw new Error('Linux generation must run under a dedicated non-root service account.');
  }
  return [`--user=${uid}:${gid}`,'--env','HOME=/tmp'];
}
