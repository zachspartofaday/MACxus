"""Run only synthetic account-free pack probes. Never starts FH5 or an account service."""
import argparse, hashlib, json, os, secrets, shutil, subprocess, time
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('build',type=Path);parser.add_argument('--engine',required=True,type=Path);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();build=args.build.resolve();engine=args.engine.resolve();root=args.output.resolve();root.mkdir(parents=True,exist_ok=False)
    receipt=json.loads((build/'build.json').read_text())
    manifest=json.loads((Path(__file__).resolve().parents[2]/'assets/fh5-preview/manifest.json').read_text())
    if receipt['files']!=manifest['files']:raise ValueError('Build is not the committed pack candidate')
    for name,expected in manifest['engineFiles'].items():
        if hashlib.sha256((engine/name).read_bytes()).hexdigest()!=expected:raise ValueError('Unexpected Preview component: '+name)
    for name,expected in receipt['files'].items():
        if name not in ['d3d12.dll','xgameruntime.dll','windows.web.dll','macxus-metal4-timestamps.dylib'] or hashlib.sha256((build/'payload'/name).read_bytes()).hexdigest()!=expected:raise ValueError('Pack payload changed')
    env={key:value for key,value in os.environ.items() if not key.startswith(('XODUS_','XUSER_','WINE','CX_','DYLD_','MACXUS_','NEXUS_','Steam','STEAM_'))}
    prefix=root/'prefix';prefix.mkdir();env.update(WINEPREFIX=str(prefix),CX_ROOT=str(engine),WINESERVER=str(engine/'bin/wineserver'),WINELOADER=str(engine/'lib/wine/x86_64-unix/wine'),WINEDEBUG='-all,err+all',WINEDLLOVERRIDES='winemenubuilder.exe,winedbg.exe=d;xgameruntime,windows.web=n,b')
    results=[]
    def run(name,command,extra_env=None):
        with (root/(name+'.log')).open('wb') as log:
            child=subprocess.Popen(list(map(str,command)),env={**env,**(extra_env or {})},stdout=log,stderr=subprocess.STDOUT)
            try:code=child.wait(timeout=120)
            except subprocess.TimeoutExpired:
                subprocess.run([engine/'bin/wineserver','-k'],env=env,timeout=10,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);child.kill();child.wait();raise
        text=(root/(name+'.log')).read_text(errors='replace');summaries=[line for line in text.splitlines() if 'CHECKS' in line or line.startswith('FAIL ')]
        results.append({'name':name,'exitCode':code,'summary':summaries});print(name,code,summaries,flush=True)
        if code:raise ValueError('Synthetic probe failed: '+name)
    try:
        wine=engine/'lib/wine/x86_64-unix/wine';run('wineboot',[wine,'wineboot','--init'])
        system=prefix/'drive_c/windows/system32'
        for name in ['xgameruntime.dll','windows.web.dll']:
            temporary=system/(name+'.pack');shutil.copyfile(build/'payload'/name,temporary);temporary.replace(system/name)
        for name in ['data-fixture','input-layout-contracts','unused-blend-contracts','gpu-clock-reporting','io-lifetime','store-addons']:
            run(name,[wine,build/'probes'/(name+'.exe')])
        for name in ['metal4-counter-probe','metal4-state-probe','metal4-order-probe','metal4-lifetime-probe']:
            # State/order probes exercise the injected bridge, not raw Metal.
            # Counter/lifetime controls deliberately run without injection.
            injected = {'DYLD_INSERT_LIBRARIES':str(build/'payload/macxus-metal4-timestamps.dylib'),
                        'MACXUS_GPU_QUERY_COOKIE':secrets.token_hex(8),
                        'MACXUS_GPU_BRIDGE_LOG':str(root/(name+'-bridge.jsonl')),
                        'D3DM_MTL4':'1'} if name in ['metal4-state-probe','metal4-order-probe'] else None
            run(name,[build/'probes'/name],injected)
    finally:
        subprocess.run([engine/'bin/wineserver','-k'],env=env,timeout=10,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (root/'results.json').write_text(json.dumps({'gameLaunched':False,'accountUsed':False,'results':results},indent=2)+'\n')
if __name__=='__main__':main()
