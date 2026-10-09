"""Original Space Party v1 defaults. Run with Blender 5.2: blender -b --python this-file.
Blender +Y is the forward direction, exported as glTF -Z. All art is procedural CC0.
"""
import bpy, math, random
from mathutils import Vector, Matrix, Quaternion
from pathlib import Path

OUT=Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps=30
WHITE=(.83,.78,.65,1);CYAN=(.10,.72,.82,1);DARK=(.027,.043,.055,1)

def mat(name,color,rough=.65,metal=.05,vertex=False,emission=None):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=color
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if vertex:
        c=m.node_tree.nodes.new('ShaderNodeVertexColor');c.layer_name='paint'
        m.node_tree.links.new(c.outputs['Color'],p.inputs['Base Color'])
    if emission:
        p.inputs['Emission Color'].default_value=(*emission,1);p.inputs['Emission Strength'].default_value=5
    return m

PAINT=mat('paper_suit',(1,1,1,1),vertex=True)
TRIM=mat('graphite_trim',DARK,.47,.30)
ENGINE=mat('engine_glow',(0.03,.55,.7,1),.25,.15,emission=(.06,.8,1))
VISOR=mat('visor',(1,1,1,1),.45,.05)

# Default visor is a reflection graphic, with neutral material tint for selfie maps.
im=bpy.data.images.new('visor_default',width=512,height=512,alpha=True)
im.colorspace_settings.name='sRGB';pixels=[]
for y in range(512):
    for x in range(512):
        u=x/511;v=y/511
        color=(.022+.075*v,.055+.13*v,.082+.17*v)
        stripe=abs(u+.42*v-.30)<.035 or abs(u+.42*v-.43)<.012
        if stripe and v>.30:color=(.28,.48,.56)
        if v<.08:color=(.035,.065,.08)
        pixels.extend((*color,1))
im.pixels.foreach_set(pixels);im.update();im.filepath_raw=str(OUT/'visor_default.png');im.file_format='PNG';im.save()
tex=VISOR.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im
VISOR.node_tree.links.new(tex.outputs['Color'],VISOR.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

def finish(o,name,material,color=WHITE,bone=None):
    o.name=name;o.data.name=name+'_geometry'
    bpy.context.view_layer.objects.active=o
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.data.materials.append(material)
    if material==PAINT:
        attr=o.data.color_attributes.new(name='paint',type='FLOAT_COLOR',domain='CORNER')
        rng=random.Random(sum(map(ord,name)))
        for p in o.data.polygons:
            shade=rng.uniform(.94,1.0)
            for i in p.loop_indices:attr.data[i].color=tuple(c*shade for c in color[:3])+(1,)
    if bone:
        group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
    o.select_set(False);return o

def sphere(name,loc,scale,material=PAINT,color=WHITE,bone=None,segments=12,rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=loc)
    o=bpy.context.object;o.scale=scale;return finish(o,name,material,color,bone)

def box(name,loc,scale,material=PAINT,color=WHITE,bone=None,bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=2,location=loc);o=bpy.context.object;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('soft_edge','BEVEL');mod.width=bevel;mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,material,color,bone)

def mesh(name,verts,faces,material=PAINT,color=WHITE,bone=None,uv=None):
    data=bpy.data.meshes.new(name+'_geometry');data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o)
    if uv:
        layer=data.uv_layers.new(name='UVMap')
        for p in data.polygons:
            for i in p.loop_indices:layer.data[i].uv=uv[data.loops[i].vertex_index]
    return finish(o,name,material,color,bone)

def join(parts,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
    o=bpy.context.object;o.name=name;o.data.name=name+'_geometry'
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    tri=o.modifiers.new('triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
    o.select_set(False);return o

def empty(name,parent=None,position=(0,0,0)):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;o.location=position;return o

def descendants(root):return [root]+[o for c in root.children for o in descendants(c)]

# SHIP: a soft delta-wing scout with an unmistakable long nose and twin engines.
ship=empty('default_ship');ship['license']='CC0-1.0';ship_parts=[]
verts=[];faces=[]
profiles=[(-1.13,.30,.13),(-.55,.44,.20),(.25,.46,.24),(.91,.27,.12),(1.53,.045,.035)]
for y,w,h in profiles:
    for i in range(8):
        a=i*math.tau/8;verts.append((w*math.cos(a),y,h*math.sin(a)))
for r in range(len(profiles)-1):
    for k in range(8):n=(k+1)%8;faces.append((r*8+k,r*8+n,(r+1)*8+n,(r+1)*8+k))
faces.extend([tuple(reversed(range(8))),tuple(range(32,40))])
ship_parts.append(mesh('ship_hull',verts,faces))
for side in (-1,1):
    wing=[(.30,.40),(.57,.12),(1.37,-.88),(1.34,-1.10),(.36,-.76)]
    v=[(side*x,y,z) for z in (-.055,.055) for x,y in wing]
    f=[tuple(reversed(range(5))),tuple(range(5,10))]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)]
    if side<0:f=[tuple(reversed(p)) for p in f]
    ship_parts.append(mesh('wing_'+('l' if side<0 else 'r'),v,f))
    # Inset cyan panel follows the swept outer wing rather than protruding.
    panel=[(side*.66,-.29,.065),(side*1.15,-.82,.065),(side*1.12,-.94,.065),(side*.51,-.68,.065)]
    pf=[(3,2,1,0)] if side>0 else [(0,1,2,3)]
    ship_parts.append(mesh('wing_paint_'+str(side).replace('-','n'),panel,pf,color=CYAN))
    ship_parts.append(sphere('engine_pod_'+str(side).replace('-','n'),(side*.68,-.65,-.025),(.24,.69,.23),segments=12,rings=8))
    ship_parts.append(sphere('engine_collar_'+str(side).replace('-','n'),(side*.68,-1.14,-.025),(.23,.20,.215),TRIM,segments=12,rings=6))
    ship_parts.append(sphere('engine_lens_'+str(side).replace('-','n'),(side*.68,-1.325,-.025),(.168,.055,.15),ENGINE,segments=12,rings=6))
    ship_parts.append(box('nacelle_stripe_'+str(side).replace('-','n'),(side*.68,-.60,.192),(.08,.27,.017),color=CYAN,bevel=.013))
ship_parts.append(sphere('canopy',(0,.23,.22),(.285,.61,.21),TRIM,segments=16,rings=8))
ship_parts.append(box('nose_stripe',(0,.96,.13),(.055,.27,.012),color=CYAN,bevel=.01))
ship_parts.append(box('rear_spine',(0,-.73,.21),(.08,.29,.065),color=CYAN,bevel=.025))
ship_mesh=join(ship_parts,'ship_mesh');ship_mesh.parent=ship
volume=0;weighted=Vector()
for face in ship_mesh.data.polygons:
    a,b,c=[ship_mesh.data.vertices[i].co for i in face.vertices]
    mass=a.dot(b.cross(c))/6;volume+=mass;weighted+=(a+b+c)*mass/4
ship_center=weighted/volume
for vertex in ship_mesh.data.vertices:vertex.co-=ship_center
ship['authoring_center_offset']=list(ship_center)
for name,position in {'nose':(0,1.56,0),'wing_l':(-1.37,-.88,0),'wing_r':(1.37,-.88,0),'back':(0,-1.37,0),'belly':(0,0,-.25),'seat':(0,.18,.32)}.items():empty('socket_'+name,ship,Vector(position)-ship_center)
for side in (-1,1):empty('socket_engine_'+('l' if side<0 else 'r'),ship,Vector((side*.68,-1.38,-.025))-ship_center)

def export(root,filename,animations=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in descendants(root):o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',use_selection=True,
        export_yup=True,export_apply=False,export_extras=True,export_animations=animations,
        export_animation_mode='ACTIONS',export_force_sampling=False,export_anim_single_armature=True,
        export_bake_animation=False,export_skins=True,export_all_influences=False,export_materials='EXPORT')

export(ship,'ship.glb')
# Blender requires globally unique object names, unlike separate GLB files.
# Keep the ship editable but free shared socket names for the explorer export.
for o in descendants(ship):o.name='source_'+o.name

# EXPLORER: one authored skinned mesh; three material primitives for suit, trim, visor.
explorer=empty('default_explorer');explorer['license']='CC0-1.0';explorer['reference_height']=1.8
arm=bpy.data.armatures.new('person_skeleton');rig=bpy.data.objects.new('person_rig',arm);bpy.context.collection.objects.link(rig);rig.parent=explorer
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
spec={
 'hips':((0,0,.86),(0,0,1.00),None),
 'spine':((0,0,1.00),(0,0,1.15),'hips'),
 'chest':((0,0,1.15),(0,0,1.31),'spine'),
 'neck':((0,0,1.31),(0,0,1.46),'chest'),
 'head':((0,0,1.46),(0,0,1.78),'neck'),
}
for side,sgn in [('l',1),('r',-1)]:
    spec.update({
     'shoulder_'+side:((sgn*.08,0,1.265),(sgn*.25,0,1.265),'chest'),
     'upper_arm_'+side:((sgn*.25,0,1.265),(sgn*.49,0,1.265),'shoulder_'+side),
     'fore_arm_'+side:((sgn*.49,0,1.265),(sgn*.69,0,1.265),'upper_arm_'+side),
     'hand_'+side:((sgn*.69,0,1.265),(sgn*.80,0,1.265),'fore_arm_'+side),
     'thigh_'+side:((sgn*.135,0,.86),(sgn*.135,0,.49),'hips'),
     'shin_'+side:((sgn*.135,0,.49),(sgn*.135,0,.15),'thigh_'+side),
     'foot_'+side:((sgn*.135,0,.15),(sgn*.135,.19,.08),'shin_'+side),
    })
for name,(head,tail,parent) in spec.items():
    bone=arm.edit_bones.new(name);bone.head=head;bone.tail=tail
    if parent:bone.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)
parts=[]
parts.append(sphere('hips_suit',(0,0,.88),(.225,.16,.18),bone='hips'))
parts.append(sphere('torso_suit',(0,0,1.105),(.255,.185,.25),bone='spine',segments=16,rings=8))
parts.append(box('backpack',(0,-.205,1.13),(.19,.11,.20),bone='chest',bevel=.055))
parts.append(box('backpack_spine',(0,-.317,1.14),(.055,.01,.135),TRIM,bone='chest',bevel=.008))
parts.append(box('chest_panel',(0,.171,1.135),(.115,.025,.10),TRIM,bone='chest',bevel=.022))
parts.append(box('chest_display',(0,.20,1.167),(.075,.01,.034),color=CYAN,bone='chest',bevel=.008))
for i in range(3):parts.append(sphere('panel_button_'+str(i),((i-1)*.043,.208,1.105),(.012,.007,.012),color=CYAN,bone='chest',segments=8,rings=4))
parts.append(sphere('collar',(0,0,1.332),(.185,.17,.06),TRIM,bone='neck'))
parts.append(sphere('helmet',(0,0,1.53),(.27,.255,.27),bone='head',segments=20,rings=12))
for side,sgn in [('l',1),('r',-1)]:
    parts.append(sphere('helmet_ear_'+side,(sgn*.26,-.02,1.53),(.037,.09,.095),color=CYAN,bone='head'))
    parts.append(sphere('shoulder_pad_'+side,(sgn*.26,0,1.265),(.115,.135,.135),bone='upper_arm_'+side))
    parts.append(sphere('upper_sleeve_'+side,(sgn*.375,0,1.265),(.145,.104,.105),bone='upper_arm_'+side))
    parts.append(sphere('elbow_'+side,(sgn*.49,0,1.265),(.052,.103,.103),TRIM,bone='fore_arm_'+side))
    parts.append(sphere('fore_sleeve_'+side,(sgn*.59,0,1.265),(.113,.09,.09),bone='fore_arm_'+side))
    parts.append(sphere('cuff_'+side,(sgn*.68,0,1.265),(.03,.095,.095),color=CYAN,bone='hand_'+side))
    parts.append(sphere('glove_'+side,(sgn*.745,.005,1.265),(.08,.075,.075),bone='hand_'+side))
    parts.append(sphere('thigh_suit_'+side,(sgn*.135,0,.68),(.115,.13,.235),bone='thigh_'+side))
    parts.append(sphere('knee_'+side,(sgn*.135,.06,.49),(.098,.085,.07),TRIM,bone='shin_'+side))
    parts.append(sphere('shin_suit_'+side,(sgn*.135,0,.315),(.10,.115,.19),bone='shin_'+side))
    parts.append(sphere('ankle_band_'+side,(sgn*.135,0,.15),(.106,.123,.033),color=CYAN,bone='foot_'+side))
    parts.append(box('boot_'+side,(sgn*.135,.06,.075),(.114,.175,.075),TRIM,bone='foot_'+side,bevel=.035))
    parts.append(box('boot_toe_'+side,(sgn*.135,.175,.095),(.10,.049,.049),bone='foot_'+side,bevel=.018))

def visor_patch(name,width,height,radius,material):
    verts=[];uv=[];faces=[];columns=16;rows=8
    for row in range(rows+1):
        v=row/rows;a=(v-.5)*height
        for col in range(columns+1):
            u=col/columns;b=(u-.5)*width
            verts.append((radius*math.sin(b)*math.cos(a),radius*math.cos(b)*math.cos(a),1.53+radius*math.sin(a)))
            uv.append((1-u,v))
    for row in range(rows):
        for col in range(columns):
            p=row*(columns+1)+col;faces.append((p,p+columns+1,p+columns+2,p+1))
    return mesh(name,verts,faces,material,bone='head',uv=uv)

parts.append(visor_patch('visor_rim',2.05,1.14,.269,TRIM))
parts.append(visor_patch('visor_surface',1.89,.94,.274,VISOR))
person=join(parts,'explorer_mesh');person.parent=rig
modifier=person.modifiers.new('person_skin','ARMATURE');modifier.object=rig

# Reduce the rigid torso seam by smoothly weighting its vertices to the spine/chest.
# All other parts use one influence, so no vertex can exceed the four-weight budget.
for v in person.data.vertices:
    memberships={person.vertex_groups[g.group].name:g.weight for g in v.groups}
    if memberships=={'spine':1.0}:
        blend=max(0,min(1,(v.co.z-1.09)/.20))
        if 'chest' not in person.vertex_groups:person.vertex_groups.new(name='chest')
        person.vertex_groups['spine'].add([v.index],1-blend,'REPLACE')
        person.vertex_groups['chest'].add([v.index],blend,'REPLACE')

def bone_socket(name,bone,position):
    o=empty('socket_'+name);o.parent=rig;o.parent_type='BONE';o.parent_bone=bone
    b=rig.data.bones[bone];parent=rig.matrix_world@b.matrix_local@Matrix.Translation((0,b.length,0))
    o.matrix_basis=parent.inverted()@Matrix.Translation(position)
    bpy.context.view_layer.update()
    assert (o.matrix_world.translation-Vector(position)).length<1e-5,(name,o.matrix_world.translation)
    return o

bone_socket('head','head',(0,0,1.8))
bone_socket('hand_l','hand_l',(.8,.02,1.265));bone_socket('hand_r','hand_r',(-.8,.02,1.265))
bone_socket('back','chest',(0,-.325,1.16));bone_socket('feet','hips',(0,0,0))

def world_rotation(posebone,rx=0,ry=0,rz=0):
    basis=posebone.bone.matrix_local.to_quaternion()
    q=Quaternion((1,0,0),rx)@Quaternion((0,1,0),ry)@Quaternion((0,0,1),rz)
    posebone.rotation_quaternion=basis.inverted()@q@basis

durations={'idle':2.,'walk':1.2,'run':.8,'jump':.9,'fall':1.,'land':.3,'dig':1.2,'celebrate':2.}
rig.animation_data_create()
for clip,duration in durations.items():
    action=bpy.data.actions.new(clip);action.use_fake_user=True;rig.animation_data.action=action
    action['loop']=clip in ('idle','walk','run','fall','dig','celebrate')
    frames=round(duration*30)
    for frame in range(frames+1):
        t=frame/frames;phase=t*math.tau
        for p in rig.pose.bones:p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion();p.location=(0,0,0)
        bob=.007*(1-math.cos(phase)) if clip=='idle' else 0
        world_rotation(rig.pose.bones['chest'],rx=.016*math.sin(phase))
        for side,sgn in [('l',1),('r',-1)]:
            swing=0;knee=.06;elbow=.10;drop=1.23;arm_swing=0;lean=0
            if clip in ('walk','run'):
                amplitude=.43 if clip=='walk' else .72
                swing=amplitude*math.sin(phase)*sgn;knee=.12+max(0,-math.sin(phase)*sgn)*(.55 if clip=='walk' else 1.0)
                arm_swing=-swing*.65;elbow=.20 if clip=='walk' else .8;drop=1.32
                bob=(.015 if clip=='walk' else .026)*(1-math.cos(phase*2));lean=.05 if clip=='walk' else .14
            elif clip=='jump':
                h=math.sin(math.pi*t);swing=-.32*h;knee=.6*h;drop=1.2-.8*h;arm_swing=.3*h;bob=.11*h
            elif clip=='fall':swing=-.16;knee=.25;drop=.65;arm_swing=.13*math.sin(phase);bob=0
            elif clip=='land':
                bend=math.sin(math.pi*t);swing=.32*bend;knee=.7*bend;arm_swing=.25*bend;bob=-.075*bend;lean=.15*bend
            elif clip=='dig':
                stroke=.5-.5*math.cos(phase);swing=.20;knee=.28;drop=1.65;arm_swing=.60+stroke*.70;elbow=.20+stroke*.12;bob=-.04;lean=.28
            elif clip=='celebrate':drop=-.7+.12*math.sin(phase*2);arm_swing=.12*math.sin(phase);elbow=.3;bob=.025*(1-math.cos(phase*2))
            world_rotation(rig.pose.bones['upper_arm_'+side],rx=arm_swing,ry=sgn*drop)
            world_rotation(rig.pose.bones['fore_arm_'+side],ry=-sgn*elbow)
            world_rotation(rig.pose.bones['thigh_'+side],rx=swing)
            world_rotation(rig.pose.bones['shin_'+side],rx=-knee)
            world_rotation(rig.pose.bones['foot_'+side],rx=max(0,knee*.35))
            world_rotation(rig.pose.bones['spine'],rx=lean)
        rig.pose.bones['hips'].location=(0,bob,0)
        for p in rig.pose.bones:p.keyframe_insert(data_path='rotation_quaternion',frame=frame)
        rig.pose.bones['hips'].keyframe_insert(data_path='location',frame=frame)
    # glTF samples each existing frame; explicit linear interpolation avoids spline overshoot.
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for point in curve.keyframe_points:point.interpolation='LINEAR'

rig.animation_data.action=None
for p in rig.pose.bones:p.rotation_quaternion=Quaternion();p.location=(0,0,0)
bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
export(explorer,'explorer.glb',True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'defaults_source.blend'))
print('DEFAULTS_EXPORTED',{'ship_triangles':len(ship_mesh.data.polygons),'explorer_triangles':len(person.data.polygons),'bones':len(arm.bones),'clips':list(durations)})
