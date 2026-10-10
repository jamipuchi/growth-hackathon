"""Original CC0 creature references and quaternion-only clips, Blender 5.2.

blender --background --python assets/A-008-rigs/generate_aquatic_crawler.py
Optional -- --type swimmer|crawler|serpent. Writes only the owned new assets.
Coordinates authored below are engine X/Y/-Z; P maps to Blender X/-Z/Y.
"""
import bpy
import math
import json
import hashlib
import struct
import sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

OUT = Path(__file__).resolve().parent
FPS = 30
CREAM = (.76, .78, .70, 1)
BELLY = (.90, .84, .66, 1)
SHELL = (.51, .64, .64, 1)
DARK = (.12, .23, .25, 1)
GOLD = (.79, .51, .18, 1)
WHITE = (.97, .98, .92, 1)
INK = (.015, .026, .037, 1)
PINK = (.74, .37, .30, 1)


def P(v): return Vector((v[0], -v[2], v[1]))
def add(a, b): return tuple(x+y for x, y in zip(a, b))
def smooth(t):
    t = max(0, min(1, t)); return t*t*(3-2*t)


def key(t, points):
    for (a, av), (b, bv) in zip(points, points[1:]):
        if t <= b: return av+(bv-av)*smooth((t-a)/(b-a))
    return points[-1][1]


def interpolation(x, points):
    if x <= points[0][0]: return points[0][1:]
    for a, b in zip(points, points[1:]):
        if x <= b[0]:
            f = smooth((x-a[0])/(b[0]-a[0]))
            return tuple(u+(v-u)*f for u,v in zip(a[1:], b[1:]))
    return points[-1][1:]


class Geometry:
    def __init__(self): self.vertices=[]; self.faces=[]; self.colours=[]; self.weights=[]
    def vertex(self, position, weights):
        self.vertices.append(tuple(P(position))); self.weights.append(dict(weights)); return len(self.vertices)-1
    def face(self, indices, colour):
        self.faces.append(tuple(indices)); self.colours.append(colour)
    def sphere(self, center, scale, weights, colour, segments=12, rings=7):
        rows=[]
        for j in range(1,rings):
            lat=-math.pi/2+math.pi*j/rings
            row=[]
            for i in range(segments):
                lon=math.tau*i/segments
                p=add(center,(scale[0]*math.cos(lat)*math.cos(lon),scale[1]*math.sin(lat),scale[2]*math.cos(lat)*math.sin(lon)))
                row.append(self.vertex(p,weights(p) if callable(weights) else weights))
            rows.append(row)
        lo=add(center,(0,-scale[1],0)); hi=add(center,(0,scale[1],0))
        bottom=self.vertex(lo,weights(lo) if callable(weights) else weights); top=self.vertex(hi,weights(hi) if callable(weights) else weights)
        for i in range(segments):
            ni=(i+1)%segments
            self.face((bottom,rows[0][i],rows[0][ni]),colour)
            self.face((top,rows[-1][ni],rows[-1][i]),colour)
        for a,b in zip(rows,rows[1:]):
            for i in range(segments):
                ni=(i+1)%segments; self.face((a[i],b[i],b[ni],a[ni]),colour)
    def tube(self, profile, weight, colour, rings=36, sides=14, center_y=0):
        """Connected skin rings, with smoothly interpolated radius and two-bone weights."""
        rows=[]
        for j in range(rings+1):
            z=profile[0][0]+(profile[-1][0]-profile[0][0])*j/rings
            rx,ry=interpolation(z,profile); row=[]
            for i in range(sides):
                a=math.tau*i/sides; p=(rx*math.cos(a),center_y+ry*math.sin(a),z)
                row.append(self.vertex(p,weight(p)))
            rows.append(row)
        for j,(a,b) in enumerate(zip(rows,rows[1:])):
            for i in range(sides):
                ni=(i+1)%sides
                c=colour(math.sin(math.tau*(i+.5)/sides),j/rings) if callable(colour) else colour
                self.face((a[i],a[ni],b[ni],b[i]),c)
        for row,z,reverse in [(rows[0],profile[0][0],True),(rows[-1],profile[-1][0],False)]:
            center=self.vertex((0,center_y,z),weight((0,center_y,z)))
            for i in range(sides):
                ids=(center,row[i],row[(i+1)%sides]); self.face(ids[::-1] if reverse else ids,CREAM)
    def rod(self,a,b,radius,weights,colour,sides=8):
        av,bv=Vector(a),Vector(b); direction=(bv-av).normalized()
        axis=direction.cross(Vector((0,1,0)))
        if axis.length<.01: axis=direction.cross(Vector((1,0,0)))
        axis.normalize(); other=direction.cross(axis).normalized()
        rows=[]
        for t,r in [(0,.55),(.15,1),(.85,1),(1,.55)]:
            center=av.lerp(bv,t); row=[]
            for i in range(sides):
                ang=math.tau*i/sides; p=center+radius*r*(axis*math.cos(ang)+other*math.sin(ang))
                row.append(self.vertex(p,weights(p) if callable(weights) else weights))
            rows.append(row)
        self.face(tuple(reversed(rows[0])),colour);self.face(rows[-1],colour)
        for row,nextrow in zip(rows,rows[1:]):
            for i in range(sides):
                ni=(i+1)%sides;self.face((row[i],row[ni],nextrow[ni],nextrow[i]),colour)
    def fin(self, yz, halfwidth, weight, colour):
        rows=[]
        for s in (-1,1):
            rows.append([self.vertex((s*halfwidth,y,z),weight((0,y,z)) if callable(weight) else weight) for y,z in yz])
        self.face(rows[0][::-1],colour);self.face(rows[1],colour)
        for i in range(len(yz)):
            j=(i+1)%len(yz);self.face((rows[0][i],rows[0][j],rows[1][j],rows[1][i]),colour)
    def wedge(self,points,weight,colour):
        ids=[self.vertex(p,weight(p) if callable(weight) else weight) for p in points]
        # triangular prism, lower triangle then upper triangle
        for face in [(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]:self.face(tuple(ids[i] for i in face),colour)
    def smile(self,z,y,width,weight):
        pts=[(-width*.5,y+.035,z),(-width*.25,y,z-.024),(0,y-.012,z-.035),(width*.25,y,z-.024),(width*.5,y+.035,z)]
        for a,b in zip(pts,pts[1:]):self.rod(a,b,.015,weight,INK,6)


def chain_weights(n, centers):
    def weights(p):
        z=p[2]
        if z<=centers[0]:return {'spine_1':1}
        for i,(a,b) in enumerate(zip(centers,centers[1:])):
            if z<=b:
                f=smooth((z-a)/(b-a))
                return {f'spine_{i+1}':1-f,f'spine_{i+2}':f}
        return {f'spine_{n}':1}
    return weights


def eyes(g,x,y,z,bone,scale=1):
    for s in (-1,1):
        g.sphere((s*x,y,z),(.11*scale,.13*scale,.10*scale),{bone:1},WHITE,12,7)
        g.sphere((s*x,y-.005*scale,z-.072*scale),(.063*scale,.078*scale,.038*scale),{bone:1},INK,10,6)
        g.sphere((s*x-.018*scale,y+.035*scale,z-.104*scale),(.022*scale,.026*scale,.012*scale),{bone:1},WHITE,8,5)


def swimmer():
    spec={f'spine_{i+1}':((0,0,-1.12+i*.45),(0,0,-1.12+(i+1)*.45),f'spine_{i}' if i else None) for i in range(6)}
    weight=chain_weights(6,[-.85,-.42,0,.42,.82,1.18]);g=Geometry()
    profile=[(-1.38,.06,.07),(-1.23,.29,.29),(-.95,.44,.41),(-.55,.46,.40),(-.12,.37,.34),(.32,.27,.27),(.68,.16,.19),(1.06,.08,.10),(1.22,.09,.10)]
    g.tube(profile,weight,lambda y,t:BELLY if y<-.3 else (SHELL if y>.55 else CREAM),38,16)
    # Tall dorsal sail and a broad forked tail make the fish legible from all views.
    g.fin([(.31,-.38),(.82,-.08),(.60,.13),(.24,.40)],.055,weight,DARK)
    g.fin([(.05,1.05),(.52,1.48),(.18,1.35),(0,1.29),(-.18,1.35),(-.52,1.48),(-.05,1.05)],.045,{'spine_6':1},DARK)
    for s in (-1,1):
        g.wedge([(s*.27,-.05,-.46),(s*.83,-.10,-.05),(s*.37,-.16,.13),
                 (s*.27,.03,-.46),(s*.83,-.02,-.05),(s*.37,-.08,.13)],weight,SHELL)
        # Gill vents sit on the stiff shoulder, integrated into the neutral toy style.
        for z in [-.66,-.55,-.44]:g.rod((s*.437,.11,z),(s*.432,-.11,z+.025),.012,weight,DARK,6)
    eyes(g,.22,.17,-1.16,'spine_1',.86)
    g.smile(-1.37,-.10,.30,{'spine_1':1})
    return spec,g,{'mouth':('spine_1',(0,-.10,-1.43)),'seat':('spine_3',(0,.38,-.16))}, {'swim':1.4,'dart':.8,'hit':.5,'die':1.4},{'swim'}


def serpent():
    spec={f'spine_{i+1}':((0,0,-1.16+i*.36),(0,0,-1.16+(i+1)*.36),f'spine_{i}' if i else None) for i in range(8)}
    weight=chain_weights(8,[-1.03,-.69,-.34,.02,.38,.74,1.10,1.40]);g=Geometry()
    profile=[(-1.49,.04,.06),(-1.34,.25,.20),(-1.13,.28,.22),(-.90,.20,.19),(-.55,.20,.18),(-.15,.20,.18),(.3,.18,.16),(.7,.15,.14),(1.08,.10,.10),(1.45,.012,.016)]
    g.tube(profile,weight,lambda y,t:BELLY if y<-.35 else (SHELL if y>.55 else CREAM),48,14)
    # Small broad dorsal plates follow the same blend weights as the connected skin.
    for z,r in [(-.61,.17),(-.27,.17),(.09,.16),(.44,.14),(.77,.12),(1.08,.085)]:
        g.fin([(r,z-.11),(r+.11,z),(r,z+.11)],.065,weight,GOLD)
    eyes(g,.185,.115,-1.30,'spine_1',.74)
    g.smile(-1.48,-.055,.27,{'spine_1':1})
    for s in (-1,1):g.sphere((s*.11,.005,-1.468),(.014,.012,.012),{'spine_1':1},DARK,8,5)
    return spec,g,{'mouth':('spine_1',(0,-.055,-1.53)),'tail':('spine_8',(0,0,1.46))}, {'slither':1.8,'strike':.9,'coil':2.4,'hit':.5,'die':1.4},{'slither','coil'}


def crawler():
    spec={'body':((0,.65,0),(0,.95,0),None)};g=Geometry();body={'body':1}
    g.sphere((0,.60,0),(.50,.29,.67),body,DARK,16,9)
    g.sphere((0,.72,.04),(.53,.31,.68),body,CREAM,16,10)
    for s in (-1,1):
        g.sphere((s*.235,.83,.17),(.245,.215,.465),body,SHELL,12,8)
        for z in [-.05,.21,.43]:g.sphere((s*.28,.996-.08*abs(z-.15),z),(.06,.017,.055),body,BELLY,8,4)
    g.sphere((0,.64,-.62),(.36,.235,.265),body,CREAM,14,8)
    eyes(g,.17,.755,-.788,'body',.9)
    g.smile(-.887,.565,.30,body)
    for s in (-1,1):
        g.rod((s*.15,.885,-.56),(s*.25,1.11,-.73),.026,body,DARK,7)
        g.sphere((s*.25,1.11,-.73),(.065,.065,.065),body,GOLD,10,6)
    for side,s in enumerate((1,-1)):
        for j,(hipz,kneez,footz) in enumerate([(-.48,-.83,-1.00),(-.17,-.33,-.43),(.18,.34,.44),(.48,.80,.98)]):
            n=side*4+j+1;upper=f'leg_{n}_upper';lower=f'leg_{n}_lower'
            a=(s*.40,.635,hipz);b=(s*.82,.53,kneez);c=(s*1.02,.075,footz)
            spec[upper]=(a,b,'body');spec[lower]=(b,c,upper)
            g.sphere(a,(.10,.10,.10),{upper:1},DARK,8,5)
            g.rod(a,b,.085,{upper:1},CREAM,8)
            g.sphere(b,(.084,.084,.084),{lower:1},GOLD,8,5)
            g.rod(b,c,.069,{lower:1},SHELL,8)
            g.sphere((c[0],.055,c[2]-.015),(.097,.055,.14),{lower:1},DARK,8,5)
    return spec,g,{'mouth':('body',(0,.565,-.93)),'back':('body',(0,1.035,.18)),'front':('body',(0,.64,-1.02))}, {'idle':2.4,'hit':.5,'die':1.4},{'idle'}


def pose(kind,name,t,spec):
    p={n:[0.,0.,0.] for n in spec};a=math.tau*t
    impact=key(t,[(0,0),(.16,1),(.36,.48),(.64,-.13),(1,0)])
    if kind=='swimmer':
        if name=='swim':
            for i in range(6):p[f'spine_{i+1}']=[.7*math.sin(a-i*.4), (2+i*2.2)*math.sin(a-i*.60), (2 if i==0 else 0)*math.sin(a)]
        elif name=='dart':
            effort=key(t,[(0,0),(.2,.4),(.32,1),(.64,.8),(1,0)])
            for i in range(6):p[f'spine_{i+1}']=[(-7 if i==0 else 1.5)*effort,(3+i*2.6)*math.sin(a*2-i*.72)*effort,0]
        elif name=='hit':
            for i in range(6):p[f'spine_{i+1}']=[-4*impact,(-1)**i*(7+i)*impact,22*impact if i==0 else 0]
        else:
            fall=key(t,[(0,0),(.23,.12),(.68,1.06),(.85,1),(1,1)])
            for i in range(6):p[f'spine_{i+1}']=[0,6*fall if i else 0,90*fall if i==0 else 0]
    elif kind=='serpent':
        if name=='slither':
            for i in range(8):p[f'spine_{i+1}']=[0,(4 if i==0 else 15+i*.8)*math.sin(a-i*.82),0]
        elif name=='coil':
            angles=[0,18,27,32,34,35,32,26]
            for i in range(8):p[f'spine_{i+1}']=[0,angles[i]+(1.3*math.sin(a-i*.3) if i else 0),0]
        elif name=='strike':
            prep=key(t,[(0,0),(.33,1),(.44,-.38),(.62,.16),(1,0)])
            for i in range(8):p[f'spine_{i+1}']=[(-10 if i==0 else 1)*prep,(-1 if i<3 else 1)*(10+i*2)*prep,3*prep if i==0 else 0]
        elif name=='hit':
            for i in range(8):p[f'spine_{i+1}']=[0,(-1)**i*(9+i*.5)*impact,12*impact if i==0 else 0]
        else:
            fall=key(t,[(0,0),(.2,.13),(.7,1.05),(.87,1),(1,1)])
            for i in range(8):p[f'spine_{i+1}']=[0,(12 if i else 0)*fall,85*fall if i==0 else 0]
    else:
        if name=='idle':
            p['body']=[.5*math.sin(a),.7*math.sin(a),.6*math.sin(a)]
            for n in range(1,9):
                s=1 if n<=4 else -1;phase=a+(n%4)*.9
                p[f'leg_{n}_upper']=[.7*math.sin(phase),0,s*.8*math.sin(phase)]
                p[f'leg_{n}_lower']=[-.4*math.sin(phase),0,-s*.5*math.sin(phase)]
        elif name=='hit':
            p['body']=[-9*impact,0,9*impact]
            for n in range(1,9):
                s=1 if n<=4 else -1
                p[f'leg_{n}_upper']=[0,s*8*impact,s*9*impact]
                p[f'leg_{n}_lower']=[0,0,-s*12*impact]
        else:
            fold=key(t,[(0,0),(.27,.23),(.63,1.06),(.83,1),(1,1)])
            p['body']=[-5*fold,0,90*fold]
            for n in range(1,9):
                s=1 if n<=4 else -1
                p[f'leg_{n}_upper']=[0,s*5*fold,s*42*fold]
                p[f'leg_{n}_lower']=[0,0,s*54*fold]
    return p


def empty(name,parent=None):
    obj=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(obj);obj.parent=parent;return obj


def build(kind):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    # Actions from another exported creature must not leak into this one.
    for action in list(bpy.data.actions):bpy.data.actions.remove(action)
    spec,g,sockets,durations,loops=globals()[kind]()
    root=empty(kind+'_reference');root['license']='CC0-1.0';root['forward']='-Z'
    arm=bpy.data.armatures.new(kind+'_skeleton');rig=bpy.data.objects.new(kind+'_rig',arm)
    bpy.context.collection.objects.link(rig);rig.parent=root
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for name,(head,tail,parent) in spec.items():
        b=arm.edit_bones.new(name);b.head=P(head);b.tail=P(tail)
        if parent:b.parent=arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)
    mesh=bpy.data.meshes.new(kind+'_geometry');mesh.from_pydata(g.vertices,[],g.faces);mesh.update()
    obj=bpy.data.objects.new(kind+'_mesh',mesh);bpy.context.collection.objects.link(obj);obj.parent=rig
    paint=mesh.color_attributes.new(name='paint',type='FLOAT_COLOR',domain='CORNER')
    for poly,color in zip(mesh.polygons,g.colours):
        for li in poly.loop_indices:paint.data[li].color=color
    mat=bpy.data.materials.new(kind+'_neutral_toy');mat.use_nodes=True;mat.use_backface_culling=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=.72;bsdf.inputs['Metallic'].default_value=.04
    attr=mat.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='paint';mat.node_tree.links.new(attr.outputs['Color'],bsdf.inputs['Base Color'])
    mesh.materials.append(mat)
    groups={n:obj.vertex_groups.new(name=n) for n in spec}
    for i,weights in enumerate(g.weights):
        total=sum(weights.values())
        for n,w in weights.items():
            if w>1e-8:groups[n].add([i],w/total,'REPLACE')
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    # Recalculate winding for each disconnected decorative component consistently.
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    tri=obj.modifiers.new('triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
    mod=obj.modifiers.new('skin','ARMATURE');mod.object=rig;obj.select_set(False)
    for name,(bone,pos) in sockets.items():
        socket=empty('socket_'+name);socket.parent=rig;socket.parent_type='BONE';socket.parent_bone=bone
        b=arm.bones[bone];parent=rig.matrix_world@b.matrix_local@Matrix.Translation((0,b.length,0))
        socket.matrix_basis=parent.inverted()@Matrix.Translation(P(pos))
    bpy.context.scene.render.fps=FPS;bpy.context.scene.frame_start=0;rig.animation_data_create()
    for name,duration in durations.items():
        action=bpy.data.actions.new(name);action.use_fake_user=True;action['loop']=name in loops;rig.animation_data.action=action
        frames=round(duration*FPS)
        for frame in range(frames+1):
            t=0 if name in loops and frame==frames else frame/frames
            poses=pose(kind,name,t,spec)
            for n,angles in poses.items():
                pb=rig.pose.bones[n];pb.rotation_mode='QUATERNION';basis=pb.bone.matrix_local.to_quaternion()
                rx,ry,rz=map(math.radians,angles)
                q=Quaternion(P((1,0,0)),rx)@Quaternion(P((0,1,0)),ry)@Quaternion(P((0,0,1)),rz)
                pb.rotation_quaternion=basis.inverted()@q@basis;pb.keyframe_insert(data_path='rotation_quaternion',frame=frame)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for point in curve.keyframe_points:point.interpolation='LINEAR'
    rig.animation_data.action=None
    for pb in rig.pose.bones:pb.rotation_quaternion=Quaternion();pb.location=(0,0,0);pb.scale=(1,1,1)
    bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    def descendants(o):return [o]+[x for child in o.children for x in descendants(child)]
    for o in descendants(root):o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(kind+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_extras=True,
        export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=False,export_anim_single_armature=True,export_bake_animation=False,export_skins=True,export_all_influences=False)
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(kind+'_source.blend')))
    verts=[(v[0],v[2],-v[1]) for v in g.vertices]
    bounds={'min':[min(p[i] for p in verts) for i in range(3)],'max':[max(p[i] for p in verts) for i in range(3)]}
    metadata={'type':kind,'fps':FPS,'bones':list(spec),'hierarchy':{n:v[2] for n,v in spec.items()},
        'boneLengths':{n:(P(v[1])-P(v[0])).length for n,v in spec.items()},'socketParents':{n:v[0] for n,v in sockets.items()},
        'socketPositions':{n:list(v[1]) for n,v in sockets.items()},
        'clips':{n:{'duration':duration,'loop':n in loops,'rootMotion':'external','tracks':'rotation_only'} for n,duration in durations.items()},
        'referenceBounds':bounds,'origin':'ground midpoint between feet' if kind=='crawler' else 'centre of longitudinal reference; Y=0 at body centre',
        'limbScaleRange':[.7,1.4],'notes':['Locomotion, ground contact and root paths belong to game integration.',
            'Crawler walking is procedural IK; idle, hit and die are the only authored clips.' if kind=='crawler' else 'Continuous weighted body rings keep the skin connected during bending.']}
    (OUT/(kind+'-clips.json')).write_text(json.dumps(metadata,indent=2)+'\n')
    print('CREATURE_EXPORTED',kind,len(obj.data.polygons),'triangles',len(spec),'bones',len(durations),'clips',flush=True)


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    kinds=[args[args.index('--type')+1]] if '--type' in args else ['swimmer','crawler','serpent']
    for kind in kinds:build(kind)
