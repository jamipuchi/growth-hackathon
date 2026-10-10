"""Read-only Blender deformation audit and optional render evidence for our three rigs.

blender --background --python assets/A-008-rigs/aquatic-crawler-review.py -- --render
This script never saves or changes source blends or GLBs.
"""
import bpy, json, math, sys, hashlib
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
def P(v): return Vector((v[0], -v[2], v[1]))
def engine(v): return (v.x,v.z,-v.y)

def render(kind, label, target):
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.samples=20
    scene.cycles.use_denoising=True
    scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
    scene.world.color=(.22,.25,.30)
    scene.view_settings.view_transform='AgX'
    data=bpy.data.cameras.new('review_camera');cam=bpy.data.objects.new('review_camera',data);scene.collection.objects.link(cam)
    cam.location=P((3,2.5,-4));cam.rotation_euler=(P(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=3.85;scene.camera=cam
    lights=[]
    for name,pos,power,size in [('key',(1.5,4,-3),850,4),('fill',(-3,2,-1),550,4),('rim',(1,3,4),950,3)]:
        ld=bpy.data.lights.new('review_'+name,'AREA');ob=bpy.data.objects.new('review_'+name,ld);scene.collection.objects.link(ob)
        ob.location=P(pos);ob.rotation_euler=(P(target)-ob.location).to_track_quat('-Z','Y').to_euler();ld.energy=power;ld.shape='DISK';ld.size=size;lights.append(ob)
    scene.render.filepath=str(OUT/f'aquatic-crawler-{kind}-{label}.png');bpy.ops.render.render(write_still=True)
    for ob in lights+[cam]:bpy.data.objects.remove(ob,do_unlink=True)

results={}
for kind in ['swimmer','crawler','serpent']:
    bpy.ops.wm.open_mainfile(filepath=str(OUT/f'{kind}_source.blend'))
    rig=bpy.data.objects[kind+'_rig'];obj=bpy.data.objects[kind+'_mesh'];meta=json.loads((OUT/f'{kind}-clips.json').read_text())
    checks={'restHasNoActiveAction':rig.animation_data.action is None,
            'restBoneIdentity':all(pb.matrix_basis.is_identity for pb in rig.pose.bones),
            'oneArmatureModifier':len(obj.modifiers)==1 and obj.modifiers[0].type=='ARMATURE'}
    base=[v.co.copy() for v in obj.data.vertices]
    edges=[(e.vertices[0],e.vertices[1]) for e in obj.data.edges]
    lengths=[(base[b]-base[a]).length for a,b in edges]
    clips={}
    for name,info in meta['clips'].items():
        rig.animation_data.action=bpy.data.actions[name]
        boxes=[];finite=True;maxRatio=0.;minRatio=float('inf');frames=round(info['duration']*30)
        for f in range(frames+1):
            bpy.context.scene.frame_set(f);bpy.context.view_layer.update()
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
            vv=[v.co.copy() for v in mesh.vertices]
            finite &= all(math.isfinite(x) for v in vv for x in v)
            ratios=[(vv[b]-vv[a]).length/l for (a,b),l in zip(edges,lengths) if l>1e-7]
            maxRatio=max(maxRatio,max(ratios));minRatio=min(minRatio,min(ratios))
            pp=[engine(v) for v in vv];boxes.append({'min':[min(p[i] for p in pp) for i in range(3)],'max':[max(p[i] for p in pp) for i in range(3)]})
            evaluated.to_mesh_clear()
        clips[name]={'sampledFrames':frames+1,'finite':finite,'minEdgeRatio':minRatio,'maxEdgeRatio':maxRatio,
                    'sweptBounds':{'min':[min(b['min'][i] for b in boxes) for i in range(3)],'max':[max(b['max'][i] for b in boxes) for i in range(3)]}}
    checks['allClipFramesFinite']=all(c['finite'] for c in clips.values())
    checks['noCollapsedEdges']=all(c['minEdgeRatio']>.20 for c in clips.values())
    checks['noExplodingEdges']=all(c['maxEdgeRatio']<2.5 for c in clips.values())
    checks['exactSocketParents']=all(bpy.data.objects['socket_'+n].parent_bone==p for n,p in meta['socketParents'].items())
    # Compare actual source socket world positions to the supplied engine-space manifest.
    rig.animation_data.action=None
    for pb in rig.pose.bones:pb.rotation_quaternion=(1,0,0,0)
    bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    checks['socketRestPositions']=all((bpy.data.objects['socket_'+n].matrix_world.translation-P(pos)).length<1e-5 for n,pos in meta['socketPositions'].items())
    if '--render' in sys.argv:
        render(kind,'rest',(0,.45 if kind=='crawler' else .05,0))
        action,frame={'swimmer':('swim',11),'crawler':('hit',3),'serpent':('coil',18)}[kind]
        rig.animation_data.action=bpy.data.actions[action];bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
        render(kind,action,(.3 if kind=='serpent' else 0,.45 if kind=='crawler' else .05,-.2 if kind=='serpent' else 0))
    results[kind]={'checks':checks,'clips':clips,'limitations':['Blender source deformation sampled at every authored frame; exported GLB is independently audited and browser-tested by the parent.','No physical-device performance measurement.']}
    print(kind,json.dumps(checks),flush=True)
(OUT/'aquatic-crawler-deformation.json').write_text(json.dumps(results,indent=2)+'\n')
assert all(all(v['checks'].values()) for v in results.values()),'Deformation or source contract check failed'
