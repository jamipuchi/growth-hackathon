import sys, glob
from PIL import Image
engine, kind = sys.argv[1], sys.argv[2]
order = {"land": ["0","0_5","1","1_5","2","2_5","3"], "take": ["0","0_4","0_8","1_2","1_6","2"]}[kind]
ims = [Image.open(f"shots/{engine}-{kind}-{k}.png").convert("RGB") for k in order]
w = 260; h = int(ims[0].height * w / ims[0].width)
sheet = Image.new("RGB", (w * len(ims), h))
for i, im in enumerate(ims): sheet.paste(im.resize((w, h)), (i * w, 0))
sheet.save(f"shots/strip-{engine}-{kind}.png")
