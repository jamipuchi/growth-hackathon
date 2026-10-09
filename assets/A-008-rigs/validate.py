"""Verify exact person contract in the exported binary. No Blender dependency."""
import json,struct,hashlib,math,re
from pathlib import Path
OUT=Path(__file__).resolve().parent
manifest=json.loads((OUT/'person-clips.json').read_text())
raw=(OUT/'person.glb').read_bytes();magic,version,size=struct.unpack_from('<4sII',raw)
assert magic==b'glTF' and version==2 and size==len(raw)
n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);b=raw[28+n:]
def get(index):
    a=d['accessors'][index];v=d['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    fmt={5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']]*width;stride=v.get('byteStride',struct.calcsize('<'+fmt));offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    return [struct.unpack_from('<'+fmt,b,offset+i*stride) for i in range(a['count'])]
assert all('uri' not in r for r in d['buffers']);assert not d.get('images') and not d.get('extensionsRequired')
assert all(re.fullmatch('[a-z][a-z0-9_]*',o['name']) for o in d['nodes'])
assert len(d['meshes'])==1 and len(d['meshes'][0]['primitives'])==1 and len(d['materials'])==1
p=d['meshes'][0]['primitives'][0];tris=d['accessors'][p['indices']]['count']//3;assert tris<=5000
assert len(d['skins'])==1
names={o['name']:i for i,o in enumerate(d['nodes'])};joints=d['skins'][0]['joints'];assert set(d['nodes'][i]['name'] for i in joints)==set(manifest['bones'])
parents={child:i for i,o in enumerate(d['nodes']) for child in o.get('children',[])}
hierarchy={'hips':None,'spine':'hips','chest':'spine','neck':'chest','head':'neck'}
for s in ('l','r'):
    hierarchy.update({f'shoulder_{s}':'chest',f'upper_arm_{s}':f'shoulder_{s}',f'fore_arm_{s}':f'upper_arm_{s}',f'hand_{s}':f'fore_arm_{s}',f'thigh_{s}':'hips',f'shin_{s}':f'thigh_{s}',f'foot_{s}':f'shin_{s}'})
for bone,parent in hierarchy.items():
    if parent:assert parents[names[bone]]==names[parent]
assert all('socket_'+s in names for s in ('head','hand_l','hand_r','back','feet'))
assert 'JOINTS_1' not in p['attributes'];weights=get(p['attributes']['WEIGHTS_0']);max_weights=max(sum(w>0 for w in row) for row in weights)
assert max_weights<=4 and all(abs(sum(row)-1)<1e-5 for row in weights)
assert all(math.isfinite(v) for row in get(p['attributes']['POSITION']) for v in row)
assert {a['name'] for a in d['animations']}==set(manifest['clips'])
clips={}
for a in d['animations']:
    meta=manifest['clips'][a['name']];targets=[];samples=0
    for c in a['channels']:
        assert c['target']['path']=='rotation';node=d['nodes'][c['target']['node']]['name'];targets.append(node)
        s=a['samplers'][c['sampler']];times=[v[0] for v in get(s['input'])];q=get(s['output'])
        assert s['interpolation']=='LINEAR' and abs(times[0])<1e-6 and abs(times[-1]-meta['duration'])<1e-5
        assert all(abs(t*30-round(t*30))<1e-4 for t in times)
        assert all(abs(sum(v*v for v in row)-1)<2e-5 for row in q)
        if meta['loop']:assert abs(abs(sum(x*y for x,y in zip(q[0],q[-1])))-1)<2e-5
        samples=max(samples,len(times))
    assert set(targets)==set(manifest['bones'])
    clips[a['name']]={**meta,'samples':samples,'channels':len(targets)}
report={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':tris,'draw_calls':1,'textures':0,'bones':len(joints),'max_influences':max_weights,'clips':clips,'checks':{'bone_hierarchy':True,'sockets':True,'rotation_only':True,'all_33_clips':True,'thirty_fps':True,'loop_endpoints':True,'budget':True,'self_contained':True,'finite_normalized_weights':True}}
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
