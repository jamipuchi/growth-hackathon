"""Inspect the actual exported GLBs and PNG, not authoring-scene estimates."""
import hashlib, io, json, math, re, struct
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parent

def accessor(d,b,index):
    a=d['accessors'][index];v=d['bufferViews'][a['bufferView']]
    n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    fmt={5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']]
    size=struct.calcsize('<'+fmt*n);stride=v.get('byteStride',size)
    offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    assert offset+(a['count']-1)*stride+size<=len(b)
    return [struct.unpack_from('<'+fmt*n,b,offset+i*stride) for i in range(a['count'])]

report={}
for name in ('chest','buried'):
    raw=(ROOT/(name+'.glb')).read_bytes()
    magic,version,size=struct.unpack_from('<4sII',raw)
    assert magic==b'glTF' and version==2 and size==len(raw)
    n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);b=raw[28+n:]
    assert all('uri' not in r for r in d['buffers']+d['images'])
    assert set(d.get('extensionsUsed',[]))<={'KHR_materials_emissive_strength'}
    names=[node['name'] for node in d['nodes']]
    assert len(names)==len(set(names)) and all(re.fullmatch('[a-z][a-z0-9_]*',n) for n in names)
    primitives=[p for m in d['meshes'] for p in m['primitives']]
    triangles=sum(d['accessors'][p['indices']]['count']//3 for p in primitives)
    assert triangles<=3000 and len(primitives)==(2 if name=='chest' else 1)
    assert len(d['materials'])==1
    for p in primitives:
        a=p['attributes'];assert 'COLOR_0' in a and 'TEXCOORD_0' in a
        points=accessor(d,b,a['POSITION']);assert all(math.isfinite(v) for row in points for v in row)
        assert all(0<=i[0]<len(points) for i in accessor(d,b,p['indices']))
        for u,v in accessor(d,b,a['TEXCOORD_0']):assert min(abs(u-x) for x in (.125,.375,.625,.875))<1e-5 and abs(v-.5)<1e-5
    images={}
    for im in d['images']:
        view=d['bufferViews'][im['bufferView']];off=view.get('byteOffset',0)
        png=Image.open(io.BytesIO(b[off:off+view['byteLength']])).convert('RGBA')
        assert png.size==(128,128)
        images[im['name']]={'size':list(png.size),'palette':[list(png.getpixel((x,64))) for x in (16,48,80,112)]}
        if im['name']=='chest_emission':
            colors=images[im['name']]['palette'];assert all(max(colors[i][:3])==0 for i in (0,1,3)) and colors[2][0]>200 and colors[2][1]>50
        else:
            colors=images[im['name']]['palette'];assert colors[0][2]==0 and colors[3][2]==0 and colors[1][2]>100 and colors[2][2]>100
    item={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':triangles,'draw_calls':len(primitives),'materials':1,'embedded_images':images,'nodes':names}
    if name=='chest':
        assert {'chest_body','chest_lid','socket_treasure','socket_lid'}<=set(names)
        assert len(d['animations'])==1;a=d['animations'][0]
        assert a['name']=='open' and len(a['channels'])==1
        ch=a['channels'][0];assert ch['target']['path']=='rotation' and names[ch['target']['node']]=='chest_lid'
        s=a['samplers'][ch['sampler']];times=[t[0] for t in accessor(d,b,s['input'])];q=accessor(d,b,s['output'])
        assert len(times)==31 and abs(times[0])<1e-6 and abs(times[-1]-1)<1e-6
        assert all(abs(t-i/30)<1e-6 for i,t in enumerate(times))
        assert all(abs(sum(v*v for v in row)-1)<1e-5 for row in q)
        angle=math.degrees(2*math.atan2(q[-1][0],q[-1][3]));assert abs(angle-100)<1e-3
        assert abs(q[0][3]-1)<1e-6
        item['animation']={'name':'open','seconds':1,'samples':31,'fps':30,'channel':'chest_lid.rotation','final_degrees':angle}
    else:assert 'socket_glint' in names and not d.get('animations')
    item['checks']={'budget':True,'legal_names':True,'embedded_pbr_maps':True,'emission_only_gold':True,'finite_geometry':True,'palette_uvs':True}
    report[name]=item
png=Image.open(ROOT/'dig_hole.png').convert('RGBA');assert png.size==(512,512)
assert png.getpixel((0,0))[3]==0 and png.getpixel((256,256))[3]>200
assert png.getchannel('A').getextrema()[0]==0 and len(set(png.getchannel('A').tobytes()))>100
raw=(ROOT/'dig_hole.png').read_bytes()
report['decal']={'size':[512,512],'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'alpha_range':list(png.getchannel('A').getextrema()),'checks':{'transparent_edges':True,'opaque_center':True,'soft_alpha':True}}
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
