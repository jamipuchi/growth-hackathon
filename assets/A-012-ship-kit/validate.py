"""Static asset evidence; no game code or physical-device performance assertions."""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
checks=[]
def check(name, ok, detail=None):
    checks.append({'name':name,'pass':bool(ok), 'detail':detail})

manifest=json.loads((ROOT/'texture-manifest.json').read_text())
for name, spec in manifest['files'].items():
    p=ROOT/name; image=Image.open(p); image.load()
    check(name+' PNG decodes',image.format=='PNG')
    check(name+' power of two <=1024',all(v<=1024 and v&(v-1)==0 for v in image.size),image.size)
    check(name+' recorded SHA256',hashlib.sha256(p.read_bytes()).hexdigest()==spec['sha256'])
    check(name+' embedded image only',not image.info.get('icc_profile'))

panel=np.array(Image.open(ROOT/'panels.png'))
normal=np.array(Image.open(ROOT/'panels-normal.png'))
check('panel neutral grayscale',np.array_equal(panel[:,:,0],panel[:,:,1]) and np.array_equal(panel[:,:,0],panel[:,:,2]))
for name,arr in [('panels',panel),('normal',normal)]:
    check(name+' exact horizontal repeat seam',np.array_equal(arr[:,0],arr[:,-1]))
    check(name+' exact vertical repeat seam',np.array_equal(arr[0,:],arr[-1,:]))
v=normal.astype(float)/255*2-1
check('normal unit length within RGB8 quantization',np.max(np.abs(np.linalg.norm(v,axis=-1)-1))<.014)
check('normal faces out of surface',v[:,:,2].min()>.8,float(v[:,:,2].min()))

atlas=np.array(Image.open(ROOT/'surfaces.png'))
for name,r in manifest['surfaceRectsPixelsTopLeft'].items():
    x,y,w,h=r['x'],r['y'],r['width'],r['height']; core=atlas[y:y+h,x:x+w]
    check(name+' exact X repeat seam',np.array_equal(core[:,0],core[:,-1]))
    check(name+' exact Y repeat seam',np.array_equal(core[0],core[-1]))
    expected=np.pad(core,((16,16),(16,16),(0,0)),mode='wrap')
    check(name+' 16px periodic gutters',np.array_equal(expected,atlas[y-16:y+h+16,x-16:x+w+16]))

decals=np.array(Image.open(ROOT/'decals.png'))
check('decal atlas RGBA',decals.shape==(1024,1024,4))
rects=json.loads((ROOT/'decal-rects.json').read_text())
check('all 16 requested decals',list(rects)==[str(i) for i in range(10)]+['star','chevrons','flame','shield','bolt','wing'])
for name,r in rects.items():
    x,y,w,h=r['x'],r['y'],r['width'],r['height']; cell=decals[y-32:y+224,x-32:x+224,3]
    outside=cell.copy(); outside[32:224,32:224]=0
    check('decal '+name+' opaque art inside advertised rect',np.max(outside)==0)
    check('decal '+name+' nonempty and genuinely transparent',cell.max()==255 and cell.min()==0)
check('four runtime PNG sources',len(manifest['files'])==4)
total=sum(f['bytes'] for f in manifest['files'].values())
report={'checks':checks,'passed':sum(c['pass'] for c in checks),'total':len(checks),
        'downloadBytes':total,'allPass':all(c['pass'] for c in checks),
        'limitations':['Static PNG checks only. Browser evidence recorded separately.',
                        'No physical iPhone GPU timing, game integration or ship geometry budget claim.']}
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='checks'},indent=2))
for c in checks:
    if not c['pass']: print('FAIL',c)
raise SystemExit(0 if report['allPass'] else 1)
