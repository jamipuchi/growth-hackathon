"""Independent binary contract audit of the five A-008 creature exports."""
import json,struct,hashlib,math,re
from pathlib import Path
OUT=Path(__file__).resolve().parent
CONTRACT={
'quadruped':({'hips':None,'spine_1':'hips','spine_2':'spine_1','neck':'spine_2','head':'neck','tail_1':'hips','tail_2':'tail_1',**{f'{leg}_{part}':(f'{leg}_{prev}' if prev else ('spine_2' if leg.startswith('front') else 'hips')) for leg in ['front_l','front_r','back_l','back_r'] for part,prev in [('upper',None),('lower','upper'),('foot','lower')]}},'mouth seat tail','idle walk gallop jump sit bite dig roar hit die'),
'flyer':({'body':None,'neck':'body','head':'neck','wing_l_1':'body','wing_l_2':'wing_l_1','wing_r_1':'body','wing_r_2':'wing_r_1','tail':'body'},'seat nose claws','flap glide dive land hit die'),
'swimmer':({f'spine_{i}':f'spine_{i-1}' if i>1 else None for i in range(1,7)},'mouth seat','swim dart hit die'),
'crawler':({'body':None,**{f'leg_{i}_{part}':f'leg_{i}_upper' if part=='lower' else 'body' for i in range(1,9) for part in ['upper','lower']}},'mouth back front','idle hit die'),
'serpent':({f'spine_{i}':f'spine_{i-1}' if i>1 else None for i in range(1,9)},'mouth tail','slither strike coil hit die'),
}
def audit(kind):
 hierarchy,sockets,expectedclips=CONTRACT[kind];meta=json.loads((OUT/f'{kind}-clips.json').read_text());raw=(OUT/f'{kind}.glb').read_bytes()
 magic,version,size=struct.unpack_from('<4sII',raw);assert(magic,version,size)==(b'glTF',2,len(raw));n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);binary=raw[28+n:]
 def get(index):
  a=d['accessors'][index];v=d['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];fmt='<'+{5120:'b',5121:'B',5122:'h',5123:'H',5125:'I',5126:'f'}[a['componentType']]*width;stride=v.get('byteStride',struct.calcsize(fmt));offset=v.get('byteOffset',0)+a.get('byteOffset',0)
  values=[struct.unpack_from(fmt,binary,offset+i*stride) for i in range(a['count'])]
  if a.get('normalized'):
   divisor={5120:127,5121:255,5122:32767,5123:65535}[a['componentType']];values=[tuple(max(-1,x/divisor) for x in row) for row in values]
  return values
 assert all('uri' not in b for b in d['buffers']) and not d.get('images') and not d.get('extensionsRequired')
 assert all(re.fullmatch('[a-z][a-z0-9_]*',o['name']) for o in d['nodes'])
 assert len(d['meshes'])==1 and len(d['meshes'][0]['primitives'])==1 and len(d['materials'])==1
 p=d['meshes'][0]['primitives'][0];tris=d['accessors'][p['indices']]['count']//3;assert tris<=5000
 assert len(d['skins'])==1;names={o['name']:i for i,o in enumerate(d['nodes'])};assert len(names)==len(d['nodes'])
 joints=d['skins'][0]['joints'];assert set(d['nodes'][i]['name'] for i in joints)==set(hierarchy)
 parents={child:i for i,o in enumerate(d['nodes']) for child in o.get('children',[])}
 for bone,parent in hierarchy.items():
  if parent:assert parents[names[bone]]==names[parent],(kind,bone,parent)
 assert all('socket_'+s in names for s in sockets.split())
 assert 'JOINTS_1' not in p['attributes'];weights=get(p['attributes']['WEIGHTS_0']);maxweights=max(sum(w>0 for w in row) for row in weights)
 assert maxweights<=4 and all(abs(sum(row)-1)<1e-4 for row in weights)
 assert all(math.isfinite(v) for row in get(p['attributes']['POSITION']) for v in row)
 assert {a['name'] for a in d['animations']}==set(expectedclips.split())==set(meta['clips'])
 clips={}
 for a in d['animations']:
  info=meta['clips'][a['name']];targets=[];samples=0
  for c in a['channels']:
   assert c['target']['path']=='rotation';targets.append(d['nodes'][c['target']['node']]['name']);s=a['samplers'][c['sampler']];times=[v[0] for v in get(s['input'])];q=get(s['output'])
   assert s.get('interpolation','LINEAR')=='LINEAR' and abs(times[0])<1e-6 and abs(times[-1]-info['duration'])<1e-5
   assert all(abs(t*30-round(t*30))<1e-3 for t in times)
   assert all(abs(sum(v*v for v in row)-1)<3e-5 for row in q)
   if info['loop']:assert abs(abs(sum(x*y for x,y in zip(q[0],q[-1])))-1)<3e-5,(kind,a['name'])
   samples=max(samples,len(times))
  assert set(targets)==set(hierarchy)
  clips[a['name']]={**info,'samples':samples,'channels':len(targets)}
 return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':tris,'drawCalls':1,'textures':0,'bones':len(joints),'maxInfluences':maxweights,'clips':clips,'checks':{'embedded':True,'legalNames':True,'oneMeshMaterial':True,'exactHierarchy':True,'sockets':True,'budget':True,'weights':True,'finite':True,'exactClips':True,'rotationOnly':True,'thirtyFPS':True,'loopEndpoints':True}}
if __name__=='__main__':
 result={k:audit(k) for k in CONTRACT};(OUT/'creatures-validation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:{key:v for key,v in data.items() if key!='clips'} for k,data in result.items()},indent=2))
