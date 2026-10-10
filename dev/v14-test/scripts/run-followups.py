from pathlib import Path
import subprocess,os,time
main=Path('/Users/jaumepuig/Documents/growth-hackathon');out=main/'dev/v14-test'
env=os.environ.copy();env.update(ASTRA_MOCK='1',HTTPS_PORT='0',E2E_WEBKIT=str(Path.home()/'Library/Caches/ms-playwright/webkit-2311/pw_run.sh'))
def checkpoint(s):subprocess.run(['python3',str(out/'scripts/checkpoint.py'),s],cwd=main)
for name,args,timeout in [
 ('fallback',['fallback.cjs'],20),
 ('steering-replay',['steering-replay.cjs'],20),
 ('rotate-wipe',['rotate-wipe.mjs'],90),
 ('crowd-phone-drawn-effects',['crowd-drawn.mjs','phone','--effects'],100),
 ('crowd-tv-drawn-effects',['crowd-drawn.mjs','tv','--effects'],100),
]:
 checkpoint('START '+name);t=time.time()
 with (out/'logs'/f'{name}.log').open('w') as f:
  p=subprocess.Popen(['node',str(out/'scripts'/args[0]),*args[1:]],cwd=main,env=env,stdout=f,stderr=subprocess.STDOUT)
  try:code=p.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   p.terminate()
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:p.kill();p.wait()
   code=124
 checkpoint(f'DONE {name}; exit {code}; {time.time()-t:.1f}s.');print(name,code,flush=True)
