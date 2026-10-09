"""Original CC0 low-poly island props and water normal map. Blender 5.2."""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mat=bpy.data.materials.new('island_palette');mat.use_nodes=True
p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.92
vc=mat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='paint';mat.node_tree.links.new(vc.outputs['Color'],p.inputs['Base Color'])
mat.use_backface_culling=False
TRUNK=(.32,.20,.10,1);LEAF=(.13,.31,.035,1);LEAF_LIGHT=(.25,.43,.055,1);ROCK=(.36,.33,.27,1)

def mesh(name,verts,faces,color,seed=0):
    data=bpy.data.meshes.new(name+'_geometry');data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);data.materials.append(mat)
    c=data.color_attributes.new(name='paint',type='FLOAT_COLOR',domain='CORNER');rng=random.Random(seed)
    for face in data.polygons:
        shade=rng.uniform(.83,1.10)
        for i in face.loop_indices:c.data[i].color=tuple(v*shade for v in color[:3])+(1,)
    return o

def ico(name,loc,scale,color,seed,subdiv=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv,radius=1,location=loc);o=bpy.context.object;o.scale=scale
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    verts=[tuple(v.co) for v in o.data.vertices];faces=[tuple(p.vertices) for p in o.data.polygons]
    bpy.data.objects.remove(o,do_unlink=True);return mesh(name,verts,faces,color,seed)

def join(parts,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=bpy.context.object;o.name=name;o.data.name=name+'_geometry'
    tri=o.modifiers.new('triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    o['license']='CC0-1.0';o.select_set(False);return o

objects=[]
for variant in range(1,4):
    height=[8.6,10.4,6.9][variant-1];lean=[1.5,-1.8,.65][variant-1];phase=variant*.72
    for lod in (0,1):
        parts=[];sides=7 if lod==0 else 5;rings=10 if lod==0 else 5;verts=[];faces=[]
        for j in range(rings+1):
            t=j/rings;cx=lean*t*t;cy=.35*math.sin(t*1.7)*variant/3;radius=.29*(1-.56*t)
            for k in range(sides):
                a=math.tau*k/sides;verts.append((cx+radius*math.cos(a),cy+radius*math.sin(a),height*t))
        for j in range(rings):
            for k in range(sides):a=j*sides+k;b=j*sides+(k+1)%sides;faces.append((a,b,b+sides,a+sides))
        faces.extend([tuple(reversed(range(sides))),tuple(range(rings*sides,(rings+1)*sides))])
        trunk=mesh('trunk',verts,faces,TRUNK,variant)
        # Alternating trunk rings remain colour detail in the same primitive.
        for f in trunk.data.polygons:
            tint=.83 if f.index//sides%2 else 1.08
            for i in f.loop_indices:
                col=trunk.data.color_attributes['paint'].data[i].color
                trunk.data.color_attributes['paint'].data[i].color=tuple(c*tint for c in col[:3])+(1,)
        parts.append(trunk);crown=Vector((lean,.35*math.sin(1.7)*variant/3,height))
        leaves=8 if lod==0 else 7
        for leaf in range(leaves):
            a=math.tau*leaf/leaves+phase;direction=Vector((math.cos(a),math.sin(a),0));side=Vector((-math.sin(a),math.cos(a),0));length=3.2+.7*math.sin(leaf*2.3+variant)
            steps=6 if lod==0 else 3;v=[];f=[]
            for j in range(steps+1):
                t=j/steps;center=crown+direction*(length*t)+Vector((0,0,.65*math.sin(t*math.pi)-1.20*t*t))
                width=.45*math.sin(math.pi*t)**.7 if 0<t<1 else .02
                v.extend([tuple(center-side*width),tuple(center+Vector((0,0,.09*math.sin(math.pi*t)))),tuple(center+side*width)])
            for j in range(steps):
                i=j*3;f.extend([(i,i+3,i+4,i+1),(i+1,i+4,i+5,i+2)])
            parts.append(mesh('frond',v,f,LEAF_LIGHT if leaf%3==0 else LEAF,leaf+variant*20))
            if lod==0:
                # Separated tapered leaflets make the palm silhouette recognisable.
                v=[];f=[]
                for j in range(1,6):
                    t=j/7;center=crown+direction*(length*t)+Vector((0,0,.65*math.sin(t*math.pi)-1.20*t*t))
                    for sign in (-1,1):
                        start=center+side*sign*.12;tip=center+side*sign*(.75*(1-t)+.16)-direction*.20+Vector((0,0,-.22))
                        i=len(v);v.extend([tuple(start),tuple(start+direction*.23),tuple(tip)]);f.append((i,i+1,i+2))
                parts.append(mesh('leaflets',v,f,LEAF,leaf+variant))
        if lod==0:
            for i in range(3):
                a=i*math.tau/3;parts.append(ico('coconut',crown+Vector((.22*math.cos(a),.22*math.sin(a),-.30)),(.19,.17,.23),(.25,.22,.09,1),i))
        objects.append(join(parts,f'palm_{variant}'+('_lod' if lod else '')))

for variant in range(1,3):
    rng=random.Random(500+variant);parts=[]
    for i in range(5):
        a=i*2.399;parts.append(ico('bush_lobe',(.65*math.cos(a),.65*math.sin(a),.55+rng.random()*.35),(.65,.58,.62),LEAF_LIGHT if i%2 else LEAF,i+variant))
    o=join(parts,f'bush_{variant}');low=min(v.co.z for v in o.data.vertices)
    for v in o.data.vertices:v.co.z-=low
    objects.append(o)
for variant in range(1,4):
    o=ico('beach_rock_'+str(variant),(0,0,.65),(1.4,.9,.95),ROCK,variant,2)
    for v in o.data.vertices:
        v.co.x*=1+.09*math.sin(v.co.y*8+variant);v.co.z=max(0,v.co.z)
    objects.append(join([o],f'beach_rock_{variant}'))
for variant in range(1,3):
    rng=random.Random(700+variant);verts=[];faces=[];sides=7
    for ring,z in enumerate([0,1.5,4.1,5.1]):
        radius=[2.8,2.55,2.25,1.8][ring]
        for k in range(sides):
            a=k*math.tau/sides;r=radius*rng.uniform(.87,1.13);verts.append((r*math.cos(a)+ring*.18,r*math.sin(a),z+rng.uniform(-.16,.16) if ring else 0))
    for ring in range(3):
        for k in range(sides):a=ring*sides+k;b=ring*sides+(k+1)%sides;faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(reversed(range(sides))),tuple(range(21,28))])
    objects.append(join([mesh('cliff',verts,faces,ROCK,variant)],f'cliff_{variant}'))

bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'island_props.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True)
# Seamless original tangent-space water normals, linear colour data.
im=bpy.data.images.new('water_normals',width=512,height=512,alpha=False);im.colorspace_settings.name='Non-Color';pixels=[]
for y in range(512):
    for x in range(512):
        u=x/512*math.tau;v=y/512*math.tau
        dx=.12*math.cos(7*u+3*v)+.06*math.cos(17*u-9*v)+.04*math.sin(29*u+11*v)
        dy=.09*math.cos(7*u+3*v)-.08*math.cos(17*u-9*v)+.05*math.cos(13*u+23*v)
        n=Vector((-dx,-dy,1)).normalized();pixels.extend((n.x*.5+.5,n.y*.5+.5,n.z*.5+.5,1))
im.pixels.foreach_set(pixels);im.update();im.filepath_raw=str(OUT/'water_normals.png');im.file_format='PNG';im.save()
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'island_source.blend'))
(OUT/'prop-manifest.json').write_text(json.dumps({o.name:{'triangles':len(o.data.polygons),'height':max(v.co.z for v in o.data.vertices),'materials':len(o.data.materials)} for o in objects},indent=2)+'\n')
print('ISLAND_PROPS_EXPORTED',[(o.name,len(o.data.polygons)) for o in objects])
