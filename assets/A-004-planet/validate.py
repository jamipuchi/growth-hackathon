"""Validate exported PNGs and provenance; runtime geometry is checked in preview."""
import hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
manifest=json.loads((ROOT/'map-manifest.json').read_text())
report={'checks':{},'textures':{}}
arrays={}
for name in ['planet_color.png','planet_data.png']:
    raw=(ROOT/name).read_bytes();image=Image.open(ROOT/name)
    assert image.size==(2048,1024) and image.mode=='RGB'
    a=np.asarray(image);arrays[name]=a
    assert np.array_equal(a[:,0],a[:,-1])
    checksum=hashlib.sha256(raw).hexdigest()
    assert manifest['files'][name]['sha256']==checksum
    report['textures'][name]={'bytes':len(raw),'size':list(image.size),'sha256':checksum,
        'channel_ranges':[[int(a[:,:,i].min()),int(a[:,:,i].max())] for i in range(3)]}
data=arrays['planet_data.png'];night=data[:,:,0];cloud=data[:,:,1];land=data[:,:,2]
assert np.count_nonzero(night>80)>3000
assert np.count_nonzero(cloud>80)>50000
assert np.count_nonzero((cloud>10)&(cloud<180))>100000
assert np.count_nonzero((night>80)&(land<200))==0
assert .15<float(np.mean(land>128))<.65
report['coverage']={'land_fraction_equirectangular':float(np.mean(land>128)),
    'bright_city_pixels':int(np.count_nonzero(night>80)),
    'cloud_pixels_above_80':int(np.count_nonzero(cloud>80))}
report['checks']=dict.fromkeys(['dimensions_and_rgb','longitudinal_seams','manifest_hashes',
    'night_lights_on_land','cloud_detail','land_and_ocean_present'],True)
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
