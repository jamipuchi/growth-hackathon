"""Original CC0 toy quadruped/flyer references and rotation-only clip libraries.

Run with Blender 5.2 in background. Blender +Y front becomes glTF -Z.
Only this lane's new files are exported; the existing person library is untouched.
"""
import bpy
import math
import json
import struct
import hashlib
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

OUT = Path(__file__).resolve().parent
CREAM = (.76, .68, .48, 1)
LIGHT = (.94, .87, .69, 1)
OCHRE = (.60, .31, .085, 1)
JOINT = (.17, .25, .27, 1)
INK = (.026, .041, .048, 1)
GOLD = (.93, .51, .10, 1)
ROSE = (.53, .22, .17, 1)


def smooth(t):
    t = max(0, min(1, t))
    return t*t*(3-2*t)


def key(t, points):
    if t <= points[0][0]:
        return points[0][1]
    for (a, va), (b, vb) in zip(points, points[1:]):
        if t <= b:
            return va + (vb-va)*smooth((t-a)/(b-a))
    return points[-1][1]


class Builder:
    def __init__(self, kind, spec):
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        # Actions from the preceding generated rig must not leak into this export.
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action)
        self.kind = kind
        self.spec = spec
        self.parts = []
        self.root = self.empty(kind+'_reference')
        self.root['license'] = 'CC0-1.0'
        self.root['front'] = '-Z in glTF'
        self.arm = bpy.data.armatures.new(kind+'_skeleton')
        self.rig = bpy.data.objects.new(kind+'_rig', self.arm)
        bpy.context.collection.objects.link(self.rig)
        self.rig.parent = self.root
        bpy.context.view_layer.objects.active = self.rig
        self.rig.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        for name, (head, tail, parent) in spec.items():
            bone = self.arm.edit_bones.new(name)
            bone.head, bone.tail = head, tail
            if parent:
                bone.parent = self.arm.edit_bones[parent]
            bone.use_connect = False
        bpy.ops.object.mode_set(mode='OBJECT')
        self.rig.select_set(False)
        self.material = bpy.data.materials.new(kind+'_paint')
        self.material.use_nodes = True
        self.material.diffuse_color = CREAM
        bsdf = self.material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = .78
        bsdf.inputs['Metallic'].default_value = 0
        paint = self.material.node_tree.nodes.new('ShaderNodeVertexColor')
        paint.layer_name = 'paint'
        self.material.node_tree.links.new(paint.outputs['Color'], bsdf.inputs['Base Color'])
        self.material.use_backface_culling = True

    def empty(self, name):
        obj = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(obj)
        return obj

    def attach(self, obj, name, bone, color):
        obj.name = name
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.data.materials.clear()
        obj.data.materials.append(self.material)
        paint = obj.data.color_attributes.new(name='paint', type='FLOAT_COLOR', domain='CORNER')
        for value in paint.data:
            value.color = color
        obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
        for polygon in obj.data.polygons:
            polygon.use_smooth = False
        obj.select_set(False)
        self.parts.append(obj)
        return obj

    def ellipsoid(self, name, loc, size, bone, color=CREAM, segments=12, rings=8, angles=(0, 0, 0)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=loc)
        obj = bpy.context.object
        obj.scale = size
        obj.rotation_euler = tuple(math.radians(a) for a in angles)
        return self.attach(obj, name, bone, color)

    def segment(self, name, start, end, radius, bone, color=CREAM, segments=10, rings=6):
        start, end = Vector(start), Vector(end)
        middle, delta = (start+end)/2, end-start
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=middle)
        obj = bpy.context.object
        obj.scale = (radius, radius, delta.length/2+radius*.35)
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = delta.to_track_quat('Z', 'Y')
        return self.attach(obj, name, bone, color)

    def prism(self, name, points, z, thickness, bone, color=CREAM, bevel=.025):
        count = len(points)
        vertices = [(x, y, z+dz) for dz in (-thickness/2, thickness/2) for x, y in points]
        faces = [tuple(reversed(range(count))), tuple(range(count, count*2))]
        faces += [(i, (i+1)%count, (i+1)%count+count, i+count) for i in range(count)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        # Recalculate outward normals for mirrored polygon outlines.
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        if bevel:
            mod = obj.modifiers.new('soft_edges', 'BEVEL')
            mod.width, mod.segments = bevel, 1
            bpy.ops.object.modifier_apply(modifier=mod.name)
        return self.attach(obj, name, bone, color)

    def socket(self, name, bone, location):
        obj = self.empty('socket_'+name)
        obj.parent, obj.parent_type, obj.parent_bone = self.rig, 'BONE', bone
        rest = self.arm.bones[bone]
        parent = self.rig.matrix_world @ rest.matrix_local @ Matrix.Translation((0, rest.length, 0))
        obj.matrix_basis = parent.inverted() @ Matrix.Translation(location)

    def merge(self):
        bpy.ops.object.select_all(action='DESELECT')
        for obj in self.parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        bpy.ops.object.join()
        self.mesh = bpy.context.object
        self.mesh.name = self.kind+'_mesh'
        self.mesh.parent = self.rig
        mod = self.mesh.modifiers.new('triangles', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=mod.name)
        # The preview is deliberately flat shaded, with no tangents or textures.
        for uv in list(self.mesh.data.uv_layers):
            self.mesh.data.uv_layers.remove(uv)
        skin = self.mesh.modifiers.new('skin', 'ARMATURE')
        skin.object = self.rig
        self.mesh.select_set(False)
        assert len(self.mesh.data.polygons) < 5000

    def export(self, durations, loops, pose, sockets, note):
        scene = bpy.context.scene
        scene.render.fps, scene.frame_start = 30, 0
        self.rig.animation_data_create()
        for name, duration in durations.items():
            action = bpy.data.actions.new(name)
            action.use_fake_user = True
            action['loop'] = name in loops
            self.rig.animation_data.action = action
            frames = round(duration*30)
            for frame in range(frames+1):
                angles = pose(name, frame/frames, self.spec)
                for bone, euler in angles.items():
                    pb = self.rig.pose.bones[bone]
                    pb.rotation_mode = 'QUATERNION'
                    rest_basis = pb.bone.matrix_local.to_quaternion()
                    x, y, z = [math.radians(v) for v in euler]
                    world_delta = Quaternion((1,0,0), x) @ Quaternion((0,1,0), y) @ Quaternion((0,0,1), z)
                    pb.rotation_quaternion = rest_basis.inverted() @ world_delta @ rest_basis
                    pb.keyframe_insert(data_path='rotation_quaternion', frame=frame)
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in bag.fcurves:
                            for k in curve.keyframe_points:
                                k.interpolation = 'LINEAR'
        self.rig.animation_data.action = None
        for pb in self.rig.pose.bones:
            pb.rotation_quaternion, pb.location, pb.scale = Quaternion(), (0,0,0), (1,1,1)
        scene.frame_set(0)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        def tree(obj):
            return [obj]+[desc for child in obj.children for desc in tree(child)]
        for obj in tree(self.root):
            obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(OUT/(self.kind+'.glb')), export_format='GLB', use_selection=True,
            export_yup=True, export_apply=False, export_extras=True, export_animations=True,
            export_animation_mode='ACTIONS', export_force_sampling=False, export_anim_single_armature=True,
            export_bake_animation=False, export_skins=True, export_all_influences=False)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(self.kind+'_source.blend')))
        points = [Vector(v.co) for v in self.mesh.data.vertices]
        # Convert Blender XYZ to glTF X,Z,-Y without altering the authored source.
        positions = [(p.x,p.z,-p.y) for p in points]
        bounds = {'min':[min(p[a] for p in positions) for a in range(3)],
                  'max':[max(p[a] for p in positions) for a in range(3)]}
        manifest = {'fps':30, 'license':'CC0-1.0', 'bones':list(self.spec),
            'parents':{n:spec[2] for n,spec in self.spec.items()},
            'sockets':sockets, 'bounds':bounds, 'limbScaleRange':[.7,1.4],
            'triangles':len(self.mesh.data.polygons), 'materials':1, 'textures':0,
            'origin':'between_feet' if self.kind=='quadruped' else 'body_center',
            'forward':'-Z', 'up':'Y', 'referenceHeight':bounds['max'][1]-bounds['min'][1],
            'clips':{n:{'duration':d,'loop':n in loops,'rootMotion':'external','tracks':'rotation_only'} for n,d in durations.items()},
            'limitations':note}
        (OUT/(self.kind+'-clips.json')).write_text(json.dumps(manifest, indent=2)+'\n')
        print(self.kind.upper()+'_EXPORTED', len(self.mesh.data.polygons), 'triangles', len(durations), 'clips')


def zero(spec):
    return {name:[0.,0.,0.] for name in spec}


def leg(pose, name, upper=0, lower=0, foot=0):
    pose[name+'_upper'][0] = upper
    pose[name+'_lower'][0] = lower
    pose[name+'_foot'][0] = foot-upper-lower


def quadruped_pose(name, t, spec):
    p = zero(spec)
    phase = math.tau*t
    w = math.sin(phase)
    p['spine_1'][0] = .6*w
    p['neck'][0] = -.5*w
    p['tail_1'][2], p['tail_2'][2] = 7*w, 8*math.sin(phase-.55)
    if name == 'idle':
        p['head'][2] = 2.5*w
        p['tail_1'][0] = 2*math.sin(phase)
    elif name in ('walk','gallop'):
        gallop = name == 'gallop'
        offsets = {'front_l':0,'back_r':math.pi/2,'front_r':math.pi,'back_l':math.pi*1.5}
        if gallop:
            offsets = {'front_l':0,'front_r':.30,'back_l':math.pi,'back_r':math.pi+.3}
        for part, offset in offsets.items():
            swing = math.sin(phase+offset)
            recover = max(0, math.sin(phase+offset+.5))**2
            leg(p, part, (38 if gallop else 20)*swing, -(54 if gallop else 30)*recover)
        p['hips'][0] = (4 if gallop else 1)*math.sin(phase*2)
        p['spine_1'][0] = (8 if gallop else 1.5)*math.sin(phase)
        p['spine_2'][0] = -(6 if gallop else 1)*math.sin(phase+.3)
        p['neck'][0] = -p['spine_1'][0]*.4
        p['head'][0] = -p['hips'][0]
        p['tail_1'][0] = 10*math.sin(phase-.35) if gallop else 2*w
    elif name == 'jump':
        prepare = key(t, [(0,0),(.2,1),(.39,0),(.69,.65),(.86,.4),(1,0)])
        reach = key(t, [(0,0),(.2,-8),(.4,34),(.62,-28),(.84,16),(1,0)])
        p['hips'][0] = key(t, [(0,0),(.2,-6),(.43,12),(.70,6),(.86,-7),(1,0)])
        p['spine_1'][0] = -7*prepare
        p['neck'][0] = 8*prepare
        for side in ('l','r'):
            leg(p,'front_'+side,reach+12*prepare,-45*prepare)
            leg(p,'back_'+side,-reach*.65+27*prepare,-58*prepare)
        p['tail_1'][0] = -12*math.sin(math.pi*t)
        p['tail_2'][0] = 8*math.sin(math.pi*t)
    elif name == 'sit':
        p['hips'][0] = 24
        p['spine_1'][0] = -6+.6*w
        p['neck'][0], p['head'][0] = -12,-6
        for side in ('l','r'):
            leg(p,'front_'+side,-24,5,-18)
            leg(p,'back_'+side,64,-106,-24)
        p['tail_1'][0] = -22
    elif name == 'bite':
        strike = key(t, [(0,0),(.20,-.5),(.42,1),(.55,.75),(.78,-.12),(1,0)])
        p['spine_2'][0] = -5*strike
        p['neck'][0], p['head'][0] = -22*strike,-11*strike
        for side in ('l','r'):
            leg(p,'front_'+side,8*strike,-12*max(0,strike))
        p['tail_1'][2],p['tail_2'][2] = 0,0
    elif name == 'dig':
        p['spine_2'][0],p['neck'][0],p['head'][0] = -6,-8,-8
        for side,offset in [('l',0),('r',.5)]:
            cycle=(t+offset)%1
            stroke=key(cycle,[(0,-15),(.26,40),(.45,45),(.63,-27),(.83,-22),(1,-15)])
            bend=key(cycle,[(0,8),(.25,52),(.45,50),(.66,6),(1,8)])
            leg(p,'front_'+side,stroke,-bend,-10)
            leg(p,'back_'+side,-5,-8)
        p['tail_1'][0]=9
    elif name == 'roar':
        lift=key(t,[(0,0),(.18,-.2),(.38,1),(.7,.85),(.84,.7),(1,0)])
        tremor=math.sin(phase*5)*math.sin(math.pi*t)*2
        p['spine_1'][0],p['spine_2'][0] = 5*lift,5*lift
        p['neck'][0],p['head'][0] = 18*lift,24*lift+tremor
        p['tail_1'][0]=18*lift
    elif name == 'hit':
        impact=key(t,[(0,0),(.15,1),(.36,.35),(.64,-.10),(1,0)])
        p['hips'][1],p['spine_2'][0],p['head'][0] = 9*impact,8*impact,18*impact
        p['neck'][2]=-10*impact
        p['tail_1'][2],p['tail_2'][2] = -18*impact,-10*impact
    elif name == 'die':
        fall=key(t,[(0,0),(.17,-6),(.43,28),(.69,97),(.81,86),(1,91)])
        collapse=smooth(t/.65)
        p['hips'][1],p['spine_1'][0],p['head'][2] = fall,9*collapse,-18*collapse
        for side in ('l','r'):
            leg(p,'front_'+side,10*collapse,-32*collapse,8*collapse)
            leg(p,'back_'+side,-12*collapse,-28*collapse,-4*collapse)
        p['tail_1'][0],p['tail_2'][0] = -28*collapse,-12*collapse
        p['tail_1'][2],p['tail_2'][2] = 0,0
    return p


def make_quadruped():
    spec={'hips':((0,-.48,.78),(0,-.17,.84),None),
          'spine_1':((0,-.17,.84),(0,.20,.88),'hips'),
          'spine_2':((0,.20,.88),(0,.53,.91),'spine_1'),
          'neck':((0,.53,.91),(0,.80,1.07),'spine_2'),
          'head':((0,.80,1.07),(0,1.15,1.17),'neck'),
          'tail_1':((0,-.48,.78),(0,-.90,.94),'hips'),
          'tail_2':((0,-.90,.94),(0,-1.23,1.06),'tail_1')}
    for side,s in [('l',1),('r',-1)]:
        for end,parent,points in [
            ('front','spine_2',[(s*.34,.47,.90),(s*.37,.54,.46),(s*.39,.64,.16),(s*.39,.91,.10)]),
            ('back','hips',[(s*.32,-.52,.78),(s*.37,-.37,.42),(s*.38,-.59,.15),(s*.38,-.30,.10)])]:
            for i,label in enumerate(('upper','lower','foot')):
                name=end+'_'+side+'_'+label
                spec[name]=(points[i],points[i+1],parent)
                parent=name
    b=Builder('quadruped',spec)
    b.ellipsoid('rump',(0,-.43,.84),(.37,.40,.32),'hips',CREAM,14,8)
    b.ellipsoid('barrel',(0,-.03,.89),(.35,.45,.29),'spine_1',CREAM,14,8)
    b.ellipsoid('chest',(0,.34,.93),(.34,.32,.30),'spine_2',CREAM,14,8)
    b.segment('collar',spec['neck'][0],spec['neck'][1],.19,'neck',LIGHT)
    b.ellipsoid('head_shell',(0,1.00,1.20),(.30,.35,.29),'head',CREAM,16,10)
    b.ellipsoid('muzzle',(0,1.32,1.10),(.24,.205,.16),'head',LIGHT,12,8)
    b.ellipsoid('nose',(0,1.511,1.14),(.12,.052,.065),'head',JOINT,10,6)
    b.ellipsoid('smile',(0,1.487,1.033),(.105,.022,.020),'head',INK,10,6)
    for side,s in [('l',1),('r',-1)]:
        b.ellipsoid('ear_'+side,(s*.23,.83,1.425),(.112,.15,.20),'head',OCHRE,10,6,angles=(12,0,-s*15))
        b.ellipsoid('ear_inset_'+side,(s*.23,.945,1.455),(.060,.023,.095),'head',ROSE,8,6)
        b.ellipsoid('eye_'+side,(s*.168,1.286,1.29),(.047,.034,.064),'head',INK,10,6)
        b.ellipsoid('eye_glint_'+side,(s*.157,1.315,1.312),(.011,.008,.015),'head',LIGHT,8,4)
        for end in ('front','back'):
            stem=end+'_'+side
            upper,lower,foot=[spec[stem+'_'+part] for part in ('upper','lower','foot')]
            b.segment(stem+'_thigh',upper[0],upper[1],.115 if end=='front' else .145,stem+'_upper',CREAM,12,6)
            b.ellipsoid(stem+'_knee',lower[0],(.098,.100,.100),stem+'_lower',OCHRE,10,6)
            b.segment(stem+'_shin',lower[0],lower[1],.077,stem+'_lower',LIGHT,10,6)
            midpoint=(Vector(foot[0])+Vector(foot[1]))/2
            b.ellipsoid(stem+'_paw',(midpoint.x,midpoint.y+.03,.102),(.145,.218,.102),stem+'_foot',JOINT,12,6)
            for dx in (-.059,.059):
                b.ellipsoid(stem+'_toe', (midpoint.x+dx,midpoint.y+.211,.103),(.035,.026,.025),stem+'_foot',LIGHT,8,4)
    b.segment('tail_base',spec['tail_1'][0],spec['tail_1'][1],.105,'tail_1',OCHRE,10,6)
    b.segment('tail_tip',spec['tail_2'][0],spec['tail_2'][1],.078,'tail_2',LIGHT,10,6)
    b.merge()
    sockets={'mouth':'head','seat':'spine_2','tail':'tail_2'}
    b.socket('mouth','head',(0,1.54,1.09));b.socket('seat','spine_2',(0,.10,1.185));b.socket('tail','tail_2',(0,-1.23,1.06))
    durations={'idle':2.4,'walk':1.2,'gallop':.8,'jump':1.0,'sit':2.4,'bite':.7,'dig':1.2,'roar':1.6,'hit':.5,'die':1.4}
    b.export(durations,{'idle','walk','gallop','sit','dig'},quadruped_pose,sockets,
        ['Root translation, gravity and ground contact are external.',
         'Sit, jump and die require gameplay root/ground placement; no position or scale tracks are authored.',
         'Bite/roar use neck/head gestures: the fixed contract has no jaw bone.',
         'Rigid segment weights make a neutral retargeting reference, not a final continuous animal skin.'])


def flyer_pose(name,t,spec):
    p=zero(spec);phase=math.tau*t;w=math.sin(phase)
    if name=='flap':
        p['body'][0]=3*w;p['neck'][0]=-2*w;p['head'][0]=-w
        for side,s in [('l',1),('r',-1)]:
            p['wing_'+side+'_1'][1]=s*38*w
            p['wing_'+side+'_2'][1]=s*19*math.sin(phase-.55)
            p['wing_'+side+'_2'][2]=-s*7*(1-math.cos(phase))
        p['tail'][0]=5*math.sin(phase-.8)
    elif name=='glide':
        p['body'][0]=-4;p['neck'][0]=3;p['head'][0]=1
        for side,s in [('l',1),('r',-1)]:
            p['wing_'+side+'_1'][1]=s*(-6+2*w)
            p['wing_'+side+'_2'][1]=s*(8+1.5*math.sin(phase-.45))
            p['wing_'+side+'_2'][2]=-s*7
        p['tail'][0]=-7+1.5*w
    elif name=='dive':
        tuck=key(t,[(0,0),(.17,-.15),(.48,1),(1,1)])
        p['body'][0]=key(t,[(0,-4),(.17,8),(.58,-58),(1,-55)])
        p['neck'][0],p['head'][0]=18*max(0,tuck),7*max(0,tuck)
        for side,s in [('l',1),('r',-1)]:
            p['wing_'+side+'_1'][2]=-s*45*tuck
            p['wing_'+side+'_2'][2]=-s*43*tuck
            p['wing_'+side+'_1'][1]=s*14*tuck
            p['wing_'+side+'_2'][1]=-s*7*tuck
        p['tail'][0]=-15*tuck
    elif name=='land':
        flare=key(t,[(0,0),(.20,1),(.46,.8),(.72,.1),(1,0)])
        fold=key(t,[(0,0),(.54,0),(1,1)])
        p['body'][0]=key(t,[(0,-10),(.26,16),(.61,-6),(.78,3),(1,0)])
        p['neck'][0]=-p['body'][0]*.6
        for side,s in [('l',1),('r',-1)]:
            p['wing_'+side+'_1'][1]=-s*45*flare
            p['wing_'+side+'_2'][1]=-s*12*flare
            p['wing_'+side+'_1'][2]=-s*32*fold
            p['wing_'+side+'_2'][2]=-s*58*fold
        p['tail'][0]=18*flare
    elif name=='hit':
        impact=key(t,[(0,0),(.14,1),(.38,.25),(.65,-.13),(1,0)])
        p['body'][1],p['body'][0]=17*impact,9*impact
        p['head'][0]=-15*impact
        for side,s in [('l',1),('r',-1)]:
            p['wing_'+side+'_1'][1]=s*(-15+10*s)*impact
            p['wing_'+side+'_2'][1]=s*24*impact
        p['tail'][0]=-19*impact
    elif name=='die':
        fall=key(t,[(0,0),(.18,-8),(.64,92),(.8,83),(1,88)])
        fold=smooth(t/.7)
        p['body'][0],p['body'][1],p['neck'][0] = fall,23*fold,-20*fold
        for side,s in [('l',1),('r',-1)]:
            p['wing_'+side+'_1'][2]=-s*29*fold
            p['wing_'+side+'_2'][2]=-s*53*fold
            p['wing_'+side+'_1'][1]=s*25*fold
        p['tail'][0]=-22*fold
    return p


def make_flyer():
    spec={'body':((0,0,0),(0,.22,0),None),
          'neck':((0,.22,0),(0,.50,.16),'body'),
          'head':((0,.50,.16),(0,.82,.20),'neck'),
          'wing_l_1':((.24,.10,.06),(.86,-.05,.10),'body'),
          'wing_l_2':((.86,-.05,.10),(1.50,-.27,.02),'wing_l_1'),
          'wing_r_1':((-.24,.10,.06),(-.86,-.05,.10),'body'),
          'wing_r_2':((-.86,-.05,.10),(-1.50,-.27,.02),'wing_r_1'),
          'tail':((0,-.32,-.02),(0,-.85,-.05),'body')}
    b=Builder('flyer',spec)
    b.ellipsoid('body_shell',(0,-.015,0),(.34,.54,.32),'body',CREAM,16,10)
    b.ellipsoid('breast',(0,.28,-.04),(.255,.255,.23),'body',LIGHT,12,8)
    b.segment('collar',spec['neck'][0],spec['neck'][1],.20,'neck',LIGHT,12,6)
    b.ellipsoid('head_shell',(0,.66,.23),(.31,.30,.28),'head',CREAM,16,10)
    for side,s in [('l',1),('r',-1)]:
        b.ellipsoid('face_'+side,(s*.13,.911,.28),(.115,.048,.127),'head',LIGHT,12,6)
        b.ellipsoid('eye_'+side,(s*.13,.951,.29),(.045,.022,.057),'head',INK,10,6)
        b.ellipsoid('eye_glint_'+side,(s*.119,.969,.309),(.012,.006,.016),'head',LIGHT,8,4)
        b.ellipsoid('brow_'+side,(s*.13,.894,.411),(.125,.050,.041),'head',OCHRE,10,6,angles=(0,s*10,0))
        b.ellipsoid('wing_upper_'+side,(s*.60,-.035,.075),(.42,.265,.115),'wing_'+side+'_1',CREAM,12,8,angles=(0,0,-s*10))
        outline=[(.71,.11),(1.14,.075),(1.49,-.10),(1.57,-.37),(1.46,-.32),(1.36,-.57),(1.25,-.40),(1.13,-.62),(1.01,-.40),(.83,-.49),(.70,-.22)]
        b.prism('wing_feathers_'+side,[(s*x,y) for x,y in outline],.070,.115,'wing_'+side+'_2',LIGHT,.025)
        b.ellipsoid('wing_patch_'+side,(s*1.12,-.06,.136),(.25,.105,.025),'wing_'+side+'_2',OCHRE,10,6,angles=(0,0,-s*18))
        b.ellipsoid('claw_pad_'+side,(s*.13,.035,-.338),(.085,.15,.058),'body',GOLD,10,6)
        for dx in (-.038,.038):
            b.segment('toe_'+side,(s*.13+dx,.09,-.35),(s*.13+dx,.245,-.367),.023,'body',OCHRE,8,4)
    bpy.ops.mesh.primitive_cone_add(vertices=6,radius1=.131,radius2=.014,depth=.29,location=(0,1.019,.168),rotation=(-math.pi/2,0,0))
    beak=bpy.context.object;beak.scale=(1,.68,1)
    b.attach(beak,'beak','head',GOLD)
    for i in (-1,0,1):
        b.ellipsoid('tail_feather',(i*.13,-.65,-.055),(.132,.365,.060),'tail',OCHRE if i else LIGHT,10,6,angles=(0,0,-i*12))
    b.merge()
    sockets={'seat':'body','nose':'head','claws':'body'}
    b.socket('seat','body',(0,-.04,.33));b.socket('nose','head',(0,1.17,.168));b.socket('claws','body',(0,.20,-.39))
    b.export({'flap':.8,'glide':2.4,'dive':1.2,'land':1.2,'hit':.5,'die':1.4}, {'flap','glide'},flyer_pose,sockets,
        ['Root flight path, gravity and landing height are external; all tracks are rotation only.',
         'Claws are rigidly body-weighted because the contract provides no leg/claw bones.',
         'Land/die require gameplay ground placement; rigid toy wing segments are neutral retargeting references.'])


def validate_glb(kind):
    path=OUT/(kind+'.glb')
    raw=path.read_bytes()
    magic,version,total=struct.unpack_from('<4sII',raw)
    assert magic==b'glTF' and version==2 and total==len(raw)
    length,chunk=struct.unpack_from('<II',raw,12)
    assert chunk==0x4E4F534A
    doc=json.loads(raw[20:20+length])
    offset=20+length
    bin_length,bin_type=struct.unpack_from('<II',raw,offset)
    assert bin_type==0x004E4942
    data=raw[offset+8:offset+8+bin_length]
    widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
    formats={5126:'f',5125:'I',5123:'H',5121:'B'}
    def accessor(index):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
        fmt='<'+formats[a['componentType']]*widths[a['type']]
        stride=v.get('byteStride',struct.calcsize(fmt));start=v.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from(fmt,data,start+i*stride) for i in range(a['count'])]
    manifest=json.loads((OUT/(kind+'-clips.json')).read_text())
    nodes=doc['nodes'];names={n['name']:i for i,n in enumerate(nodes)}
    assert all(n in names for n in manifest['bones'])
    parents={child:i for i,node in enumerate(nodes) for child in node.get('children',[])}
    for bone,parent in manifest['parents'].items():
        if parent:
            assert parents[names[bone]]==names[parent],(bone,parent)
    assert len(doc.get('skins',[]))==1 and len(doc.get('meshes',[]))==1
    skin=doc['skins'][0]
    assert set(skin['joints'])=={names[n] for n in manifest['bones']}
    assert len(doc.get('materials',[]))==1 and not doc.get('textures') and not doc.get('images')
    assert all('uri' not in buf for buf in doc['buffers'])
    assert not doc.get('extensionsRequired')
    primitive=doc['meshes'][0]['primitives']
    assert len(primitive)==1
    prim=primitive[0];attrs=prim['attributes']
    positions=accessor(attrs['POSITION']);normals=accessor(attrs['NORMAL'])
    weights=accessor(attrs['WEIGHTS_0']);joints=accessor(attrs['JOINTS_0']);indices=accessor(prim['indices'])
    assert len(indices)//3==manifest['triangles'] and len(indices)//3<5000
    assert all(math.isfinite(x) for row in positions+normals+weights for x in row)
    assert all(abs(sum(x*x for x in n)-1)<1e-4 for n in normals)
    assert all(0<=row[0]<len(positions) for row in indices)
    assert all(abs(sum(w)-1)<1e-5 and sum(x>0 for x in w)<=4 for w in weights)
    assert all(0<=j<len(skin['joints']) for row in joints for j in row)
    assert all('socket_'+name in names for name in manifest['sockets'])
    assert set(a['name'] for a in doc['animations'])==set(manifest['clips'])
    evidence={}
    for animation in doc['animations']:
        name=animation['name'];info=manifest['clips'][name]
        assert len(animation['channels'])==len(manifest['bones'])
        assert {c['target']['node'] for c in animation['channels']}==set(skin['joints'])
        largest_loop=0
        for channel in animation['channels']:
            assert channel['target']['path']=='rotation'
            sampler=animation['samplers'][channel['sampler']]
            times=[row[0] for row in accessor(sampler['input'])];values=accessor(sampler['output'])
            assert abs(times[0])<1e-6 and abs(times[-1]-info['duration'])<1e-5
            assert all(abs(t*30-round(t*30))<1e-4 for t in times)
            assert all(math.isfinite(x) for q in values for x in q)
            assert all(abs(sum(x*x for x in q)-1)<1e-4 for q in values)
            if info['loop']:
                distance=min(max(abs(a-b) for a,b in zip(values[0],values[-1])),max(abs(a+b) for a,b in zip(values[0],values[-1])))
                largest_loop=max(largest_loop,distance)
                assert distance<1e-5,(kind,name,distance)
        evidence[name]={'duration':info['duration'],'tracks':len(animation['channels']),'loop':info['loop'],'maxLoopQuaternionDifference':largest_loop if info['loop'] else None}
    return {'pass':True,'file':path.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
        'triangles':len(indices)//3,'vertices':len(positions),'bones':len(skin['joints']),
        'skinnedMeshes':1,'primitives':1,'materials':1,'textures':0,
        'maxInfluences':max(sum(x>0 for x in w) for w in weights),'clips':evidence,
        'geometryFinite':True,'normalsUnit':True,'indicesValid':True,'weightsNormalized':True,
        'hierarchyExact':True,'socketsPresent':True,'onlyRotationTracks':True,'bounds':manifest['bounds']}


make_quadruped()
make_flyer()
report={kind:validate_glb(kind) for kind in ('quadruped','flyer')}
report['scope']='Blender export and binary/static validation only; parent owns browser, visual and proportion checks.'
(OUT/'quadruped-flyer-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print('QUADRUPED_FLYER_STATIC_PASS',json.dumps({k:{'triangles':v['triangles'],'bytes':v['bytes']} for k,v in report.items() if isinstance(v,dict)}))
