"""Validate budgets, rig, sockets, influences, clips, loop seams and self-contained files."""
import json,struct,math,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent
PERSON={'hips':None,'spine':'hips','chest':'spine','neck':'chest','head':'neck'}
for side in ('l','r'):
 PERSON.update({f'shoulder_{side}':'chest',f'upper_arm_{side}':f'shoulder_{side}',f'fore_arm_{side}':f'upper_arm_{side}',f'hand_{side}':f'fore_arm_{side}',f'thigh_{side}':'hips',f'shin_{side}':f'thigh_{side}',f'foot_{side}':f'shin_{side}'})
CLIPS={'idle':2,'walk':1.2,'run':.8,'jump':.9,'fall':1,'land':.3,'dig':1.2,'celebrate':2}

def read(name):
 b=(ROOT/name).read_bytes();magic,version,length=struct.unpack_from('<4sII',b);assert magic==b'glTF' and version==2 and length==len(b)
 n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n]);size,kind=struct.unpack_from('<I4s',b,20+n);assert kind==b'BIN\0';binary=b[28+n:28+n+size]
 assert all(not buf.get('uri') for buf in d['buffers'])
 assert all(not img.get('uri') for img in d.get('images',[]))
 assert not any(e in d.get('extensionsUsed',[]) for e in ('KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'))
 assert all(all(c.islower() or c.isdigit() or c=='_' for c in node['name']) for node in d['nodes'])
 return d,binary,b

def accessor(d,b,index):
 a=d['accessors'][index];v=d['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
 fmt={5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']];size=struct.calcsize('<'+fmt*n);stride=v.get('byteStride',size);off=v.get('byteOffset',0)+a.get('byteOffset',0)
 assert off+(a['count']-1)*stride+size<=len(b)
 return [struct.unpack_from('<'+fmt*n,b,off+i*stride) for i in range(a['count'])]

report={}
for kind in ('ship','explorer'):
 d,b,raw=read(kind+'.glb');names={n['name']:i for i,n in enumerate(d['nodes'])};primitives=[p for m in d['meshes'] for p in m['primitives']]
 triangles=sum(d['accessors'][p['indices']]['count']//3 for p in primitives)
 assert triangles<=5000 and len(primitives)<=3 and len(d['meshes'])==1
 assert len(d['materials'])==3
 wanted=('nose','wing_l','wing_r','back','belly','seat','engine_l','engine_r') if kind=='ship' else ('head','hand_l','hand_r','back','feet')
 assert all('socket_'+s in names for s in wanted)
 for p in primitives:
  assert all(math.isfinite(c) for xyz in accessor(d,b,p['attributes']['POSITION']) for c in xyz)
  if d['materials'][p['material']]['name']=='paper_suit':assert 'COLOR_0' in p['attributes']
 item={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':triangles,'draw_calls':len(primitives),'materials':len(d['materials']),'textures':len(d.get('images',[])),'sockets':list(wanted)}
 if kind=='explorer':
  assert len(d['skins'])==1;skin=d['skins'][0];assert {d['nodes'][i]['name'] for i in skin['joints']}==set(PERSON)
  parents={child:i for i,node in enumerate(d['nodes']) for child in node.get('children',[])}
  for bone,parent in PERSON.items():
   if parent:assert parents[names[bone]]==names[parent],bone
  max_influences=0
  for p in primitives:
   attrs=p['attributes'];assert 'JOINTS_0' in attrs and 'WEIGHTS_0' in attrs and 'JOINTS_1' not in attrs
   for weights in accessor(d,b,attrs['WEIGHTS_0']):
    assert abs(sum(weights)-1)<1e-4;max_influences=max(max_influences,sum(w>1e-6 for w in weights))
  assert max_influences<=4
  assert {a['name'] for a in d['animations']}==set(CLIPS)
  animations={}
  for a in d['animations']:
   duration=0
   for c in a['channels']:
    node=d['nodes'][c['target']['node']]['name'];path=c['target']['path'];assert node in PERSON
    assert path=='rotation' or (path=='translation' and node=='hips'),(node,path)
    s=a['samplers'][c['sampler']];assert s.get('interpolation','LINEAR')=='LINEAR'
    times=[t[0] for t in accessor(d,b,s['input'])];values=accessor(d,b,s['output'])
    assert all(math.isfinite(v) for row in values for v in row)
    assert all(abs(t*30-round(t*30))<1e-4 for t in times)
    duration=max(duration,max(times))
    if a['name'] not in ('jump','land'):
     if path=='rotation':assert abs(abs(sum(x*y for x,y in zip(values[0],values[-1])))-1)<1e-4
     else:assert max(abs(x-y) for x,y in zip(values[0],values[-1]))<1e-5
   assert abs(duration-CLIPS[a['name']])<1e-4
   animations[a['name']]={'duration':round(duration,3),'channels':len(a['channels']),'loop':a['name'] not in ('jump','land')}
  visor=next(m for m in d['materials'] if m['name']=='visor');assert visor['pbrMetallicRoughness'].get('baseColorFactor',[1,1,1,1])==[1,1,1,1]
  assert 'baseColorTexture' in visor['pbrMetallicRoughness']
  item.update({'bones':19,'max_influences':max_influences,'animations':animations})
 item['checks']={'budgets':True,'names':True,'sockets':True,'embedded_resources':True,'vertex_paint':True}
 report[kind]=item
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
