#!/usr/bin/env python3
"""Publish exact registered app hosts. No wildcard hostnames or on-demand TLS."""
import json,pathlib,re,subprocess,os
root=pathlib.Path('/opt/devkiller/.devkiller/preview-gateway')
domain='2-28-120-239.sslip.io'
blocks=[]
for file in sorted(root.glob('dkp-*.json')):
    if len(blocks)>=128: raise RuntimeError('Preview limit')
    r=json.loads(file.read_text())
    key=r.get('key','')
    if not re.fullmatch('[a-f0-9]{64}',key): raise RuntimeError('Invalid key')
    host='dkp-'+key[:24]+'.'+domain
    if r.get('host')!=host or file.name!='dkp-'+key[:24]+'.json': raise RuntimeError('Invalid host binding')
    inspected=subprocess.run(['docker','inspect','dk-v2-preview-'+key[:24]],capture_output=True,text=True)
    if inspected.returncode: continue  # Retired containers must not block unrelated approved apps.
    info=json.loads(inspected.stdout)[0]
    if info['Id']!=r['id'] or info['Config']['Labels'].get('devkiller.v2.preview')!=key: raise RuntimeError('Container mismatch')
    if not info['HostConfig']['ReadonlyRootfs'] or not info['State']['Running']: continue
    blocks.append(host+' {\n  reverse_proxy 127.0.0.1:3010\n}\n')
dest=pathlib.Path('/etc/caddy/approved-previews.caddy')
content='\n'.join(blocks)
if dest.exists() and dest.read_text()==content: raise SystemExit(0)
previous=dest.read_text() if dest.exists() else ''
temp=dest.with_suffix('.tmp');temp.write_text(content);os.chmod(temp,0o644);temp.replace(dest)
try:
    subprocess.run(['caddy','validate','--config','/etc/caddy/Caddyfile'],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['systemctl','reload','caddy'],check=True)
except Exception:
    dest.write_text(previous)
    raise
print('Approved preview host configuration updated:',len(blocks))
