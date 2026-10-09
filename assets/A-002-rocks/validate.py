"""Structural contract checks for the embedded GLB and batched triangle budget."""
import hashlib,json,struct,math,zlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent
b=(ROOT/'rocks.glb').read_bytes();magic,version,length=struct.unpack_from('<4sII',b)
assert magic==b'glTF' and version==2 and length==len(b)
n,kind=struct.unpack_from('<I4s',b,12);assert kind==b'JSON'
d=json.loads(b[20:20+n]);size,kind=struct.unpack_from('<I4s',b,20+n);assert kind==b'BIN\0';binary=b[28+n:28+n+size]
assert not any(buf.get('uri') for buf in d['buffers'])
assert len(d['materials'])==6 and len(d['images'])==2
assert not any(e in d.get('extensionsUsed',[]) for e in ('KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'))
types=('stone','iron','volatile','crystal','magnet','splitter')
assert {node['name'] for node in d['nodes']}=={f'{t}_{v}' for t in types for v in (1,2,3)}
report={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'materials':6,'textures':[],'types':{}}
def png_pixels(png,w,h):
 assert png[24]==8 and png[25] in (2,6) and png[28]==0
 channels=4 if png[25]==6 else 3;data=bytearray();offset=8
 while offset<len(png):
  size=struct.unpack_from('>I',png,offset)[0]
  if png[offset+4:offset+8]==b'IDAT':data.extend(png[offset+8:offset+8+size])
  offset+=12+size
 raw=zlib.decompress(data);stride=w*channels;previous=bytearray(stride);rows=[]
 for y in range(h):
  at=y*(stride+1);kind=raw[at];row=bytearray(raw[at+1:at+1+stride]);assert kind<=4
  for x in range(stride):
   left=row[x-channels] if x>=channels else 0;up=previous[x];corner=previous[x-channels] if x>=channels else 0
   if kind==1:predictor=left
   elif kind==2:predictor=up
   elif kind==3:predictor=(left+up)//2
   elif kind==4:
    p=left+up-corner;dist=[abs(p-left),abs(p-up),abs(p-corner)];predictor=(left,up,corner)[dist.index(min(dist))]
   else:predictor=0
   row[x]=(row[x]+predictor)&255
  rows.extend(tuple(row[x:x+3]) for x in range(0,stride,channels));previous=row
 return rows
for image in d['images']:
 view=d['bufferViews'][image['bufferView']];off=view.get('byteOffset',0);png=binary[off:off+view['byteLength']]
 assert png[:8]==b'\x89PNG\r\n\x1a\n';w,h=struct.unpack_from('>II',png,16);assert (w,h)==(512,512)
 pixels=png_pixels(png,w,h);lit=sum(max(p)>32 for p in pixels);assert lit>1000,'Texture exported black'
 assert len(set(pixels))>2,'Missing atlas detail'
 report['textures'].append({'name':image['name'],'width':w,'height':h,'embedded':True,'nonblack_pixels':lit})
for t in types:
 variants=[];materials=set()
 for v in (1,2,3):
  node=next(n for n in d['nodes'] if n['name']==f'{t}_{v}');primitives=d['meshes'][node['mesh']]['primitives'];assert len(primitives)==1
  p=primitives[0];triangles=d['accessors'][p['indices']]['count']//3;assert triangles<=300;materials.add(p['material'])
  uv=d['accessors'][p['attributes']['TEXCOORD_0']];uv_view=d['bufferViews'][uv['bufferView']];uv_off=uv_view.get('byteOffset',0)+uv.get('byteOffset',0);uv_stride=uv_view.get('byteStride',8)
  tiles=set()
  for i in range(uv['count']):
   u,vv=struct.unpack_from('<ff',binary,uv_off+i*uv_stride);tiles.add(math.floor(u*4)+4*math.floor((1-vv)*4))
  expected={'stone':{0,1,2},'iron':{3,4,5},'volatile':{6,7,8},'crystal':{9,10,11},'magnet':{12,13,14},'splitter':{0,1,2}}[t]
  assert tiles<=expected,f'{node["name"]}: wrong palette UVs {tiles}'
  a=d['accessors'][p['attributes']['POSITION']];view=d['bufferViews'][a['bufferView']];off=view.get('byteOffset',0)+a.get('byteOffset',0);stride=view.get('byteStride',12)
  coords=[struct.unpack_from('<fff',binary,off+i*stride) for i in range(a['count'])];assert all(math.isfinite(c) for xyz in coords for c in xyz)
  radius=max(math.sqrt(sum(c*c for c in xyz)) for xyz in coords);assert abs(radius-1)<1e-5
  variants.append({'name':node['name'],'triangles':triangles,'max_radius':round(radius,6)})
 assert len(materials)==1
 submitted=sum(v['triangles'] for v in variants);assert submitted<=300
 report['types'][t]={'variants':variants,'batched_triangles_per_instance':submitted,'material':list(materials)[0]}
report['checks']={'18_named_nodes':True,'one_primitive_each':True,'six_shared_materials':True,'two_embedded_512_textures':True,'texture_pixels_present':True,'type_palette_uvs':True,'unit_radius':True,'batched_budget':True,'no_decoders':True}
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
