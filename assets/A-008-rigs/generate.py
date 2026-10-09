"""Original CC0 person reference and 33 rotation-only actions. Blender 5.2.
Blender +Y front -> glTF -Z. Rig rest transforms match A-009 explorer.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
OUT=Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps=30;bpy.context.scene.frame_start=0

def empty(name,parent=None,pos=(0,0,0)):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;o.location=pos;return o
root=empty('person_reference');root['license']='CC0-1.0';root['height']=1.8
arm=bpy.data.armatures.new('person_skeleton');rig=bpy.data.objects.new('person_rig',arm);bpy.context.collection.objects.link(rig);rig.parent=root
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
spec={'hips':((0,0,.86),(0,0,1),None),'spine':((0,0,1),(0,0,1.15),'hips'),'chest':((0,0,1.15),(0,0,1.31),'spine'),'neck':((0,0,1.31),(0,0,1.46),'chest'),'head':((0,0,1.46),(0,0,1.78),'neck')}
for side,s in [('l',1),('r',-1)]:
    spec.update({
      'shoulder_'+side:((s*.08,0,1.265),(s*.25,0,1.265),'chest'),
      'upper_arm_'+side:((s*.25,0,1.265),(s*.49,0,1.265),'shoulder_'+side),
      'fore_arm_'+side:((s*.49,0,1.265),(s*.69,0,1.265),'upper_arm_'+side),
      'hand_'+side:((s*.69,0,1.265),(s*.8,0,1.265),'fore_arm_'+side),
      'thigh_'+side:((s*.135,0,.86),(s*.135,0,.49),'hips'),
      'shin_'+side:((s*.135,0,.49),(s*.135,0,.15),'thigh_'+side),
      'foot_'+side:((s*.135,0,.15),(s*.135,.19,.08),'shin_'+side)})
for n,(h,t,parent) in spec.items():
    b=arm.edit_bones.new(n);b.head=h;b.tail=t
    if parent:b.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)
mat=bpy.data.materials.new('neutral_paper');mat.use_nodes=True
bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=.85
attr=mat.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='paint';mat.node_tree.links.new(attr.outputs['Color'],bsdf.inputs['Base Color'])
PAPER=(.67,.64,.55,1);JOINT=(.20,.25,.26,1);FACE=(.065,.11,.12,1)
parts=[]
def ellipsoid(name,loc,scale,bone,color=PAPER,segments=12,rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=loc)
    o=bpy.context.object;o.name=name;o.scale=scale
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.data.materials.append(mat);c=o.data.color_attributes.new(name='paint',type='FLOAT_COLOR',domain='CORNER')
    for p in c.data:p.color=color
    o.vertex_groups.new(name=bone).add(list(range(len(o.data.vertices))),1,'REPLACE')
    o.select_set(False);parts.append(o);return o
ellipsoid('pelvis',(0,0,.88),(.205,.145,.15),'hips')
ellipsoid('waist',(0,0,1.02),(.17,.125,.15),'spine')
ellipsoid('torso',(0,0,1.18),(.225,.15,.19),'chest')
ellipsoid('collar',(0,0,1.345),(.085,.082,.08),'neck',JOINT,10,6)
ellipsoid('head_shell',(0,0,1.57),(.20,.175,.23),'head',segments=16,rings=10)
ellipsoid('face_direction',(0,.164,1.57),(.135,.024,.10),'head',FACE,12,6)
ellipsoid('nose',(0,.19,1.56),(.038,.031,.039),'head',PAPER,8,6)
for side,s in [('l',1),('r',-1)]:
    ellipsoid('shoulder_'+side,(s*.25,0,1.265),(.095,.095,.095),'upper_arm_'+side,JOINT,10,6)
    ellipsoid('upper_'+side,(s*.372,0,1.265),(.145,.072,.078),'upper_arm_'+side)
    ellipsoid('elbow_'+side,(s*.49,0,1.265),(.071,.071,.071),'fore_arm_'+side,JOINT,10,6)
    ellipsoid('fore_'+side,(s*.59,0,1.265),(.12,.064,.068),'fore_arm_'+side)
    ellipsoid('palm_'+side,(s*.753,.002,1.265),(.079,.058,.051),'hand_'+side)
    ellipsoid('thumb_'+side,(s*.729,.052,1.246),(.037,.043,.028),'hand_'+side,segments=8,rings=6)
    ellipsoid('hip_joint_'+side,(s*.135,0,.84),(.09,.09,.09),'thigh_'+side,JOINT,10,6)
    ellipsoid('thigh_shape_'+side,(s*.135,0,.675),(.095,.102,.205),'thigh_'+side)
    ellipsoid('knee_'+side,(s*.135,0,.49),(.084,.084,.084),'shin_'+side,JOINT,10,6)
    ellipsoid('calf_'+side,(s*.135,0,.31),(.078,.086,.19),'shin_'+side)
    ellipsoid('shoe_'+side,(s*.135,.076,.073),(.098,.169,.073),'foot_'+side,JOINT)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();person=bpy.context.object;person.name='person_mesh';person.parent=rig
tri=person.modifiers.new('triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
mod=person.modifiers.new('skin','ARMATURE');mod.object=rig;person.select_set(False)
for name,bone,pos in [('head','head',(0,0,1.8)),('hand_l','hand_l',(.80,.02,1.265)),('hand_r','hand_r',(-.80,.02,1.265)),('back','chest',(0,-.17,1.17)),('feet','hips',(0,0,0))]:
    o=empty('socket_'+name);o.parent=rig;o.parent_type='BONE';o.parent_bone=bone
    b=arm.bones[bone];parent=rig.matrix_world@b.matrix_local@Matrix.Translation((0,b.length,0));o.matrix_basis=parent.inverted()@Matrix.Translation(pos)

def smooth(x):x=max(0,min(1,x));return x*x*(3-2*x)
def key(t,points):
    if t<=points[0][0]:return points[0][1]
    for (a,va),(b,vb) in zip(points,points[1:]):
        if t<=b:return va+(vb-va)*smooth((t-a)/(b-a))
    return points[-1][1]
def base():
    p={n:[0.,0.,0.] for n in spec}
    for side,s in [('l',1),('r',-1)]:
        p['upper_arm_'+side]=[0,s*80,0];p['fore_arm_'+side]=[0,0,s*14]
        p['thigh_'+side][0]=3;p['shin_'+side][0]=-6;p['foot_'+side][0]=3
    return p
def arm_pose(p,side,swing=0,drop=80,elbow=14,twist=0):
    s=1 if side=='l' else -1;p['upper_arm_'+side]=[swing,s*drop,twist];p['fore_arm_'+side]=[0,0,s*elbow]
def leg(p,side,hip=3,knee=6,toe=0):
    p['thigh_'+side][0]=hip;p['shin_'+side][0]=-knee;p['foot_'+side][0]=knee-hip+toe

# Seconds are exact multiples of 1/30; every named action is authored separately.
durations={'idle':2.4,'walk':1.2,'run':.8,'sprint':.6,'jump':.9,'fall':1.2,'land':.4,'crouch':1.6,'roll':1.,'aim':1.6,'shoot':.4,'swing':.8,'throw':1.,'block':1.2,'dig':1.4,'climb':1.6,'swim':1.6,'glide':2.,'sit':2.,'push':1.2,'pick_up':1.4,'kneel':2.,'drink':2.,'cast':1.2,'look':2.4,'read':2.4,'flip':1.2,'hit':.5,'die':1.4,'celebrate':2.,'wave':2.,'step_out':1.6,'climb_in':1.6}
loops=set('idle walk run sprint fall crouch aim block dig climb swim glide sit push kneel look read celebrate wave'.split())

def pose(name,t):
    p=base();phase=math.tau*t;wave=math.sin(phase)
    p['chest'][0]=-.6*wave;p['head'][0]=.4*wave
    if name=='idle':
        p['spine'][1]=.7*wave;p['head'][2]=1.5*math.sin(phase)
        for side,s in [('l',1),('r',-1)]:p['shoulder_'+side][1]=s*.7*wave
    elif name in ('walk','run','sprint'):
        speed={'walk':(28,43,18,25,4),'run':(44,78,34,75,11),'sprint':(57,95,46,86,17)}[name]
        hip,knee,arms,elbow,lean=speed;p['spine'][0]=-lean;p['chest'][2]=3*wave;p['hips'][2]=-2*wave
        for side,s in [('l',1),('r',-1)]:
            swing=wave*s;recovery=max(0,-math.sin(phase+.70)*s)
            leg(p,side,hip*swing,7+knee*recovery,-8*max(0,swing))
            arm_pose(p,side,-arms*swing,82,elbow+8*max(0,swing))
        p['head'][0]=lean*.5
    elif name=='jump':
        tuck=key(t,[(0,0),(.20,1),(.4,0),(.65,.65),(1,.2)])
        reach=key(t,[(0,0),(.20,-28),(.42,145),(.7,95),(1,35)])
        p['spine'][0]=-12*tuck;p['head'][0]=8*tuck
        for side in ('l','r'):leg(p,side,35*tuck,75*tuck);arm_pose(p,side,reach,75,20+35*tuck)
    elif name=='fall':
        p['spine'][0]=-5
        for side,s in [('l',1),('r',-1)]:arm_pose(p,side,15+4*wave*s,42,23);leg(p,side,8+4*wave*s,23)
    elif name=='land':
        bend=key(t,[(0,.2),(.23,1),(.45,.8),(.8,-.03),(1,0)])
        p['spine'][0]=-23*bend;p['head'][0]=12*bend
        for side in ('l','r'):leg(p,side,3+38*bend,6+80*bend);arm_pose(p,side,10+25*bend,70+10*(1-bend),22+15*bend)
    elif name=='crouch':
        p['spine'][0]=-22;p['head'][0]=15
        for side in ('l','r'):leg(p,side,48,96);arm_pose(p,side,25,72,40)
    elif name in ('roll','flip'):
        turn=key(t,[(0,0),(.15,0),(.35,95),(.65,285),(.85,360),(1,360)])
        tuck=key(t,[(0,0),(.2,1),(.7,1),(1,0)])
        p['hips'][0]=turn;p['spine'][0]=-22*tuck;p['head'][0]=-12*tuck
        for side in ('l','r'):leg(p,side,3+70*tuck,6+110*tuck);arm_pose(p,side,30*tuck,80-20*tuck,14+85*tuck)
        if name=='flip':
            for side in ('l','r'):arm_pose(p,side,35*tuck,-35*tuck+80*(1-tuck),14+60*tuck)
    elif name in ('aim','shoot'):
        recoil=key(t,[(0,0),(.15,1),(.38,.3),(1,0)]) if name=='shoot' else .015*wave
        p['spine'][0]=2+8*recoil;p['chest'][2]=-8;p['head'][2]=8
        arm_pose(p,'r',82-12*recoil,85,10+15*recoil);arm_pose(p,'l',67-8*recoil,65,45)
        leg(p,'l',8,14);leg(p,'r',-4,12)
    elif name in ('swing','throw','cast'):
        strike=key(t,[(0,0),(.3,-1),(.52,1),(.7,.9),(1,0)])
        p['chest'][2]=-28*strike;p['spine'][0]=-10*max(0,strike)
        if name=='swing':arm_pose(p,'r',45+65*strike,55,55-35*max(0,strike));arm_pose(p,'l',10,60,45)
        elif name=='throw':arm_pose(p,'r',60+65*strike,45,65-60*max(0,strike));arm_pose(p,'l',30-25*strike,62,20)
        else:arm_pose(p,'r',30+65*max(0,strike),55,30);arm_pose(p,'l',15,50,65);p['hand_r'][2]=25*math.sin(phase*2)*math.sin(math.pi*t)
        leg(p,'l',12+12*max(0,strike),22);leg(p,'r',-8,18)
    elif name=='block':
        p['spine'][0]=-8;p['head'][0]=-5
        arm_pose(p,'l',62,57,100);arm_pose(p,'r',70,75,95)
        for side in ('l','r'):leg(p,side,15,30)
    elif name=='dig':
        lift=key(t,[(0,0),(.25,1),(.4,1),(.58,0),(.68,-.08),(1,0)])
        p['spine'][0]=-32+20*lift;p['chest'][0]=-6*(1-lift);p['head'][0]=14
        arm_pose(p,'r',35+72*lift,83,15+32*lift);arm_pose(p,'l',40+60*lift,70,28+35*lift)
        leg(p,'l',25,45);leg(p,'r',12,34)
    elif name=='climb':
        p['spine'][0]=-8;p['head'][0]=18
        for side,s in [('l',1),('r',-1)]:
            f=(1+wave*s)/2;arm_pose(p,side,8,80-140*f,15+70*(1-f));leg(p,side,12+65*(1-f),35+65*(1-f))
    elif name=='swim':
        p['hips'][0]=-82;p['head'][0]=45
        for side,s in [('l',1),('r',-1)]:arm_pose(p,side,50+100*wave*s,65,15+55*max(0,wave*s));leg(p,side,18*wave*s,12+18*max(0,-wave*s))
    elif name=='glide':
        p['hips'][0]=-52;p['head'][0]=32
        for side,s in [('l',1),('r',-1)]:arm_pose(p,side,5,-7+3*wave*s,8);leg(p,side,-10,23)
    elif name in ('sit','read','drink'):
        seated=name=='sit'
        for side in ('l','r'):
            if seated:leg(p,side,90,90);arm_pose(p,side,32,80,30)
            else:arm_pose(p,side,22,76,102)
        if name=='read':p['head'][0]=-18;p['hand_l'][1]=12;p['hand_r'][1]=-12
        elif name=='drink':
            sip=key(t,[(0,0),(.25,1),(.7,1),(1,0)])
            arm_pose(p,'r',20+22*sip,72,55+65*sip);arm_pose(p,'l',0,80,14);p['head'][0]=10*sip
    elif name=='push':
        effort=(1-math.cos(phase))/2;p['spine'][0]=-17-9*effort
        for side,s in [('l',1),('r',-1)]:arm_pose(p,side,78,78,15+20*(1-effort));leg(p,side,10+s*8,25)
    elif name=='pick_up':
        bend=key(t,[(0,0),(.35,1),(.55,1),(1,0)])
        p['spine'][0]=-40*bend;p['head'][0]=5*bend
        for side in ('l','r'):leg(p,side,3+32*bend,6+60*bend);arm_pose(p,side,20*bend,80,14+18*(1-bend))
    elif name=='kneel':
        leg(p,'l',75,90);leg(p,'r',-15,120);p['spine'][0]=-6
        arm_pose(p,'l',35,70,35);arm_pose(p,'r',0,80,20)
    elif name=='look':p['head'][2]=32*wave;p['chest'][2]=5*wave
    elif name=='hit':
        impact=key(t,[(0,0),(.16,1),(.4,.4),(.7,-.08),(1,0)])
        p['spine'][0]=15*impact;p['chest'][1]=-9*impact;p['head'][1]=-18*impact
        for side in ('l','r'):arm_pose(p,side,-12*impact,80-20*impact,14+30*impact)
    elif name=='die':
        fall=key(t,[(0,0),(.2,8),(.42,24),(.7,86),(.79,93),(.88,88),(1,90)])
        p['hips'][0]=fall;p['spine'][0]=-4;p['head'][0]=-8
        for side,s in [('l',1),('r',-1)]:arm_pose(p,side,-15,55,20);leg(p,side,8+s*5,20+s*10)
    elif name=='celebrate':
        p['spine'][1]=4*wave;p['head'][2]=5*wave
        for side,s in [('l',1),('r',-1)]:arm_pose(p,side,4*wave*s,-54+10*math.sin(phase*2),25);leg(p,side,3+4*wave*s,6+7*max(0,wave*s))
    elif name=='wave':
        arm_pose(p,'r',3,-58,38+15*math.sin(phase*3));p['hand_r'][2]=18*math.sin(phase*3);p['head'][1]=5
    elif name in ('step_out','climb_in'):
        q=t if name=='step_out' else 1-t
        stand=smooth((q-.22)/.72);lift=key(q,[(0,0),(.2,1),(.45,1),(.75,0),(1,0)])
        leg(p,'l',90*(1-stand)+15*lift,90*(1-stand)+10*lift)
        leg(p,'r',90*(1-smooth(q/.75)),90*(1-smooth(q/.75)))
        arm_pose(p,'l',30*(1-stand),80-20*(1-stand),30)
        arm_pose(p,'r',65*(1-stand),75,20+25*(1-stand))
        p['spine'][0]=-18*math.sin(math.pi*q);p['head'][0]=10*math.sin(math.pi*q)
    return p

rig.animation_data_create()
for name,duration in durations.items():
    action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
    action['loop']=name in loops;frames=round(duration*30)
    for frame in range(frames+1):
        poses=pose(name,frame/frames)
        for n,angles in poses.items():
            pb=rig.pose.bones[n];pb.rotation_mode='QUATERNION';basis=pb.bone.matrix_local.to_quaternion()
            rx,ry,rz=[math.radians(v) for v in angles]
            q=Quaternion((1,0,0),rx)@Quaternion((0,1,0),ry)@Quaternion((0,0,1),rz)
            pb.rotation_quaternion=basis.inverted()@q@basis
            pb.keyframe_insert(data_path='rotation_quaternion',frame=frame)
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for k in fc.keyframe_points:k.interpolation='LINEAR'
rig.animation_data.action=None
for pb in rig.pose.bones:pb.rotation_quaternion=Quaternion();pb.location=(0,0,0)
bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
def tree(o):return [o]+[x for c in o.children for x in tree(c)]
for o in tree(root):o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'person.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_extras=True,
 export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=False,export_anim_single_armature=True,export_bake_animation=False,export_skins=True,export_all_influences=False)
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'person_source.blend'))
manifest={'fps':30,'bones':list(spec),'clips':{n:{'duration':d,'loop':n in loops,'rootMotion':'external','tracks':'rotation_only'} for n,d in durations.items()},'referenceHeight':1.8,'limbScaleRange':[.7,1.4]}
(OUT/'person-clips.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('PERSON_EXPORTED',len(person.data.polygons),'triangles',len(durations),'clips')
