"""Owned-shader blend comparison only. Never starts a game/account or changes an installed prefix."""
import argparse,json,os,subprocess
from pathlib import Path

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--engine',required=True,type=Path)
    p.add_argument('--proxy',required=True,type=Path)
    p.add_argument('--probe',required=True,type=Path)
    p.add_argument('--contracts',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args();engine=a.engine.resolve();output=a.output.resolve();output.mkdir(exist_ok=False,parents=True)
    prefix=output/'prefix';prefix.mkdir();wine=engine/'lib/wine/x86_64-unix/wine'
    env={k:v for k,v in os.environ.items() if not k.startswith(('WINE','CX_','DYLD_','MACXUS_','XODUS_','XUSER_','NEXUS_','STEAM_','Steam'))}
    env.update(WINEPREFIX=str(prefix),CX_ROOT=str(engine),WINESERVER=str(engine/'bin/wineserver'),WINELOADER=str(wine),WINEDEBUG='-all,err+all',WINEDLLOVERRIDES='winemenubuilder.exe,winedbg.exe=d',
               WINEDLLPATH=':'.join(str(engine/x) for x in ['lib/apple_gptk/wine/x86_64-windows','lib/apple_gptk/wine','lib/wine/x86_64-windows','lib/wine']),
               HB_D3D12_REAL='Z:'+str(engine/'lib/apple_gptk/wine/x86_64-windows/d3d12.dll').replace('/','\\'),
               MACXUS_TIMESTAMP_ONLY='1',MACXUS_APPEND_ONLY='1',MACXUS_FH5_UNUSED_BLEND='1',HB_TSSHIM_DEBUG='0',D3DM_MTL4='1')
    results=[]
    def run(name,args,flag='0',expected=0):
        with (output/(name+'.log')).open('wb') as log:
            child=subprocess.Popen([str(wine),*map(str,args)],env={**env,'MACXUS_FH5_ACTIVE_BLEND':flag},stdout=log,stderr=subprocess.STDOUT)
            try:code=child.wait(timeout=90)
            except subprocess.TimeoutExpired:
                subprocess.run([engine/'bin/wineserver','-k'],env=env,timeout=10,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                child.kill();child.wait();raise
        lines=(output/(name+'.log')).read_text(errors='replace').splitlines()
        summary=[s for s in lines if s.startswith(('ACTIVE_BLEND','ERROR','OUTPUT_SIGNATURE'))]
        results.append(dict(name=name,exitCode=code,expected=expected,summary=summary));print(name,code,summary,flush=True)
        if code!=expected:raise ValueError('Unexpected probe result: '+name)
    try:
        run('wineboot',['wineboot','--init'])
        run('contracts',[a.contracts.resolve()])
        for api in ['direct','stream']:
            for outputs in [1,2,3,4]:
                for depth in [False,True]:
                    for flag in ['0','1']:
                        name=f'{api}-outputs{outputs}-depth{int(depth)}-enabled{flag}'
                        run(name,[a.probe.resolve(),a.proxy.resolve(),str(outputs),api,*(['depth'] if depth else [])],flag,0 if flag=='1' or outputs==2 else 10)
    finally:
        subprocess.run([engine/'bin/wineserver','-k'],env=env,timeout=10,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (output/'results.json').write_text(json.dumps({'gameLaunched':False,'accountUsed':False,'results':results},indent=2)+'\n')
if __name__=='__main__':main()
