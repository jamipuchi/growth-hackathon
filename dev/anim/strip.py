import sys, os
from PIL import Image
sid, ent, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
ims = [Image.open(os.path.join(here, f"{sid}-{i:02d}.png")).convert("RGB") for i in range(n)]
w, h = ims[0].size
cx, half, y0, y1 = (210, 175, 0.12, 0.66) if ent == "ship" else (602, 120, 0.12, 0.84)
cx = int(cx / 844 * w); half = int(half / 844 * w)
box = (max(0, cx - half), int(y0 * h), cx + half, int(y1 * h))
tw = 230; th = int((box[3] - box[1]) * tw / (box[2] - box[0]))
sheet = Image.new("RGB", (tw * n, th))
for i, im in enumerate(ims):
    sheet.paste(im.crop(box).resize((tw, th)), (i * tw, 0))
sheet.save(os.path.join(here, f"strip-{sid}.png"))
for i in range(n): os.remove(os.path.join(here, f"{sid}-{i:02d}.png"))
