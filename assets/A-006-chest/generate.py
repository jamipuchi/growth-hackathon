"""Original CC0 Space Party chest. blender -b --python generate.py
Blender +Y is the front, exported as glTF -Z. All textures are generated here.
"""
import bpy, math, random
from pathlib import Path
from mathutils import Vector, Quaternion

OUT = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps = 30
rng = random.Random(6006)

# Four tiny UV palette cells supply per-part PBR values without material splits.
# Base colour comes from face colours, not a repeating low-resolution bitmap.
orm = bpy.data.images.new('chest_surface', width=128, height=128, alpha=True)
orm.colorspace_settings.name = 'Non-Color'
emit = bpy.data.images.new('chest_emission', width=128, height=128, alpha=True)
emit.colorspace_settings.name = 'sRGB'
op, ep = [], []
for y in range(128):
    for x in range(128):
        kind = x // 32
        rough, metal = [(0.80,0),(0.37,0.68),(0.28,0.70),(0.95,0)][kind]
        op.extend((1,rough,metal,1))
        ep.extend((1,.48,.065,1) if kind == 2 else (0,0,0,1))
for im, pixels in [(orm,op),(emit,ep)]:
    im.pixels.foreach_set(pixels); im.update()
    im.filepath_raw = str(OUT/(im.name+'.png')); im.file_format='PNG'; im.save()
material=bpy.data.materials.new('treasure_palette'); material.use_nodes=True
nodes=material.node_tree.nodes; links=material.node_tree.links
bsdf=nodes.get('Principled BSDF')
col=nodes.new('ShaderNodeVertexColor'); col.layer_name='paint'
links.new(col.outputs['Color'],bsdf.inputs['Base Color'])
tex=nodes.new('ShaderNodeTexImage');tex.image=orm
split=nodes.new('ShaderNodeSeparateColor'); links.new(tex.outputs['Color'],split.inputs[0])
links.new(split.outputs['Green'],bsdf.inputs['Roughness'])
links.new(split.outputs['Blue'],bsdf.inputs['Metallic'])
et=nodes.new('ShaderNodeTexImage'); et.image=emit
links.new(et.outputs['Color'],bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value=2.4

WOOD=(.24,.085,.025,1); WOOD_LIGHT=(.34,.13,.045,1)
BRASS=(.65,.35,.075,1); GOLD=(.95,.58,.12,1); DARK=(.032,.022,.015,1)

def finish(o,name,color=WOOD,kind=0):
    o.name=name; bpy.context.view_layer.objects.active=o
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.data.materials.append(material)
    for layer in list(o.data.uv_layers): o.data.uv_layers.remove(layer)
    uv=o.data.uv_layers.new(name='palette_uv')
    paint=o.data.color_attributes.new(name='paint',type='FLOAT_COLOR',domain='CORNER')
    local=random.Random(sum(map(ord,name)))
    for face in o.data.polygons:
        shade=local.uniform(.88,1.08)
        for i in face.loop_indices:
            uv.data[i].uv=((kind+.5)/4,.5)
            paint.data[i].color=tuple(min(1,c*shade) for c in color[:3])+(1,)
    o.select_set(False); return o

def box(name,loc,half,color=WOOD,kind=0,bevel=.015,rot=None):
    bpy.ops.mesh.primitive_cube_add(size=2,location=loc);o=bpy.context.object;o.scale=half
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        m=o.modifiers.new('worn_edges','BEVEL');m.width=bevel;m.segments=1
        bpy.ops.object.modifier_apply(modifier=m.name)
    if rot:o.rotation_euler=rot
    return finish(o,name,color,kind)

def mesh(name,verts,faces,color=WOOD,kind=0):
    data=bpy.data.meshes.new(name+'_geometry');data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o)
    return finish(o,name,color,kind)

def rivet(name,loc,r=.026):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=r,location=loc)
    return finish(bpy.context.object,name,BRASS,1)

def join(parts,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
    o=bpy.context.object;o.name=name;o.data.name=name+'_geometry'
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    tri=o.modifiers.new('triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
    o.select_set(False);return o

def empty(name,parent=None,loc=(0,0,0)):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o)
    o.parent=parent;o.location=loc;return o

def tree(root):return [root]+[o for child in root.children for o in tree(child)]

def export(root,filename,animation=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in tree(root):o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',use_selection=True,
        export_yup=True,export_apply=False,export_extras=True,export_animations=animation,
        export_animation_mode='ACTIONS',export_force_sampling=False,
        export_bake_animation=False,export_materials='EXPORT')

chest=empty('treasure_chest');chest['license']='CC0-1.0';chest['front']='-Z'
base=[]
base.append(box('floor',(0,0,.10),(.79,.49,.055),DARK))
for row in range(3):
    z=.20+row*.172
    for side in (-1,1):
        base.append(box(f'long_plank_{row}_{side}'.replace('-','n'),(0,side*.468,z),(.79,.054,.08),WOOD_LIGHT if row==1 else WOOD))
        base.append(box(f'end_plank_{row}_{side}'.replace('-','n'),(side*.751,0,z),(.043,.42,.08),WOOD if row==1 else WOOD_LIGHT))
for side in (-1,1):
    base.append(box('rim_long_'+str(side).replace('-','n'),(0,side*.478,.675),(.82,.05,.042),BRASS,1))
    base.append(box('rim_end_'+str(side).replace('-','n'),(side*.776,0,.675),(.044,.437,.042),BRASS,1))
    for x in (-.55,.55):
        base.append(box('body_band',(x,side*.532,.385),(.061,.017,.263),BRASS,1,.01))
        for z in (.18,.59):base.append(rivet('band_rivet',(x,side*.553,z),.021))
    base.append(box('handle_plate',(side*.811,0,.44),(.016,.13,.095),BRASS,1))
    bpy.ops.mesh.primitive_torus_add(major_segments=8,minor_segments=4,major_radius=.115,minor_radius=.022,location=(side*.848,0,.375),rotation=(0,math.pi/2,0))
    base.append(finish(bpy.context.object,'handle_ring',BRASS,1))
    for y in (-.37,.37):base.append(box('foot',(side*.655,y,.043),(.10,.10,.043),BRASS,1,.012))
# Broad lock, dark keyhole and diamond badge face the approach (-Z after export).
base.append(box('lock_plate',(0,.539,.495),(.095,.032,.115),BRASS,1,.027))
base.append(mesh('keyhole',[(.023,.574,.53),(-.023,.574,.53),(-.009,.574,.495),(-.014,.574,.465),(.014,.574,.465),(.009,.574,.495)],[(0,1,2,3,4,5)],DARK))
# A dark solid bed occludes the floor; coin silhouettes and bars provide the reveal.
base.append(box('gold_bed',(0,0,.435),(.65,.36,.05),(.51,.24,.035,1),1,.025))
for i in range(25):
    x=rng.uniform(-.62,.62);y=rng.uniform(-.32,.32)
    z=.515+.055*(1-(x/.75)**2)+rng.uniform(-.015,.025)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=rng.uniform(.069,.095),depth=.032,location=(x,y,z),rotation=(rng.uniform(-.18,.18),rng.uniform(-.18,.18),rng.random()*math.tau))
    base.append(finish(bpy.context.object,'coin_'+str(i),GOLD,2 if i%4==0 else 1))
for i,(x,y) in enumerate([(-.34,-.05),(.15,.12),(.43,-.18)]):
    base.append(box('ingot_'+str(i),(x,y,.582),(.13,.067,.04),GOLD,2 if i==1 else 1,.023,rot=(0,0,(i-1)*.28)))
body=join(base,'chest_body');body.parent=chest

# The lid is one rigid mesh, including its wooden underside, straps and front hasp.
lidparts=[];segments=8;z0=.707
def arch_strip(name,x1,x2,a,b,kind=0,color=WOOD):
    verts=[]
    for x in (x1,x2):
        for radius in (1,.88):
            for theta in (a,b):verts.append((x,.51*radius*math.cos(theta),z0+.285*radius*math.sin(theta)))
    return mesh(name,verts,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],color,kind)
for k in range(segments):
    a=k*math.pi/segments+.006;b=(k+1)*math.pi/segments-.006
    lidparts.append(arch_strip('lid_plank_'+str(k),-.785,.785,a,b,color=WOOD_LIGHT if k%2==0 else WOOD))
    for x in (-.55,.55):
        p=arch_strip('lid_band',x-.063,x+.063,a-.006,b+.006,1,BRASS)
        # Push the full strap outward enough to avoid coplanar faces.
        for v in p.data.vertices:v.co.y*=1.018;v.co.z=z0+(v.co.z-z0)*1.032
        lidparts.append(p)
for side in (-1,1):
    verts=[]
    for x in (side*.739,side*.785):
        verts.extend([(x,.50*math.cos(k*math.pi/8),z0+.277*math.sin(k*math.pi/8)) for k in range(9)])
    faces=[tuple(reversed(range(9))),tuple(range(9,18))]+[(k,k+1,k+10,k+9) for k in range(8)]+[(8,0,9,17)]
    lidparts.append(mesh('lid_end',verts,faces,WOOD_LIGHT))
    for x in (-.55,.55):lidparts.append(rivet('lid_rivet',(x,side*.521,.746),.023))
lidparts.append(box('hasp',(0,.537,.713),(.038,.018,.11),BRASS,1,.01))
for x in (-.53,.53):lidparts.append(box('hinge',(x,-.518,.709),(.10,.035,.029),BRASS,1,.018))
lid=join(lidparts,'chest_lid');lid.parent=chest
hinge=Vector((0,-.51,z0))
for v in lid.data.vertices:v.co-=hinge
lid.location=hinge;lid.rotation_mode='QUATERNION'
empty('socket_treasure',chest,(0,0,.60));empty('socket_lid',lid,(0,1.02,.10))
lid.animation_data_create();action=bpy.data.actions.new('open');action.use_fake_user=True;lid.animation_data.action=action
for frame in range(31):
    t=frame/30
    if t<.8:
        q=t/.8;angle=math.radians(106)*(q*q*(3-2*q))
    else:
        q=(t-.8)/.2;angle=math.radians(106-6*(q*q*(3-2*q)))
    lid.rotation_quaternion=Quaternion((1,0,0),angle)
    lid.keyframe_insert(data_path='rotation_quaternion',frame=frame)
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for fc in bag.fcurves:
                for key in fc.keyframe_points:key.interpolation='LINEAR'
bpy.context.scene.frame_start=0;bpy.context.scene.frame_end=30;bpy.context.scene.frame_set(0)
export(chest,'chest.glb',True)

# A low, irregular mound with just one corner exposed; no whole chest silhouette.
buried=empty('buried_treasure');buried['license']='CC0-1.0'
verts=[(0,0,.36)];faces=[];n=20
for r,z in [(.35,.35),(.70,.21),(1,0)]:
    for k in range(n):
        a=k*math.tau/n;rr=r*(1+rng.uniform(-.07,.07))
        verts.append((1.25*rr*math.cos(a),.94*rr*math.sin(a),max(0,z+rng.uniform(-.028,.028)) if z else 0))
for k in range(n):faces.append((0,1+k,1+(k+1)%n))
for ring in range(2):
    a=1+ring*n;b=a+n
    for k in range(n):q=(k+1)%n;faces.append((a+k,b+k,b+q,a+q))
parts=[mesh('sand_mound',verts,faces,(.70,.55,.34,1),3)]
parts.append(box('wood_corner',(.21,.045,.365),(.155,.12,.07),WOOD_LIGHT,0,.012,rot=(.20,-.22,.18)))
parts.append(box('corner_band',(.295,.045,.405),(.032,.14,.028),BRASS,1,.009,rot=(.20,-.22,.18)))
parts.append(box('corner_rim',(.21,.16,.412),(.166,.025,.027),BRASS,1,.009,rot=(.20,-.22,.18)))
parts.append(rivet('glint_stud',(.30,.10,.468),.034))
# An emissive faceted stud remains visible without a screen-space sprite or light.
parts[-1].data.uv_layers.active.data.foreach_set('uv',[.625,.5]*len(parts[-1].data.loops))
buried_mesh=join(parts,'buried_mesh');buried_mesh.parent=buried
empty('socket_glint',buried,(.30,.10,.485))
export(buried,'buried.glb')

# Alpha decal, organic dark indentation with sunlit disturbed sand at the rim.
im=bpy.data.images.new('dig_hole',width=512,height=512,alpha=True)
im.colorspace_settings.name='sRGB';pixels=[]
for y in range(512):
    for x in range(512):
        u=(x-255.5)/225;v=(y-255.5)/207;a=math.atan2(v,u)
        radius=math.hypot(u,v)/(1+.045*math.sin(7*a)+.028*math.sin(11*a+.9))
        grain=.026*math.sin(x*12.3+y*51.7)*math.sin(y*4.7-x*6.3)
        if radius<.66:
            c=(.11+radius*.12+grain,.065+radius*.07+grain,.028+radius*.025+grain);alpha=.96
        elif radius<.84:
            t=(radius-.66)/.18;light=.78+.22*math.sin(a)
            c=tuple(z*light+grain for z in (.68,.49,.27));alpha=.92*(1-.15*t)
        else:
            c=(.67+grain,.51+grain,.31+grain);alpha=max(0,1-(radius-.84)/.16)**2*.78
        pixels.extend((*[max(0,min(1,c0)) for c0 in c],alpha))
im.pixels.foreach_set(pixels);im.update();im.filepath_raw=str(OUT/'dig_hole.png');im.file_format='PNG';im.save()
bpy.context.scene.frame_set(0)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'chest_source.blend'))
print('CHEST_EXPORT_COMPLETE')
