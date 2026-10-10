# planet-strobe luminance: per-frame mean luma, frame-to-frame swing, and the region that flickers most.
#   python3 dev/planet-strobe/lum.py <frames dir> <prefix>
import sys, glob, numpy as np
from PIL import Image
d, pre = sys.argv[1], sys.argv[2]
fs = sorted(glob.glob(f"{d}/{pre}-[0-9][0-9][0-9].jpg"))
L = np.stack([np.asarray(Image.open(f).convert("L"), dtype=np.float32) for f in fs])
m = L.mean(axis=(1, 2))
dm = np.abs(np.diff(m))
pix = np.abs(np.diff(L, axis=0))           # per-pixel frame-to-frame change
flick = pix.mean(axis=0)                   # mean change per pixel
H, W = flick.shape
gh, gw = 6, 8                              # coarse grid: where does it flicker
grid = flick[: H // gh * gh, : W // gw * gw].reshape(gh, H // gh, gw, W // gw).mean(axis=(1, 3))
gi = np.unravel_index(grid.argmax(), grid.shape)
print(f"{pre}: n={len(fs)} meanLuma={m.mean():.1f} min={m.min():.1f} max={m.max():.1f} swing={m.max()-m.min():.1f} "
      f"frameDelta mean={dm.mean():.2f} max={dm.max():.2f} | perPixelDelta mean={pix.mean():.2f} p99={np.percentile(flick,99):.1f} "
      f"| hottest cell row{gi[0]} col{gi[1]} (of {gh}x{gw}) delta={grid.max():.1f}; px>40 per frame avg={(pix>40).mean(axis=(1,2)).mean()*100:.2f}%")
