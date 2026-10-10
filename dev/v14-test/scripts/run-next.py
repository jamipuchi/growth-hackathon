from pathlib import Path
import subprocess,os,json,shutil,time
main=Path('/Users/jaumepuig/Documents/growth-hackathon'); out=main/'dev/v14-test';root=Path('/private/tmp/claude-501/v14-test')
env=os.environ.copy();env.update(ASTRA_MOCK='1',HTTPS_PORT='0',E2E_WEBKIT=str(Path.home()/'Library/Caches/ms-playwright/webkit-2311/pw_run.sh'))
def cp(msg):subprocess.run(['python3',str(out/'scripts/checkpoint.py'),msg],cwd=main)
def run(name,args,timeout=180):
 cp('START '+name+'; runner writes logs/'+name+'.log; own child cleanup handlers installed.')
 t=time.time()
 with (out/'logs'/f'{name}.log').open('w') as f:
  p=subprocess.Popen(args,cwd=main,env=env,stdout=f,stderr=subprocess.STDOUT)
  try: code=p.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   p.terminate()
   try:p.wait(timeout=12)
   except subprocess.TimeoutExpired:p.kill();p.wait()
   code=124
 cp('DONE '+name+f'; exit {code}; elapsed {time.time()-t:.1f}s. Read log/report before interpreting.')
 print(name,code,flush=True)
 return code
run('entity-mock',['node',str(out/'scripts/entity.mjs'),'--port','8455','--mock'],240)
if (out/'data/entity/report.json').exists():shutil.copy2(out/'data/entity/report.json',out/'data/entity-mock.json')
if (out/'data/entity/out/server.log').exists():shutil.copy2(out/'data/entity/out/server.log',out/'logs/entity-mock-server.log')
# Real mode is capped by the harness; no file credentials copied, read, or logged. Inherited credentials, if any, are used only by Astra.
run('entity-real6',['node',str(out/'scripts/entity.mjs'),'--port','8455','--real','6','--no-browser'],200)
if (out/'data/entity/report.json').exists():shutil.copy2(out/'data/entity/report.json',out/'data/entity-real6.json')
if (out/'data/entity/out/server.log').exists():shutil.copy2(out/'data/entity/out/server.log',out/'logs/entity-real6-server.log')
run('phone-tour',['node',str(out/'scripts/phone-tour.mjs'),'--port','8456','--bots','2'],180)
run('phone-features',['node',str(out/'scripts/features.mjs')],180)
run('tv-feed',['node',str(root/'dev/v13-tv/unit-feed.mjs')],30)
run('scenario-phone',['node',str(out/'scripts/scenario.mjs'),'phone'],240)
run('scenario-tv',['node',str(out/'scripts/scenario.mjs'),'tv'],240)
for device in ['phone','tv']:
 run('crowd-'+device+'-effects',['node',str(out/'scripts/crowd.mjs'),device,'--effects'],100)
for device in ['phone','tv']:
 run('builders-'+device,['node',str(out/'scripts/builders.mjs'),device],150)
run('pad-repro',['node',str(out/'scripts/pad-repro.mjs')],100)
run('server-decisions',['node',str(out/'scripts/decisions.mjs')],35)
run('slope',['node',str(out/'scripts/slope.cjs')],20)

run('fallback',['node',str(out/'scripts/fallback.cjs')],20)

run('rotate-wipe',['node',str(out/'scripts/rotate-wipe.mjs')],100)
