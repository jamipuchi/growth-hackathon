"""Decode the actual car.glb and independently audit its structural contract."""
from pathlib import Path
import json, struct, hashlib, re, math, datetime
import numpy as np

ROOT=Path(__file__).resolve().parent
raw=(ROOT/'car.glb').read_bytes(); checks=[]
def check(name,condition,detail=None):
    checks.append({'name':name,'pass':bool(condition),**({'detail':detail} if detail is not None else {})})
    if not condition: raise AssertionError(name+': '+str(detail))

magic,version,length=struct.unpack_from('<III',raw)
check('glb_header',magic==0x46546c67 and version==2 and length==len(raw))
offset=12; chunks={}
while offset<len(raw):
    n,kind=struct.unpack_from('<II',raw,offset); chunks[kind]=raw[offset+8:offset+8+n]; offset+=8+n
g=json.loads(chunks[0x4e4f534a]); binary=chunks[0x004e4942]
manifest=json.loads((ROOT/'car-manifest.json').read_text())
types={5120:('i1',1),5121:('u1',1),5122:('<i2',2),5123:('<u2',2),5125:('<u4',4),5126:('<f4',4)}
components={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def attribute(i):
    a=g['accessors'][i]; v=g['bufferViews'][a['bufferView']]; dtype,size=types[a['componentType']]; width=components[a['type']]
    start=v.get('byteOffset',0)+a.get('byteOffset',0); stride=v.get('byteStride',width*size)
    data=np.ndarray((a['count'],width),dtype=dtype,buffer=binary,offset=start,strides=(stride,size)).astype(float)
    if a.get('normalized') and a['componentType']!=5126:
        info=np.iinfo(np.dtype(dtype)); data=np.maximum(-1,data/info.max) if info.min<0 else data/info.max
    return data
def local(node):
    if 'matrix' in node: return np.array(node['matrix']).reshape(4,4).T
    x,y,z,w=node.get('rotation',[0,0,0,1]); m=np.eye(4)
    m[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
               [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
               [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    m[:3,:3]=m[:3,:3]@np.diag(node.get('scale',[1,1,1])); m[:3,3]=node.get('translation',[0,0,0]); return m
world={}
def visit(i,parent):
    world[i]=parent@local(g['nodes'][i])
    for child in g['nodes'][i].get('children',[]): visit(child,world[i])
for i in g['scenes'][g.get('scene',0)]['nodes']: visit(i,np.eye(4))
names={node['name']:i for i,node in enumerate(g['nodes'])}
check('lowercase_node_names',all(re.fullmatch('[a-z][a-z0-9_]*',name) for name in names))
required=['default_car','car_body','car_lights','car_wheels','wheel_fl','wheel_fr','wheel_bl','wheel_br','socket_seat','socket_roof','socket_front','socket_back']
check('required_nodes',all(name in names for name in required))
check('three_meshes_three_primitives',len(g['meshes'])==3 and sum(len(m['primitives']) for m in g['meshes'])==3)
check('three_materials_zero_textures',len(g['materials'])==3 and not g.get('textures') and not g.get('images'))
check('embedded_no_decoders',all('uri' not in b for b in g['buffers']) and not any(x in str(g.get('extensionsUsed',[])) for x in ('draco','meshopt','basisu')))
check('opaque_frontside_materials',all(not m.get('doubleSided',False) and m.get('alphaMode','OPAQUE')=='OPAQUE' for m in g['materials']))
check('no_skin_animation_or_cameras',not g.get('skins') and not g.get('animations') and not g.get('cameras'))
cost={}; meshes={}; bounds=[]
for name in ('car_body','car_lights','car_wheels'):
    node=g['nodes'][names[name]]; primitive=g['meshes'][node['mesh']]['primitives'][0]; attrs=primitive['attributes']
    pos=attribute(attrs['POSITION']); normals=attribute(attrs['NORMAL']); colors=attribute(attrs['COLOR_0'])
    indices=attribute(primitive['indices']).astype(int).flatten() if 'indices' in primitive else np.arange(len(pos))
    check(name+'_finite_attributes',np.isfinite(pos).all() and np.isfinite(normals).all() and np.isfinite(colors).all())
    check(name+'_triangles_and_indices',len(indices)%3==0 and indices.min()>=0 and indices.max()<len(pos))
    check(name+'_unit_normals',np.max(np.abs(np.linalg.norm(normals,axis=1)-1))<1e-5)
    tris=pos[indices].reshape(-1,3,3); cross=np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0]); lengths=np.linalg.norm(cross,axis=1)
    check(name+'_nondegenerate_outward_winding',np.min(lengths)>1e-8 and np.min(np.sum(cross*normals[indices[::3]],axis=1))>0)
    check(name+'_opaque_vertex_paint',colors.shape[1]<4 or np.allclose(colors[:,3],1,atol=1e-7))
    transform=world[names[name]]; global_pos=np.einsum('ij,kj->ki',transform[:3,:3],pos)+transform[:3,3]
    bounds.append(global_pos); cost[name]=len(indices)//3; meshes[name]=(pos,normals,colors,indices,attrs)
all_positions=np.vstack(bounds); lo=all_positions.min(axis=0); hi=all_positions.max(axis=0); size=hi-lo
check('triangle_budget',sum(cost.values())<=5000,cost)
check('four_metre_scale_base_origin',3.9<size[2]<4.1 and abs(lo[1])<1e-6 and abs(lo[0]+hi[0])<1e-6,size.tolist())
check('manifest_actual_bounds',np.allclose(lo,manifest['bounds']['min'],atol=1e-6) and np.allclose(hi,manifest['bounds']['max'],atol=1e-6))
check('manifest_actual_counts',cost==manifest['triangles_by_mesh'] and sum(cost.values())==manifest['triangles'])
for name,position in manifest['wheel_positions'].items():
    node=g['nodes'][names[name]]; matrix=world[names[name]]
    check(name+'_empty_position_x_axis','mesh' not in node and np.allclose(matrix[:3,3],position,atol=1e-6) and np.allclose(matrix[:3,:3],np.eye(3),atol=1e-6))
for name,position in manifest['sockets'].items():
    node=g['nodes'][names['socket_'+name]]; matrix=world[names['socket_'+name]]
    check('socket_'+name+'_position_orientation','mesh' not in node and np.allclose(matrix[:3,3],position,atol=1e-6) and np.allclose(matrix[:3,:3],np.eye(3),atol=1e-6))
pos,normals,colors,indices,attrs=meshes['car_wheels']; uv=attribute(attrs['TEXCOORD_0']); raw_ids=uv[:,0]*4-.5; ids=np.rint(raw_ids).astype(int)
check('wheel_ids_exact_valid',np.allclose(raw_ids,ids,atol=1e-6) and np.min(ids)==0 and np.max(ids)==3)
tri_ids=ids[indices].reshape(-1,3)
check('wheel_triangle_ids_constant',np.all(tri_ids==tri_ids[:,0,None]))
groups=[]
for wheel,name in enumerate(('wheel_fl','wheel_fr','wheel_bl','wheel_br')):
    selected=indices.reshape(-1,3)[tri_ids[:,0]==wheel].flatten()
    local_positions=pos[selected]-world[names[name]][:3,3]
    groups.append((local_positions,normals[selected],colors[selected]))
    check(name+'_same_triangle_cost',len(selected)//3==manifest['triangles_per_wheel'])
for i in range(1,4):
    check('prototype_matches_wheel_'+str(i),all(a.shape==b.shape and np.allclose(a,b,atol=(1e-4 if kind==1 else 1e-5),rtol=0) for kind,(a,b) in enumerate(zip(groups[0],groups[i]))))
check('wheel_center_height_matches_radius',abs(manifest['wheel_radius']-manifest['wheel_positions']['wheel_fl'][1])<1e-7)
check('declared_hash_and_bytes',manifest['sha256']==hashlib.sha256(raw).hexdigest() and manifest['bytes']==len(raw))
result={'pass':all(c['pass'] for c in checks),'checks':checks,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'triangles':sum(cost.values()),'triangles_by_mesh':cost,'triangles_per_wheel':manifest['triangles_per_wheel'],'draw_calls':3,'textures':0,
    'bounds':{'min':lo.tolist(),'max':hi.tolist(),'size':size.tolist()},'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
    'max_wheel_normal_component_delta':float(max(np.max(np.abs(groups[0][1]-group[1])) for group in groups[1:])),
    'limitations':['Static binary/geometry checks only; runtime GLTFLoader, animation, rendering and phone performance belong to separate browser review.','Wheel pivots are empty controls; raw car_wheels geometry is static until car.js replaces it with an instanced batch.']}
(ROOT/'car-validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'pass':result['pass'],'checks':len(checks),'triangles':result['triangles'],'calls':3,'textures':0,'sha256':result['sha256']}))
