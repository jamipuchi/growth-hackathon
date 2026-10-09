"""Original stylized Earth-like maps; hand-authored shapes, no external artwork."""
from pathlib import Path
import hashlib, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT=Path(__file__).resolve().parent
W,H=2048,1024
rng=np.random.default_rng(7304)
yy,xx=np.mgrid[0:H,0:W];u=xx/(W-1);v=yy/(H-1)
lon=u*360-180;lat=90-v*180

def sample(grid,y,x):
    y=np.clip(y,0,grid.shape[0]-1);x=np.clip(x,0,grid.shape[1]-1)
    yi=y.astype(int);xi=x.astype(int);fy=y-yi;fx=x-xi
    fy=fy*fy*(3-2*fy);fx=fx*fx*(3-2*fx)
    yj=np.minimum(yi+1,grid.shape[0]-1);xj=np.minimum(xi+1,grid.shape[1]-1)
    return (grid[yi,xi]*(1-fx)+grid[yi,xj]*fx)*(1-fy)+(grid[yj,xi]*(1-fx)+grid[yj,xj]*fx)*fy

def noise(nx,ny):
    grid=rng.random((ny+1,nx+1));grid[:,-1]=grid[:,0]
    return sample(grid,v*ny,u*nx)

def fbm(nx,ny,layers=5):
    out=np.zeros((H,W));weight=0
    for i in range(layers):
        a=.5**i;out+=noise(nx*2**i,ny*2**i)*a;weight+=a
    return out/weight

# Deliberately simplified, original continent outlines in degrees, not a GIS map.
shapes=[
 [(-168,70),(-143,72),(-125,68),(-106,73),(-83,71),(-60,52),(-66,45),(-81,25),(-88,21),(-86,16),(-78,8),(-91,15),(-107,24),(-117,32),(-124,47),(-140,59),(-163,60)],
 [(-82,12),(-72,11),(-60,6),(-50,3),(-35,-7),(-39,-20),(-51,-29),(-61,-43),(-67,-55),(-74,-49),(-75,-24),(-81,-6)],
 [(-52,60),(-42,59),(-20,71),(-25,83),(-44,84),(-60,75)],
 [(-17,35),(0,37),(11,33),(28,32),(34,29),(42,13),(51,11),(43,1),(40,-12),(32,-26),(20,-35),(12,-29),(9,-8),(-4,4),(-16,13)],
 [(-10,36),(-9,44),(-2,49),(8,54),(7,61),(21,71),(37,69),(50,58),(64,67),(92,75),(123,73),(150,61),(179,65),(179,50),(157,48),(141,38),(132,42),(126,31),(121,24),(109,18),(109,8),(103,1),(98,7),(94,19),(88,21),(79,7),(72,18),(67,26),(56,26),(51,14),(42,13),(37,29),(28,41),(23,36),(15,39),(10,44),(2,42)],
 [(113,-21),(123,-14),(132,-12),(138,-17),(144,-12),(154,-26),(148,-38),(136,-35),(127,-33),(115,-35)],
 [(46,-13),(51,-17),(47,-26),(44,-25),(44,-17)],
 [(130,32),(136,35),(141,41),(145,44),(144,35),(135,31)],
 [(96,5),(103,-1),(107,-6),(103,-6),(98,0)],
 [(109,6),(118,5),(119,-3),(113,-5),(109,-1)],
 [(105,-6),(116,-7),(120,-9),(111,-9)],
 [(131,-2),(141,-3),(151,-7),(147,-10),(139,-7)],
 [(173,-34),(178,-38),(173,-42),(166,-47),(168,-40)],
 [(-8,59),(-3,59),(1,51),(-6,50)],
 [(-24,66),(-14,65),(-17,63),(-24,63)],
 [(-180,-74),(-155,-77),(-123,-73),(-90,-73),(-64,-65),(-52,-76),(-15,-71),(22,-70),(56,-66),(90,-67),(126,-67),(153,-72),(180,-74),(180,-90),(-180,-90)]
]
mask_image=Image.new('L',(W,H));draw=ImageDraw.Draw(mask_image)
for points in shapes:draw.polygon([((x+180)/360*(W-1),(90-y)/180*(H-1)) for x,y in points],fill=255)
base=np.array(mask_image)/255
blur=np.array(mask_image.filter(ImageFilter.GaussianBlur(4)))/255
coast=np.log((blur+.0001)/(1-blur+.0001))*4
terrain=fbm(14,7);fine=fbm(90,45,3)
land=np.clip((coast+(terrain-.5)*13+(fine-.5)*3+1.5)/3,0,1)
land[lat<-82]=1
shallow=np.exp(-np.maximum(-coast,0)/8)*(1-land)
ocean=np.stack([.035+.055*shallow,.14+.23*shallow,.31+.18*shallow],axis=-1)
ocean*=.85+.22*terrain[...,None]
desert=np.exp(-((lat-23)/15)**2)*np.clip((lon+22)/15,0,1)*np.clip((110-lon)/20,0,1)
desert=np.maximum(desert,.72*np.exp(-((lat+25)/12)**2)*np.clip((lon-110)/15,0,1))
green=np.stack([.20+.14*terrain,.30+.18*terrain,.13+.09*terrain],axis=-1)
sand=np.stack([.58+.18*fine,.49+.16*fine,.30+.13*fine],axis=-1)
ground=green*(1-desert[...,None])+sand*desert[...,None]
ridge=np.clip((fine-.57)*3,0,.55)
ground=ground*(1-ridge[...,None])+np.array([.46,.43,.35])*ridge[...,None]
ice=np.clip((np.abs(lat)-65+(terrain-.5)*18)/14,0,1)*land
ice=np.maximum(ice,np.clip((lat-29)/6,0,1)*np.clip((37-lat)/5,0,1)*np.clip((lon-68)/12,0,1)*np.clip((101-lon)/12,0,1)*ridge)
ground=ground*(1-ice[...,None])+np.array([.87,.91,.91])*ice[...,None]
color=ocean*(1-land[...,None])+ground*land[...,None]
color=np.clip(color*255,0,255).astype('uint8')

# Flowing bands with wispy edges and a few spiral storm systems.
c=fbm(18,12,6)
warp_x=(xx+45*np.sin(v*26)+24*np.sin(v*11+u*15))%(W-1)
warp_y=np.clip(yy+20*np.sin(u*32+v*8),0,H-1)
c=sample(c,warp_y,warp_x)
cloud=np.clip((c-.49)*4.5,0,1)**1.5*(.65+.35*fine)
for cx,cy,radius in [(340,360,120),(1580,650,145),(1120,300,90)]:
    dx=xx-cx;dy=(yy-cy)*1.25;r=np.hypot(dx,dy);angle=np.arctan2(dy,dx)
    arms=np.clip(np.sin(angle*3+r*.055)-.2,0,1)*np.exp(-((r-radius*.45)/(radius*.38))**2)
    cloud=np.maximum(cloud,arms*.72)
cloud*=np.clip((88-np.abs(lat))/12,0,1)

# Original procedural city clusters, limited to land. Warm colour is in shader.
city_image=Image.new('L',(W,H));city=ImageDraw.Draw(city_image)
clusters=[(-74,41),(-84,35),(-97,33),(-119,35),(-122,47),(-99,20),(-79,8),(-47,-23),(-59,-34),(-71,-33),(-77,-12),(-67,10),(-1,52),(8,50),(19,49),(30,51),(13,42),(27,40),(32,31),(3,35),(-6,34),(7,6),(30,-26),(37,-1),(45,25),(56,26),(73,24),(78,20),(87,24),(77,29),(103,30),(114,34),(121,31),(113,23),(127,37),(139,36),(106,15),(101,4),(113,-7),(151,-33),(145,-37),(18,59),(39,56)]
for longitude,latitude in clusters:
    cx=(longitude+180)/360*(W-1);cy=(90-latitude)/180*(H-1)
    n=int(rng.integers(200,520));scale=rng.uniform(7,16)
    for _ in range(n):
        x=int(cx+rng.normal()*scale);y=int(cy+rng.normal()*scale*.66)
        if 0<=x<W and 0<=y<H and land[y,x]>.95:
            city.point((x,y),fill=int(rng.integers(130,256)))
    for _ in range(10):
        x=int(cx+rng.normal()*scale);y=int(cy+rng.normal()*scale*.7)
        city.line((cx,cy,x,y),fill=45,width=1)
night=np.array(city_image.filter(ImageFilter.GaussianBlur(.32)))/255*land*(1-ice)
packed=np.stack([night,cloud,land],axis=-1)
packed=np.clip(packed*255,0,255).astype('uint8')
# Explicit longitudinal seam closure; polar noise fades to a uniform cap.
color[:,-1]=color[:,0];packed[:,-1]=packed[:,0]
Image.fromarray(color).save(ROOT/'planet_color.png',optimize=True)
Image.fromarray(packed).save(ROOT/'planet_data.png',optimize=True)
report={'size':[W,H],'seed':7304,'data_channels':{'R':'night light intensity','G':'cloud opacity','B':'land mask'},'sources':'Original hand-authored continent outlines and procedural noise; no external images','files':{}}
for name in ['planet_color.png','planet_data.png']:
    raw=(ROOT/name).read_bytes();report['files'][name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
(ROOT/'map-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
