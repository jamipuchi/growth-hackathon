"""Original low-poly rock kit. blender -b --python assets/A-002-rocks/generate.py"""
import bpy
import bmesh
import math
import random
from mathutils import Vector
from pathlib import Path

OUT=Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
TYPES=('stone','iron','volatile','crystal','magnet','splitter')
PALETTE=[(.47,.44,.40),(.39,.37,.34),(.55,.51,.45),
         (.25,.27,.28),(.32,.33,.34),(.19,.21,.23),
         (.20,.145,.10),(.24,.17,.12),(.17,.12,.09),
         (.68,.57,.85),(.88,.84,.96),(.49,.39,.68),
         (.33,.065,.045),(.50,.46,.41),(.13,.14,.15),(.35,.30,.245)]


def atlas(name, emissive=False):
    image=bpy.data.images.new(name,width=512,height=512,alpha=True)
    image.colorspace_settings.name='sRGB'
    pixels=[]
    for y in range(512):
        for x in range(512):
            tile=(y//128)*4+x//128
            u=(x%128)/127;v=(y%128)/127
            col=PALETTE[tile]
            emission=(0,0,0)
            if tile in (3,4,5):
                # Broad mineral vein plus branch; readable below 100 screen pixels.
                vein=abs(u-(.32+.22*v+.018*math.sin(v*31)))<.048 or (v>.5 and abs(u-(.48-.6*(v-.5)))<.025)
                if vein: col=(.61,.59,.51)
            if tile in (6,7,8):
                # UVs trace this triangle: every surface face has a glowing edge.
                border=min(abs(v-.06),abs(u-(.06+.5*(v-.06))),abs(u-(.94-.5*(v-.06))))
                if border<.026:
                    col=(1,.26,.025);emission=(1,.18,.008)
                elif border<.055:
                    col=(.40,.11,.025);emission=(.14,.015,.001)
            if emissive:
                col=emission
            pixels.extend((*col,1))
    image.pixels.foreach_set(pixels)
    image.update()
    image.filepath_raw=str(OUT/(name+'.png'));image.file_format='PNG';image.save()
    return image


base=atlas('rocks_color');emission=atlas('rocks_emissive',True)
materials={}
for kind in TYPES:
    mat=bpy.data.materials.new(kind+'_material');mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value={'iron':.86,'magnet':.62}.get(kind,.06)
    bsdf.inputs['Roughness'].default_value={'iron':.39,'crystal':.22,'magnet':.58}.get(kind,.88)
    color=mat.node_tree.nodes.new('ShaderNodeTexImage');color.image=base
    mat.node_tree.links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
    if kind=='volatile':
        glow=mat.node_tree.nodes.new('ShaderNodeTexImage');glow.image=emission
        mat.node_tree.links.new(glow.outputs['Color'],bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value=4
    if kind=='crystal':
        bsdf.inputs['Alpha'].default_value=.82
        mat.surface_render_method='BLENDED'
        mat.use_transparency_overlap=False
    mat.use_backface_culling=True
    materials[kind]=mat


def base_rock(kind,variant):
    rng=random.Random(79201+TYPES.index(kind)*101+variant*997)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1 if kind=='splitter' else 2,radius=1)
    obj=bpy.context.object
    axis=((1.12,.82,.94),(.82,1.05,1.15),(1,.93,1.08))[variant-1]
    for vert in obj.data.vertices:
        p=vert.co.normalized();radius=rng.uniform(.82,1.15)
        vert.co=Vector((p.x*axis[0],p.y*axis[1],p.z*axis[2]))*radius
    if kind=='splitter':
        # Cut two closed half rocks and offset their flat faces to form a true gap.
        parts=[]
        for side in (-1,1):
            bm=bmesh.new();bm.from_mesh(obj.data)
            bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                dist=.00001,plane_co=(0,0,0),plane_no=(1,0,0),clear_inner=side==1,clear_outer=side==-1)
            edges=[e for e in bm.edges if e.is_boundary]
            bmesh.ops.holes_fill(bm,edges=edges,sides=0)
            for v in bm.verts:v.co.x+=side*.13
            bmesh.ops.triangulate(bm,faces=list(bm.faces))
            mesh=bpy.data.meshes.new('split_part');bm.to_mesh(mesh);bm.free()
            parts.append(mesh)
        verts=[];faces=[]
        for mesh in parts:
            offset=len(verts);verts.extend([tuple(v.co) for v in mesh.vertices]);faces.extend([tuple(offset+i for i in p.vertices) for p in mesh.polygons])
        mesh=bpy.data.meshes.new('splitter_geometry');mesh.from_pydata(verts,[],faces);mesh.update();obj.data=mesh
    return obj


def crystal(variant):
    rng=random.Random(370+variant)
    vertices=[];faces=[]
    for index in range(3):
        axis=Vector(((index-1)*.55,rng.uniform(-.35,.35),1)).normalized()
        side=axis.cross(Vector((0,1,0))).normalized();back=axis.cross(side).normalized()
        centre=Vector(((index-1)*.32,(-1 if index%2 else 1)*.08,-.35))
        radius=rng.uniform(.25,.34);length=(1.55 if index==1 else 1.10)*rng.uniform(.9,1.1)
        offset=len(vertices)
        for h in (0,length*.72):
            for k in range(6):vertices.append(centre+axis*h+radius*(side*math.cos(k*math.tau/6)+back*math.sin(k*math.tau/6)))
        vertices.extend([centre-axis*.18,centre+axis*length])
        for k in range(6):
            n=(k+1)%6
            for tri in ((k,n,n+6),(k,n+6,k+6),(k+6,n+6,13),(n,k,12)):
                faces.append(tuple(offset+t for t in tri))
    mesh=bpy.data.meshes.new('crystal_geometry');mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new('crystal',mesh);bpy.context.collection.objects.link(obj)
    return obj


assets=[]
for kind in TYPES:
    for variant in (1,2,3):
        obj=crystal(variant) if kind=='crystal' else base_rock(kind,variant)
        obj.name=f'{kind}_{variant}';obj.data.name=obj.name+'_geometry'
        # Equal-volume-density centre of mass, then max radius exactly one metre.
        volume=0;weighted=Vector()
        for face in obj.data.polygons:
            a,b,c=[obj.data.vertices[i].co for i in face.vertices]
            weight=a.dot(b.cross(c))/6
            volume+=weight;weighted+=(a+b+c)*weight/4
        centre=weighted/volume if abs(volume)>1e-8 else sum((v.co for v in obj.data.vertices),Vector())/len(obj.data.vertices)
        for vert in obj.data.vertices:vert.co-=centre
        radius=max(v.co.length for v in obj.data.vertices)
        for vert in obj.data.vertices:vert.co/=radius
        obj.data.materials.append(materials[kind])
        # Icospheres arrive with a default UVMap; discard it so the material
        # samples our palette instead of projecting the whole atlas on each rock.
        for layer in list(obj.data.uv_layers):obj.data.uv_layers.remove(layer)
        uv=obj.data.uv_layers.new(name='atlas_uv')
        rng=random.Random(900+variant+TYPES.index(kind)*31)
        for poly in obj.data.polygons:
            poly.use_smooth=False
            if kind=='magnet':
                height=sum(obj.data.vertices[i].co.z for i in poly.vertices)/len(poly.vertices)
                tile=12 if abs(height)<.27 else (13 if abs(height)<.52 else 14)
            else:
                tile={'stone':0,'iron':3,'volatile':6,'crystal':9,'splitter':0}[kind]+rng.randrange(3)
            cell_x=tile%4;cell_y=tile//4
            coords=[(.06,.06),(.94,.06),(.50,.94)]
            for loop,coord in zip(poly.loop_indices,coords):uv.data[loop].uv=((cell_x+coord[0])/4,(cell_y+coord[1])/4)
        obj['type']=kind;obj['variant']=variant;obj['reference_radius']=1.0;obj['license']='CC0-1.0'
        assets.append(obj)
        obj.select_set(False)

for obj in assets:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'rocks.glb'),export_format='GLB',use_selection=True,
    export_yup=True,export_apply=True,export_extras=True,export_animations=False,export_materials='EXPORT')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'rocks_source.blend'))
print('ROCKS_EXPORTED',[(o.name,len(o.data.polygons)) for o in assets])
