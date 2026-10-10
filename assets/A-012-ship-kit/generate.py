"""Original vector-like texture artwork and analytic PBR data. No external images/fonts.
Run with Python + Pillow + NumPy. Deterministic, seed 12012.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent


def periodic_panels():
    n = 512
    y, x = np.mgrid[:n, :n]
    # Large, shallow rolled plates: the neutral albedo multiplies the player's ink colour.
    col = np.full((n, n), 224., dtype=float)
    h = np.full((n, n), .68, dtype=float)
    for px, py, width, height, shade in [(0, 0, 256, 256, 231), (256, 0, 256, 128, 219),
                                        (256, 128, 256, 128, 233), (0, 256, 128, 256, 220),
                                        (128, 256, 384, 256, 228)]:
        inside = (x >= px) & (x < px+width) & (y >= py) & (y < py+height)
        dist = np.minimum.reduce([x-px, px+width-1-x, y-py, py+height-1-y])
        col[inside] = shade
        col[inside & (dist < 3)] = 75
        col[inside & (dist >= 3) & (dist < 6)] = 158
        col[inside & (dist >= 6) & (dist < 9)] = 244
        h[inside] = np.clip(dist[inside]/8, 0, 1)*.6+.1
        for rx, ry in [(px+18, py+18), (px+width-19, py+height-19)]:
            dx = ((x-rx+n//2) % n)-n//2
            dy = ((y-ry+n//2) % n)-n//2
            radius = np.sqrt(dx*dx+dy*dy)
            col[radius < 6] = 118
            col[radius < 4.2] = 235
            col[(radius < 3.5) & (np.abs(dy) < .8)] = 147
            h[radius < 6] = .42
            h[radius < 4.2] = .82
    # Authored inset vent and access hatch. Repeat with the tile, without baked directional lighting.
    albedo = Image.fromarray(col.astype('uint8'), 'L')
    heightmap = Image.fromarray((h*255).astype('uint8'), 'L')
    a, d = ImageDraw.Draw(albedo), ImageDraw.Draw(heightmap)
    for yy in [306, 321, 336, 351]:
        a.rounded_rectangle((340, yy, 443, yy+6), radius=3, fill=114)
        d.rounded_rectangle((340, yy, 443, yy+6), radius=3, fill=72)
    a.rounded_rectangle((57, 72, 190, 179), radius=12, outline=154, width=3)
    d.rounded_rectangle((57, 72, 190, 179), radius=12, outline=115, width=3)
    a.rectangle((154, 116, 171, 125), fill=124)
    d.rectangle((154, 116, 171, 125), fill=85)
    # Tiny deterministic paint variation, periodic at the tile edge.
    pixels = np.array(albedo).astype(float)
    noise = 1.25*np.sin(x*2*np.pi/32)*np.sin(y*2*np.pi/64)
    pixels = np.clip(pixels+noise, 0, 255).astype('uint8')
    # Match opposite boundary texels exactly; the panel seam crosses the repeat boundary.
    pixels[-1, :] = pixels[0, :]; pixels[:, -1] = pixels[:, 0]
    Image.fromarray(pixels, 'L').convert('RGB').save(ROOT/'panels.png')
    height = np.array(heightmap.filter(ImageFilter.GaussianBlur(.7))).astype(float)/255
    dx = (np.roll(height, -1, 1)-np.roll(height, 1, 1))*1.2
    dy = (np.roll(height, -1, 0)-np.roll(height, 1, 0))*1.2
    # glTF/OpenGL +Y tangent normal. Image rows run down; texture v runs up.
    v = np.stack([-dx, dy, np.ones_like(dx)], -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    normal = np.rint((v*.5+.5)*255).astype('uint8')
    normal[-1, :] = normal[0, :]; normal[:, -1] = normal[:, 0]
    Image.fromarray(normal, 'RGB').save(ROOT/'panels-normal.png')
    heightmap.save(ROOT/'source-panels-height.png')


def painted_surface(kind, w=480, h=480):
    y, x = np.mgrid[:h, :w]
    if kind == 'hazard':
        stripe = ((x+y*w/h)/60 % 2) < 1
        rgb = np.where(stripe[..., None], np.array([255, 198, 41]), np.array([35, 42, 55]))
        # A narrow highlight at each painted edge, not scratches or grunge.
        edge = ((x+y*w/h) % 60) < 2
        rgb[edge & stripe] = [255, 224, 101]
    elif kind == 'racing':
        rgb = np.zeros((h, w, 3))+[221, 233, 244]
        rgb[(x >= 128) & (x < 216)] = [39, 62, 88]
        rgb[(x >= 248) & (x < 300)] = [39, 62, 88]
        rgb[(x >= 218) & (x < 230)] = [83, 181, 231]
    elif kind == 'glass':
        # Opaque stylised canopy with restrained baked reflection marks; no transparency sorting.
        wave = .5+.5*np.cos(2*np.pi*(x/w+y/h))
        rgb = np.array([24, 60, 80])[None, None, :]+wave[..., None]*np.array([23, 54, 59])
        diagonal = (x/w+y/h) % 1
        rgb[(diagonal > .27) & (diagonal < .35)] = [134, 220, 239]
        rgb[(diagonal > .39) & (diagonal < .405)] = [80, 165, 194]
    elif kind == 'nozzle':
        # Circumferential strips use X around the nozzle, Y along its length.
        band = .5+.5*np.cos(2*np.pi*y/h)
        cold = np.array([54, 62, 85]); warm = np.array([187, 118, 84])
        rgb = cold[None,None,:]+band[...,None]*(warm-cold)
        rib = np.minimum(x % 80, 80-x % 80)
        rgb[rib < 4] = [34, 42, 56]
        rgb[(rib >= 4) & (rib < 8)] *= 1.24
        ring = np.minimum(y % 120, 120-y % 120)
        rgb[ring < 3] = [42, 48, 65]
    else:
        # Wide rubber ribs retain silhouette at phone size; mild periodic variation.
        wave = .5+.5*np.cos(2*np.pi*y/40)
        rgb = np.array([25, 32, 44])[None,None,:]+wave[...,None]*np.array([15, 16, 17])
        rgb = np.broadcast_to(rgb, (h, w, 3)).copy()
        rgb[(y % 40) < 3] = [19, 25, 34]
    rgb = np.clip(rgb, 0, 255).astype('uint8')
    rgb[-1, :] = rgb[0, :]; rgb[:, -1] = rgb[:, 0]
    return Image.fromarray(rgb, 'RGB')


def build_surfaces():
    atlas = Image.new('RGB', (1024, 1024))
    placements = {'hazard': (0, 0, 512, 256), 'racing': (0, 256, 512, 256),
                  'glass': (512, 0, 512, 512), 'nozzle': (0, 512, 512, 512), 'trim': (512, 512, 512, 512)}
    rects = {}
    for name, (x, y, w, h) in placements.items():
        tile = painted_surface(name, w-32, h-32)
        # Periodic gutters, no edge clamping: bilinear sampling at the core seam stays tileable.
        padded = np.pad(np.array(tile), ((16,16),(16,16),(0,0)), mode='wrap')
        atlas.paste(Image.fromarray(padded), (x,y))
        rects[name] = {'x':x+16, 'y':y+16, 'width':w-32, 'height':h-32}
    atlas.save(ROOT/'surfaces.png')
    return rects


SEGMENTS = {'0':'abcedf','1':'bc','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd',
            '6':'afgecd','7':'abc','8':'abcdefg','9':'abfgcd'}


def decal_tile(name):
    s=3
    img=Image.new('RGBA',(256*s,256*s))
    d=ImageDraw.Draw(img)
    def poly(points, fill=(247,251,255,255), outline=(24,42,65,255), width=5):
        pts=[(round(x*s),round(y*s)) for x,y in points]
        d.polygon(pts,fill=fill)
        if outline: d.line(pts+[pts[0]],fill=outline,width=width*s,joint='curve')
    white=(247,251,255,255); gold=(255,200,57,255); blue=(39,153,211,255)
    if name.isdigit():
        # Original chamfered motorsport numerals, no font dependency or licence.
        mapping={'a':[(85,44),(166,44),(177,55),(163,68),(87,68),(74,56)],
                 'g':[(86,116),(163,116),(174,128),(162,139),(87,139),(75,128)],
                 'd':[(86,188),(163,188),(176,200),(164,212),(85,212),(73,201)],
                 'f':[(65,64),(78,71),(78,109),(66,122),(54,110),(54,77)],
                 'b':[(183,64),(196,77),(196,110),(183,122),(172,109),(172,72)],
                 'e':[(65,135),(78,145),(78,180),(65,194),(54,181),(54,149)],
                 'c':[(183,135),(196,149),(196,181),(183,194),(172,180),(172,145)]}
        for key in SEGMENTS[name]: poly(mapping[key],width=3)
    elif name=='star':
        pts=[]
        for i in range(10):
            a=-math.pi/2+i*math.pi/5; r=86 if i%2==0 else 39
            pts.append((128+math.cos(a)*r,128+math.sin(a)*r))
        poly(pts,gold)
        poly([(128,61),(139,112),(128,128),(110,116)],(255,235,139,255),None)
    elif name=='chevrons':
        for dy in [-39,25]: poly([(53,84+dy),(128,126+dy),(202,84+dy),(202,125+dy),(128,168+dy),(53,125+dy)],white)
    elif name=='flame':
        poly([(77,202),(48,175),(50,137),(80,100),(84,148),(111,104),(129,40),
              (165,82),(178,124),(203,105),(206,155),(190,191),(165,213)],(255,117,45,255))
        poly([(95,194),(85,165),(110,145),(132,104),(150,147),(177,142),(169,183),(145,199)],gold,None)
    elif name=='shield':
        poly([(128,40),(205,68),(194,158),(165,191),(128,214),(89,191),(62,158),(51,68)],blue)
        poly([(128,70),(174,87),(167,146),(151,170),(128,184),(106,170),(89,146),(82,87)],white,None)
        poly([(128,88),(145,119),(177,124),(153,144),(158,177),(128,161),(98,177),(104,144),(80,124),(112,119)],blue,None)
    elif name=='bolt':
        poly([(116,41),(187,41),(150,102),(199,102),(79,214),(106,145),(63,145)],gold)
    else:
        poly([(42,82),(113,112),(128,95),(143,112),(213,82),(196,119),(157,134),
              (191,134),(173,156),(149,160),(157,178),(128,197),(98,178),(106,160),(82,156),(64,134),
              (99,134),(59,118)],white)
    return img.resize((256,256),Image.Resampling.LANCZOS)


def build_decals():
    names=[str(i) for i in range(10)]+['star','chevrons','flame','shield','bolt','wing']
    atlas=Image.new('RGBA',(1024,1024))
    rects={}
    for i,name in enumerate(names):
        x,y=(i%4)*256,(i//4)*256
        atlas.alpha_composite(decal_tile(name),(x,y))
        rects[name]={'x':x+32,'y':y+32,'width':192,'height':192,
                     'u':(x+32)/1024,'v':1-(y+224)/1024,'w':192/1024,'h':192/1024}
    # Colour dilation in transparent pixels avoids dark fringes with straight alpha.
    rgba=np.array(atlas); mask=rgba[:,:,3]>0; rgb=rgba[:,:,:3].copy(); seen=mask.copy()
    for _ in range(12):
        old=seen.copy()
        for axis,shift in [(0,-1),(0,1),(1,-1),(1,1)]:
            near=np.roll(old,shift,axis); take=near & ~seen
            rgb[take]=np.roll(rgb,shift,axis)[take]; seen[take]=True
    rgba[:,:,:3]=rgb
    Image.fromarray(rgba,'RGBA').save(ROOT/'decals.png')
    (ROOT/'decal-rects.json').write_text(json.dumps(rects,indent=2)+'\n')
    return rects


def make_contact():
    # This is a labelled technical swatch sheet, not a rendered-game screenshot.
    canvas=Image.new('RGB',(1600,1050),(15,25,41)); d=ImageDraw.Draw(canvas)
    d.text((34,22),'SPACE PARTY  /  A-012  /  SHIP TEXTURE KIT',fill=(237,247,255),font_size=30)
    d.text((35,68),'4 shared sources. One-metre panel tiles. Original vector-style artwork + matched normal.',fill=(134,185,214),font_size=19)
    entries=[('panels.png','NEUTRAL PAINT / tint with player colour',32,116,430),
             ('panels-normal.png','TANGENT NORMAL / linear / +Y',492,116,430),
             ('surfaces.png','SURFACES / hazard, racing, glass, heat, rubber',952,116,600),
             ('decals.png','ALPHA DECALS / original numerals + stickers',32,600,430)]
    for file,label,x,y,size in entries:
        im=Image.open(ROOT/file).convert('RGBA').resize((size,size),Image.Resampling.LANCZOS)
        if file=='decals.png':
            bg=Image.new('RGBA',im.size,(70,87,107,255)); bg.alpha_composite(im); im=bg
        canvas.paste(im,(x,y),im)
        d.text((x,y-25),label,fill=(230,240,250),font_size=16)
    panel=Image.open(ROOT/'panels.png').convert('RGB').resize((200,200))
    for i,c in enumerate([(34,182,222),(228,89,93),(242,181,51),(179,115,219)]):
        # Visual reference of multiplication in approximate display space; browser PBR is linear.
        tint=(np.array(panel).astype(float)*np.array(c)/255).astype('uint8')
        canvas.paste(Image.fromarray(tint),(500+(i%2)*220,635+(i//2)*210))
    d.text((500,600),'COLOUR MULTIPLICATION REFERENCE',fill=(230,240,250),font_size=18)
    canvas.save(ROOT/'texture-sheet.png')


def main():
    periodic_panels(); surfaces=build_surfaces(); decals=build_decals(); make_contact()
    files={}
    for name in ['panels.png','panels-normal.png','surfaces.png','decals.png']:
        p=ROOT/name; im=Image.open(p)
        files[name]={'width':im.width,'height':im.height,'bytes':p.stat().st_size,
                     'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    manifest={'version':1,'seed':12012,'uniqueResidentImages':4,'rgba8ResidentBytes':12582908,'mipPolicy':'Panels, normal and decals: full chain. Surface atlas: no mips to avoid cell bleeding.',
              'metersPerPanelTile':1,'normalConvention':'OpenGL tangent +Y',
              'surfaceRectsPixelsTopLeft':surfaces,'decalNames':list(decals),'files':files,
              'source':'Original deterministic vector-like artwork; no external image/font sources.'}
    (ROOT/'texture-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))


if __name__=='__main__': main()
