"""Original CC0 expedition buggy. Blender 5.2: blender -b --python generate_car.py.
Writes only new car files. Author coordinates: metres, Y up, -Z forward.
"""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector, Matrix

OUT = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps = 30

IVORY=(.83,.79,.64,1); PALE=(.95,.93,.78,1); SLATE=(.11,.20,.25,1)
DARK=(.022,.038,.048,1); RUBBER=(.035,.043,.047,1); TEAL=(.07,.54,.63,1)
CYAN=(.14,.77,.85,1); TAN=(.45,.27,.13,1); SILVER=(.43,.52,.52,1)
GLASS=(.055,.18,.23,1); WARM=(1.,.74,.34,1)

def P(v): return (v[0], -v[2], v[1])
def material(name, rough, metal, emissive=False):
    m=bpy.data.materials.new(name); m.use_nodes=True; m.use_backface_culling=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(1,1,1,1)
    p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    c=m.node_tree.nodes.new('ShaderNodeVertexColor'); c.layer_name='car_paint'
    m.node_tree.links.new(c.outputs['Color'],p.inputs['Base Color'])
    if emissive:
        # glTF does not modulate emissiveFactor by vertex colour. Keep the common
        # lamp emission warm amber explicitly rather than exporting white glow.
        p.inputs['Emission Color'].default_value=(.70,.38,.09,1)
        p.inputs['Emission Strength'].default_value=1.8
    return m

BODY=material('car_painted_body',.62,.10)
WHEELS=material('car_wheel_rubber_alloy',.76,.06)
LIGHTS=material('car_lamp_glow',.38,.05,True)

class Builder:
    def __init__(self,name): self.name=name; self.vertices=[]; self.faces=[]; self.colors=[]; self.normals=[]; self.ids=[]; self.parts=[]
    def solid(self,name,verts,faces,color,wheel=-1):
        pts=[Vector(v) for v in verts]; center=sum(pts,Vector())/len(pts); offset=len(self.vertices)
        self.vertices.extend([tuple(v) for v in pts])
        for face in faces:
            face=list(face); ps=[pts[i] for i in face]
            normal=(ps[1]-ps[0]).cross(ps[2]-ps[0])
            fc=sum(ps,Vector())/len(ps)
            if normal.dot(fc-center)<0: face.reverse(); normal.negate()
            normal.normalize()
            shade=.88+.12*max(0,normal.y)
            self.faces.append(tuple(offset+i for i in face))
            self.colors.append(tuple(v*shade for v in color[:3])+(color[3],)); self.normals.append(tuple(normal)); self.ids.append(wheel)
        self.parts.append(name)
    def box(self,name,center,size,color,rotation=None,bevel=0):
        x,y,z=[v/2 for v in size]
        if bevel:
            b=min(bevel,x*.5,z*.5)
            outline=[(-x+b,-z),(x-b,-z),(x,-z+b),(x,z-b),(x-b,z),(-x+b,z),(-x,z-b),(-x,-z+b)]
        else: outline=[(-x,-z),(x,-z),(x,z),(-x,z)]
        n=len(outline); verts=[Vector((a,h,c)) for h in (-y,y) for a,c in outline]
        rot=rotation if rotation is not None else Matrix.Identity(3)
        verts=[tuple(rot@v+Vector(center)) for v in verts]
        faces=[tuple(range(n)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        self.solid(name,verts,faces,color)
    def beam(self,name,a,b,radius,color,n=6):
        a,b=Vector(a),Vector(b); axis=(b-a).normalized()
        other=Vector((1,0,0)) if abs(axis.x)<.8 else Vector((0,1,0))
        u=axis.cross(other).normalized(); v=axis.cross(u).normalized()
        verts=[tuple(c+radius*(math.cos(i*math.tau/n)*u+math.sin(i*math.tau/n)*v)) for c in (a,b) for i in range(n)]
        faces=[tuple(range(n)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        self.solid(name,verts,faces,color)
    def loft(self,name,profiles,color):
        verts=[]
        for z,w,lo,hi in profiles:
            bevel=min(.075,(hi-lo)*.25)
            verts.extend([(-w,lo+bevel,z),(-w+bevel,lo,z),(w-bevel,lo,z),(w,lo+bevel,z),(w,hi-bevel,z),(w-bevel,hi,z),(-w+bevel,hi,z),(-w,hi-bevel,z)])
        faces=[tuple(range(8)),tuple(range((len(profiles)-1)*8,len(profiles)*8))]
        for j in range(len(profiles)-1):
            for i in range(8): faces.append((j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i))
        self.solid(name,verts,faces,color)
    def copy_from(self,other,position,wheel):
        start=len(self.vertices); p=Vector(position)
        self.vertices.extend([tuple(Vector(v)+p) for v in other.vertices])
        self.faces.extend([tuple(start+i for i in f) for f in other.faces])
        self.colors.extend(other.colors); self.normals.extend(other.normals); self.ids.extend([wheel]*len(other.faces)); self.parts.append('wheel_'+str(wheel))
    def triangulate_convex_faces(self):
        # Every authoring face is convex. Triangulate in prototype-local space
        # before translation: Blender's n-gon tessellator can choose different
        # cap diagonals/order after floating-point translations of identical parts.
        faces=[]; colors=[]; normals=[]; ids=[]
        for face,color,normal,identity in zip(self.faces,self.colors,self.normals,self.ids):
            for i in range(1,len(face)-1):
                faces.append((face[0],face[i],face[i+1])); colors.append(color); normals.append(normal); ids.append(identity)
        self.faces=faces; self.colors=colors; self.normals=normals; self.ids=ids
    def finish(self,parent,material):
        mesh=bpy.data.meshes.new(self.name+'_geometry'); mesh.from_pydata([P(v) for v in self.vertices],[],self.faces); mesh.update()
        obj=bpy.data.objects.new(self.name,mesh); bpy.context.collection.objects.link(obj); obj.parent=parent; mesh.materials.append(material)
        paint=mesh.color_attributes.new(name='car_paint',type='FLOAT_COLOR',domain='CORNER')
        uv=mesh.uv_layers.new(name='wheel_id')
        for face,color,wheel in zip(mesh.polygons,self.colors,self.ids):
            face.use_smooth=False
            for i in face.loop_indices:
                paint.data[i].color=color; uv.data[i].uv=((wheel+.5)/4 if wheel>=0 else 0,0)
        bpy.context.view_layer.objects.active=obj; obj.select_set(True)
        tri=obj.modifiers.new('triangles','TRIANGULATE'); bpy.ops.object.modifier_apply(modifier=tri.name)
        if all(identity>=0 for identity in self.ids):
            # Explicit per-corner prototype normals remain identical after each
            # translated copy. Smooth flags enable custom normals; the supplied
            # normals themselves are flat per authored face, including hard rims.
            assert all(len(face)==3 for face in self.faces)
            for face in obj.data.polygons: face.use_smooth=True
            obj.data.normals_split_custom_set([P(normal) for normal in self.normals for _ in range(3)])
        obj.select_set(False); return obj

root=bpy.data.objects.new('default_car',None); bpy.context.collection.objects.link(root)
root['license']='CC0-1.0'; root['forward']='-Z'; root['wheel_node_contract']='Named empty pivots drive car.js four-instance batch. Raw merged wheels are static.'
body=Builder('car_body'); lamps=Builder('car_lights'); prototype=Builder('wheel_prototype'); wheels=Builder('car_wheels')

# A low chamfered chassis, a short sloping bonnet and raised utility tail.
body.loft('lower_hull',[(-1.75,.65,.40,.76),(-1.38,.87,.37,.91),(.92,.87,.37,.92),(1.76,.70,.48,.85)],SLATE)
body.loft('hood',[(-1.69,.66,.71,.91),(-1.12,.82,.76,1.12),(-.40,.79,.78,1.12)],IVORY)
body.box('hood_center_stripe',(0,1.128,-.78),(.28,.013,.65),TEAL,bevel=.025)
body.box('hood_back_vent',(0,1.144,-.49),(.51,.024,.16),DARK,bevel=.02)
for x in (-.19,-.095,0,.095,.19): body.box('vent_bar',(x,1.16,-.49),(.025,.02,.12),SILVER)
body.box('front_bumper',(0,.53,-1.90),(1.67,.21,.20),DARK,bevel=.05)
body.box('front_bumper_top',(0,.65,-1.89),(1.37,.055,.13),SILVER,bevel=.035)
body.box('rear_bumper',(0,.55,1.90),(1.60,.20,.20),DARK,bevel=.04)
body.box('rear_deck',(0,.91,1.40),(1.48,.18,.61),IVORY,bevel=.12)
body.box('rear_storage_recess',(0,1.01,1.43),(1.13,.09,.40),DARK,bevel=.07)
body.box('rear_cargo_case',(0,1.12,1.49),(.73,.27,.32),TAN,bevel=.035)
for x in (-.23,.23): body.box('cargo_strap',(x,1.265,1.49),(.045,.025,.33),DARK)
body.box('cab_floor',(0,.72,.40),(1.53,.12,1.70),DARK,bevel=.07)

# Four wide, high fenders make the silhouette legible from above.
for side in (-1,1):
    for z in (-1.25,1.20):
        body.box('fender', (side*1.00,1.13,z),(.63,.15,1.15),IVORY,bevel=.12)
        body.box('fender_piping',(side*1.315,1.16,z),(.032,.075,.83),TEAL,bevel=.012)
    body.box('side_sill',(side*.89,.66,.06),(.16,.20,1.23),IVORY,bevel=.04)
    body.box('side_step',(side*1.01,.43,.10),(.26,.10,.72),DARK,bevel=.055)
    body.box('side_stripe',(side*.982,.69,.06),(.025,.055,.76),TEAL)
    body.beam('side_grab_bar',(side*.87,.92,-.33),(side*.87,.92,.87),.042,SILVER)
    body.beam('roll_cage_front',(side*.76,1.02,-.43),(side*.70,2.03,-.15),.064,SLATE)
    body.beam('roll_cage_rear',(side*.77,.96,1.30),(side*.70,2.03,1.08),.064,SLATE)
    body.beam('roof_rail',(side*.70,2.03,-.15),(side*.70,2.03,1.08),.064,SLATE)
    body.beam('cage_teal_wrap',(side*.737,1.38,-.33),(side*.721,1.67,-.25),.069,TEAL)
    # Two low racing buckets leave the cabin visibly open.
    body.box('seat_base',(side*.38,.89,.40),(.55,.17,.58),TAN,bevel=.075)
    body.box('seat_back',(side*.38,1.21,.72),(.54,.66,.16),DARK,rotation=Matrix.Rotation(-.12,3,'X'),bevel=.06)
    body.box('seat_back_pad',(side*.38,1.23,.615),(.36,.43,.045),TAN,rotation=Matrix.Rotation(-.12,3,'X'),bevel=.045)
    body.box('seat_headrest',(side*.38,1.59,.755),(.33,.21,.14),TAN,bevel=.045)
    body.box('seat_harness',(side*.38-.10,1.22,.582),(.05,.40,.018),TEAL)
    body.box('seat_harness',(side*.38+.10,1.22,.582),(.05,.40,.018),TEAL)
    # Bright forward lamps, amber rear lamps; no hostile red body palette.
    body.box('headlight_bezel',(side*.57,.84,-1.697),(.31,.28,.13),DARK,bevel=.055)
    lamps.box('headlamp',(side*.57,.85,-1.770),(.22,.18,.027),(.96,.87,.54,1),bevel=.035)
    body.box('tail_bezel',(side*.56,.86,1.759),(.21,.18,.08),DARK,bevel=.03)
    lamps.box('tail_lamp',(side*.56,.86,1.807),(.14,.11,.025),(1.,.25,.025,1),bevel=.02)
    body.beam('tow_hook',(side*.44,.46,-1.984),(side*.44,.57,-1.984),.035,TEAL)

for z in (-.15,1.08): body.beam('roof_crossbar',(-.70,2.03,z),(.70,2.03,z),.064,SLATE)
body.box('sun_visor',(0,2.025,-.12),(1.28,.055,.21),IVORY,bevel=.025)
body.box('roof_badge',(0,2.065,-.12),(.34,.025,.16),TEAL,bevel=.025)
body.box('dash',(0,1.13,-.22),(1.41,.19,.28),SLATE,bevel=.045)
body.box('dash_gauge',(-.36,1.242,-.21),(.23,.025,.13),CYAN,bevel=.02)
body.box('dash_center_switches',(.13,1.24,-.21),(.22,.025,.10),DARK,bevel=.015)
for x in (.065,.13,.195): body.box('dash_switch',(x,1.259,-.21),(.025,.024,.035),WARM)
# A compact polygon steering rim and two broad spokes.
steer_center=Vector((-.38,1.27,.055)); n=10
for i in range(n):
    a=i*math.tau/n; b=(i+1)*math.tau/n
    p1=steer_center+Vector((.185*math.cos(a),.185*math.sin(a),0))
    p2=steer_center+Vector((.185*math.cos(b),.185*math.sin(b),0))
    body.beam('steering_rim',p1,p2,.022,DARK,n=5)
body.beam('steering_spoke',steer_center+Vector((-.17,0,0)),steer_center+Vector((.17,0,0)),.022,SILVER,n=5)
body.beam('steering_column',steer_center,(steer_center.x,1.07,-.23),.035,DARK)
body.box('steering_hub',steer_center,(.09,.08,.045),TEAL,bevel=.015)

# One symmetric local-X wheel prototype. Both outer faces carry identical hubs,
# so all four copies have the same geometry, normals, colours and handedness.
n=16; profile=[(-.255,.37),(-.245,.45),(-.18,.51),(.18,.51),(.245,.45),(.255,.37)]
verts=[(x,r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n)) for x,r in profile for i in range(n)]
faces=[tuple(range(n)),tuple(range((len(profile)-1)*n,len(profile)*n))]
for ring in range(len(profile)-1):
    for i in range(n): faces.append((ring*n+i,ring*n+(i+1)%n,(ring+1)*n+(i+1)%n,(ring+1)*n+i))
prototype.solid('tire_carcass',verts,faces,RUBBER)
for i in range(n):
    a=i*math.tau/n
    prototype.box('tread_lug',(0,.527*math.cos(a),.527*math.sin(a)),(.42,.050,.095),DARK,rotation=Matrix.Rotation(a,3,'X'))
for side in (-1,1):
    prototype.beam('alloy_rim',(side*.256,0,0),(side*.274,0,0),.302,SILVER,n=12)
    prototype.beam('hub_cap',(side*.278,0,0),(side*.299,0,0),.108,TEAL,n=10)
    for i in range(5):
        a=i*math.tau/5
        p1=(side*.285,.145*math.cos(a),.145*math.sin(a)); p2=(side*.285,.262*math.cos(a),.262*math.sin(a))
        prototype.beam('rim_spoke',p1,p2,.033,SLATE,n=4)
    prototype.beam('axle_cap',(side*.302,0,0),(side*.314,0,0),.041,PALE,n=6)

prototype.triangulate_convex_faces()
rest_radius=-min(v[1] for v in prototype.vertices)
radial_radius=max(math.hypot(v[1],v[2]) for v in prototype.vertices)
wheel_positions={'wheel_fl':[-1.02,rest_radius,-1.25],'wheel_fr':[1.02,rest_radius,-1.25],
                 'wheel_bl':[-1.02,rest_radius,1.20],'wheel_br':[1.02,rest_radius,1.20]}
for index,(name,position) in enumerate(wheel_positions.items()):
    wheels.copy_from(prototype,position,index)
    node=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(node); node.parent=root; node.location=P(position)
    node['wheel_index']=index; node['spin_axis']='local_x'; node['front']=index<2
root['wheel_radius']=rest_radius; root['wheel_max_radial_extent']=radial_radius
root['wheel_id_attribute']='TEXCOORD_0.x = (wheel_index + 0.5) / 4'

sockets={'seat':[-.38,1.005,.36],'roof':[0,2.14,.44],'front':[0,.85,-2.04],'back':[0,.85,2.04]}
for name,position in sockets.items():
    node=bpy.data.objects.new('socket_'+name,None); bpy.context.collection.objects.link(node); node.parent=root; node.location=P(position)

objects=[body.finish(root,BODY),lamps.finish(root,LIGHTS),wheels.finish(root,WHEELS)]
bpy.context.view_layer.update()
triangles={o.name:len(o.data.polygons) for o in objects}
total=sum(triangles.values()); assert total<=5000,triangles
assert triangles['car_wheels']%4==0
all_vertices=body.vertices+lamps.vertices+wheels.vertices
bounds={'min':[min(v[a] for v in all_vertices) for a in range(3)],'max':[max(v[a] for v in all_vertices) for a in range(3)]}
assert abs(bounds['min'][1])<1e-7
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'car.glb'),export_format='GLB',use_selection=True,export_yup=True,
    export_animations=False,export_materials='EXPORT',export_extras=True,export_normals=True,
    export_texcoords=True,export_all_vertex_colors=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'car_source.blend'))
data=(OUT/'car.glb').read_bytes()
manifest={'version':1,'license':'CC0-1.0','source':'Original deterministic geometry and vertex paint; no external meshes, textures or images.',
    'axes':{'up':'+Y','forward':'-Z','origin':'center of base; rest geometry touches y=0'},
    'bounds':bounds,'size':[bounds['max'][i]-bounds['min'][i] for i in range(3)],
    'triangles':total,'triangles_by_mesh':triangles,'triangles_per_wheel':triangles['car_wheels']//4,
    'raw_glb_draw_calls':3,'helper_draw_calls':3,'textures':0,'materials':3,
    'wheel_positions':wheel_positions,'wheel_radius':rest_radius,'wheel_max_radial_extent':radial_radius,
    'wheel_id_uv_x':[(i+.5)/4 for i in range(4)],'sockets':sockets,
    'raw_wheel_contract':'Four named empty pivots plus merged static car_wheels mesh. car.js replaces merged wheels with one four-instance batch; syncWheels applies empty-pivot transforms.',
    'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),
    'parts':{'body':body.parts,'lights':lamps.parts,'wheel':prototype.parts}}
(OUT/'car-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('CAR_EXPORTED',json.dumps({k:manifest[k] for k in ('triangles','triangles_by_mesh','size','bytes','sha256')}))
