"""Read the delivered JPEGs; bake linear-radiance SH and quantitative map evidence.
This does not alter either image. Basis/order matches THREE.SphericalHarmonics3.
Requires NumPy and Pillow. Original CC0 source.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parent
lighting={}; evidence={}; poles={}
for variant,filename in [('space','space.jpg'),('nebula','space_nebula.jpg')]:
    image=Image.open(ROOT/filename)
    srgb=np.asarray(image.convert('RGB'),dtype=np.float64)/255
    h,w=srgb.shape[:2]
    assert (w,h)==(2048,1024)
    linear=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
    u=(np.arange(w)+.5)/w
    lat=(.5-(np.arange(h)+.5)/h)*np.pi
    lon=(u-.5)*2*np.pi
    x=np.cos(lat)[:,None]*np.cos(lon)[None,:]
    y=np.broadcast_to(np.sin(lat)[:,None],(h,w))
    z=np.cos(lat)[:,None]*np.sin(lon)[None,:]
    weight=np.cos(lat)[:,None]*np.ones((1,w))
    weight*=4*np.pi/weight.sum()
    # The files stay untouched. Match the helper's sampling guards in linear
    # radiance so diffuse SH represents the visible sky, including its caps.
    pole_rows=8
    north=np.mean(linear[:pole_rows],axis=(0,1))
    south=np.mean(linear[-pole_rows:],axis=(0,1))
    poles[variant]={'north':[round(float(v),9) for v in north], 'south':[round(float(v),9) for v in south]}
    seam_t=np.clip(np.minimum(u,1-u)/.01,0,1)
    seam_t=seam_t*seam_t*(3-2*seam_t)
    sampled=(linear+linear[:,::-1,:])*.5*(1-seam_t[None,:,None])+linear*seam_t[None,:,None]
    pole_t=np.clip((np.abs(y)-.80)/(.995-.80),0,1)
    pole_t=pole_t*pole_t*(3-2*pole_t)
    pole_rgb=np.where((y>=0)[:,:,None],north[None,None,:],south[None,None,:])
    sampled=sampled*(1-pole_t[:,:,None])+pole_rgb*pole_t[:,:,None]
    basis=[np.ones((h,w))*.282095,.488603*y,.488603*z,.488603*x,1.092548*x*y,1.092548*y*z,.315392*(3*z*z-1),1.092548*x*z,.546274*(x*x-y*y)]
    lighting[variant]=[[round(float(value),9) for value in np.sum(sampled*(b*weight)[:,:,None],axis=(0,1))] for b in basis]
    luma=np.dot(linear,[.2126,.7152,.0722])
    evidence[variant]={'file':filename,'bytes':(ROOT/filename).stat().st_size,'sha256':hashlib.sha256((ROOT/filename).read_bytes()).hexdigest(),'dimensions':[w,h],'mode':image.mode,'mean_linear_luminance':float(np.sum(luma*weight)/(4*np.pi)),'raw_wrap_mean_abs_srgb':float(np.mean(np.abs(srgb[:,0]-srgb[:,-1]))),'horizontal_neighbor_mean_abs_srgb':float(np.mean(np.abs(srgb[:,1:]-srgb[:,:-1]))),'north_row_rgb_range':np.ptp(srgb[0],axis=0).tolist(),'south_row_rgb_range':np.ptp(srgb[-1],axis=0).tolist(),'coefficients_finite':bool(np.isfinite(lighting[variant]).all())}
    evidence[variant]['pole_colors_linear']=poles[variant]
    evidence[variant]['guarded_north_row_rgb_range']=np.ptp(sampled[0],axis=0).tolist()
    evidence[variant]['guarded_south_row_rgb_range']=np.ptp(sampled[-1],axis=0).tolist()
lighting['poles']=poles
lighting['sampling']={'seam_width':.01,'pole_start_abs_y':.80,'pole_end_abs_y':.995,'pole_average_rows':8,'coefficients_include_sampling_guards':True}
evidence['dimmer_luminance_ratio']=evidence['nebula']['mean_linear_luminance']/evidence['space']['mean_linear_luminance']
a=np.asarray(Image.open(ROOT/'space.jpg')).reshape(-1,3).astype(float)
b=np.asarray(Image.open(ROOT/'space_nebula.jpg')).reshape(-1,3).astype(float)
evidence['variant_rgb_correlation']=float(np.corrcoef(a.ravel(),b.ravel())[0,1])
evidence['checks']={'exact_2048x1024':all(evidence[k]['dimensions']==[2048,1024] for k in ['space','nebula']),'finite_sh':all(evidence[k]['coefficients_finite'] for k in ['space','nebula']),'nebula_variant_dimmer':.05<evidence['dimmer_luminance_ratio']<.75,'composition_correlated':evidence['variant_rgb_correlation']>.9,'raw_wrap_small':all(evidence[k]['raw_wrap_mean_abs_srgb']<.04 for k in ['space','nebula'])}
evidence['checks']['guarded_poles_uniform']=all(max(evidence[k][f'guarded_{pole}_row_rgb_range'])<1e-12 for k in ['space','nebula'] for pole in ['north','south'])
(ROOT/'lighting.json').write_text(json.dumps(lighting,indent=2)+'\n')
(ROOT/'map-validation.json').write_text(json.dumps(evidence,indent=2)+'\n')
assert all(evidence['checks'].values()),evidence
print(json.dumps(evidence,indent=2))
